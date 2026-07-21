use crate::parameters::{
    FlashAttentionSetting, GpuLayerSetting, PrometheusHintsConfig, StartupParameters, ThreadSetting,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Default)]
pub struct SettingsStore {
    mutation_lock: Mutex<()>,
}

impl SettingsStore {
    pub fn patch(&self, path: &Path, patch: serde_json::Value) -> io::Result<SettingsEnvelope> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| io::Error::other("设置存储锁定失败。"))?;
        patch_settings_to(path, patch)
    }

    pub fn save(&self, path: &Path, settings: &AppSettings) -> io::Result<()> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| io::Error::other("设置存储锁定失败。"))?;
        save_settings_to(path, settings)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SamplingSettings {
    pub temperature: f64,
    pub top_p: f64,
    pub top_k: u32,
    pub min_p: f64,
    pub repeat_penalty: f64,
    pub repeat_last_n: u32,
    pub seed: Option<i64>,
    pub max_tokens: u32,
    pub stop: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchDraftSettings {
    pub profile_id: String,
    pub parameter_preset_source_id: String,
    pub selected_model_path: Option<String>,
    pub auto_port: bool,
    pub port: u16,
    pub parameters: StartupParameters,
    pub prometheus_hints: PrometheusHintsConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UiSettings {
    pub show_in_menu_bar: bool,
    pub log_panel_open: bool,
    pub log_panel_height: u16,
    pub advanced_open: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub model_directories: Vec<String>,
    pub llama_server_path: Option<String>,
    pub launch_draft: LaunchDraftSettings,
    pub sampling: SamplingSettings,
    pub ui: UiSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsWarning {
    pub code: String,
    pub message: String,
    pub recovery_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsEnvelope {
    pub settings: AppSettings,
    pub warnings: Vec<SettingsWarning>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct LegacySettings {
    schema_version: u32,
    model_directories: Vec<String>,
    llama_server_path: Option<String>,
    default_preset_id: String,
    parameter_preset_source_id: String,
    last_selected_model_path: Option<String>,
    auto_port: bool,
    default_port: u16,
    idle_sleep_seconds: u32,
    prometheus_hints: PrometheusHintsConfig,
    show_in_menu_bar: bool,
}

impl Default for LegacySettings {
    fn default() -> Self {
        Self {
            schema_version: 2,
            model_directories: Vec::new(),
            llama_server_path: None,
            default_preset_id: "max-capability".to_string(),
            parameter_preset_source_id: default_parameter_preset_source_id(),
            last_selected_model_path: None,
            auto_port: true,
            default_port: 8080,
            idle_sleep_seconds: 0,
            prometheus_hints: PrometheusHintsConfig::default(),
            show_in_menu_bar: false,
        }
    }
}

pub fn default_settings() -> AppSettings {
    AppSettings {
        schema_version: 3,
        model_directories: Vec::new(),
        llama_server_path: detect_default_llama_server_path()
            .map(|path| path.to_string_lossy().to_string()),
        launch_draft: LaunchDraftSettings {
            profile_id: "auto".to_string(),
            parameter_preset_source_id: default_parameter_preset_source_id(),
            selected_model_path: None,
            auto_port: true,
            port: 8080,
            parameters: default_startup_parameters(),
            prometheus_hints: PrometheusHintsConfig::default(),
        },
        sampling: default_sampling_settings(),
        ui: UiSettings {
            show_in_menu_bar: false,
            log_panel_open: false,
            log_panel_height: 180,
            advanced_open: false,
        },
    }
}

pub fn load_settings_from(path: &Path) -> io::Result<AppSettings> {
    Ok(load_settings_envelope_from(path)?.settings)
}

pub fn load_settings_envelope_from(path: &Path) -> io::Result<SettingsEnvelope> {
    if !path.exists() {
        return Ok(SettingsEnvelope {
            settings: default_settings(),
            warnings: Vec::new(),
        });
    }

    let content = fs::read_to_string(path)?;
    let value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(value) => value,
        Err(_) => return recover_corrupt_settings(path, &content),
    };
    let schema_version = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1);
    if schema_version >= 3 {
        let settings = match serde_json::from_value::<AppSettings>(value) {
            Ok(settings) => normalize_settings(settings),
            Err(_) => return recover_corrupt_settings(path, &content),
        };
        return Ok(SettingsEnvelope {
            settings,
            warnings: Vec::new(),
        });
    }

    let legacy = match serde_json::from_value::<LegacySettings>(value) {
        Ok(settings) => settings,
        Err(_) => return recover_corrupt_settings(path, &content),
    };
    let settings = migrate_legacy_settings(legacy);
    save_settings_to(path, &settings)?;
    Ok(SettingsEnvelope {
        settings,
        warnings: vec![SettingsWarning {
            code: "settings_migrated".to_string(),
            message: "设置已升级到 3.2.0 格式。".to_string(),
            recovery_action: "none".to_string(),
        }],
    })
}

pub fn save_settings_to(path: &Path, settings: &AppSettings) -> io::Result<()> {
    ensure_parent(path)?;
    let content = serde_json::to_string_pretty(settings)?;
    let temp_path = path.with_extension("json.tmp");
    let mut temp = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp_path)?;
    temp.write_all(content.as_bytes())?;
    temp.sync_all()?;
    drop(temp);
    replace_file(&temp_path, path)
}

pub fn patch_settings_to(path: &Path, patch: serde_json::Value) -> io::Result<SettingsEnvelope> {
    let mut envelope = load_settings_envelope_from(path)?;
    let mut value = serde_json::to_value(&envelope.settings)?;
    merge_json_patch(&mut value, patch);
    value["schemaVersion"] = serde_json::Value::from(3);
    let settings = serde_json::from_value::<AppSettings>(value)
        .map(normalize_settings)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    save_settings_to(path, &settings)?;
    envelope.settings = settings;
    Ok(envelope)
}

pub fn settings_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("settings.json")
}

fn default_startup_parameters() -> StartupParameters {
    StartupParameters {
        ctx_size: 32_768,
        threads: ThreadSetting::Auto,
        threads_batch: ThreadSetting::Auto,
        gpu_layers: GpuLayerSetting::All,
        batch_size: 2_048,
        ubatch_size: 512,
        flash_attention: FlashAttentionSetting::Auto,
        mmap: true,
        mlock: false,
        metrics: true,
        idle_sleep_seconds: 0,
        mmproj_path: None,
        mmproj_offload: true,
    }
}

fn default_sampling_settings() -> SamplingSettings {
    SamplingSettings {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        min_p: 0.05,
        repeat_penalty: 1.1,
        repeat_last_n: 64,
        seed: None,
        max_tokens: 2_048,
        stop: Vec::new(),
    }
}

fn migrate_legacy_settings(legacy: LegacySettings) -> AppSettings {
    let mut settings = default_settings();
    settings.model_directories = legacy.model_directories;
    settings.llama_server_path = legacy.llama_server_path;
    settings.launch_draft.profile_id = match legacy.default_preset_id.as_str() {
        "custom" | "low-memory" | "balanced" | "performance" => "custom".to_string(),
        _ => "auto".to_string(),
    };
    settings.launch_draft.parameter_preset_source_id =
        normalize_parameter_preset_source(legacy.parameter_preset_source_id);
    settings.launch_draft.selected_model_path = legacy.last_selected_model_path;
    settings.launch_draft.auto_port = legacy.auto_port;
    settings.launch_draft.port = legacy.default_port.max(1024);
    settings.launch_draft.parameters.idle_sleep_seconds = legacy.idle_sleep_seconds;
    settings.launch_draft.prometheus_hints = legacy.prometheus_hints;
    settings.ui.show_in_menu_bar = legacy.show_in_menu_bar;
    settings
}

fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings.schema_version = 3;
    settings.launch_draft.profile_id = match settings.launch_draft.profile_id.as_str() {
        "auto" | "custom" => settings.launch_draft.profile_id,
        "max-capability" => "auto".to_string(),
        _ => "custom".to_string(),
    };
    settings.launch_draft.parameter_preset_source_id =
        normalize_parameter_preset_source(settings.launch_draft.parameter_preset_source_id);
    settings.launch_draft.port = settings.launch_draft.port.max(1024);
    settings.ui.log_panel_height = settings.ui.log_panel_height.clamp(96, 360);
    settings.sampling.max_tokens = settings.sampling.max_tokens.max(1);
    settings
}

fn normalize_parameter_preset_source(source: String) -> String {
    match source.as_str() {
        "model-family:auto" | "user:balanced" | "user:precise" | "user:creative"
        | "user:low-memory" => source,
        _ => default_parameter_preset_source_id(),
    }
}

fn recover_corrupt_settings(path: &Path, content: &str) -> io::Result<SettingsEnvelope> {
    ensure_parent(path)?;
    let stamp = Utc::now().format("%Y%m%dT%H%M%S%3fZ");
    let backup = path.with_file_name(format!("settings.corrupt-{stamp}.json"));
    fs::write(&backup, content)?;
    let settings = default_settings();
    save_settings_to(path, &settings)?;
    Ok(SettingsEnvelope {
        settings,
        warnings: vec![SettingsWarning {
            code: "settings_recovered".to_string(),
            message: format!("设置文件损坏，已备份到 {}。", backup.display()),
            recovery_action: "open-settings-backup".to_string(),
        }],
    })
}

fn merge_json_patch(target: &mut serde_json::Value, patch: serde_json::Value) {
    match (target, patch) {
        (serde_json::Value::Object(target), serde_json::Value::Object(patch)) => {
            for (key, value) in patch {
                if let Some(existing) = target.get_mut(&key) {
                    merge_json_patch(existing, value);
                } else {
                    target.insert(key, value);
                }
            }
        }
        (target, patch) => *target = patch,
    }
}

fn replace_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    if path.exists() {
        let backup = path.with_extension("json.bak");
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup)?;
        if let Err(error) = fs::rename(temp_path, path) {
            let _ = fs::rename(&backup, path);
            return Err(error);
        }
        let _ = fs::remove_file(backup);
        return Ok(());
    }
    fs::rename(temp_path, path)
}

fn default_parameter_preset_source_id() -> String {
    "model-family:auto".to_string()
}

/// Platform-aware binary name for llama-server.
fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

/// Try to find llama-server on the system: first in PATH, then in common install locations.
pub fn detect_default_llama_server_path() -> Option<PathBuf> {
    let path_env = env::var("PATH").unwrap_or_default();
    resolve_llama_server_path(None, &platform_fallback_dirs(), &path_env)
}

pub fn resolve_llama_server_path(
    requested_path: Option<&str>,
    resource_dirs: &[PathBuf],
    path_env: &str,
) -> Option<PathBuf> {
    requested_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| detect_packaged_sidecar(resource_dirs))
        .or_else(|| detect_llama_server_in_path(path_env))
}

/// Search PATH directories for the platform-appropriate llama-server binary.
pub fn detect_llama_server_in_path(path_env: &str) -> Option<PathBuf> {
    let name = binary_name();
    env::split_paths(path_env)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

/// Common install directories per platform.
fn platform_fallback_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
    }

    #[cfg(target_os = "windows")]
    {
        // winget / manual install
        if let Ok(local) = env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Programs").join("llama.cpp"));
        }
        // scoop
        if let Ok(home) = env::var("USERPROFILE") {
            dirs.push(PathBuf::from(home).join("scoop").join("shims"));
        }
        // chocolatey
        if let Ok(choco) = env::var("ChocolateyInstall") {
            dirs.push(PathBuf::from(choco).join("bin"));
        } else {
            dirs.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin"));
        }
        // Program Files
        dirs.push(PathBuf::from(r"C:\Program Files\llama.cpp"));
    }

    dirs
}

fn detect_packaged_sidecar(resource_dirs: &[PathBuf]) -> Option<PathBuf> {
    for dir in resource_dirs {
        let direct = dir.join(binary_name());
        if direct.is_file() {
            return Some(direct);
        }

        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        let mut candidates: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(is_sidecar_name)
                        .unwrap_or(false)
            })
            .collect();
        candidates.sort();
        if let Some(candidate) = candidates.into_iter().next() {
            return Some(candidate);
        }
    }

    None
}

fn is_sidecar_name(name: &str) -> bool {
    if cfg!(target_os = "windows") {
        name == "llama-server.exe" || (name.starts_with("llama-server-") && name.ends_with(".exe"))
    } else {
        name == "llama-server" || name.starts_with("llama-server-")
    }
}

fn ensure_parent(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}
