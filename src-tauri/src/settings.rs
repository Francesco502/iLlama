use crate::parameters::{
    FlashAttentionSetting, GpuLayerSetting, PrometheusHintsConfig, StartupParameters, ThreadSetting,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct SettingsStore {
    mutation_lock: Mutex<()>,
    pending_warnings: Mutex<Vec<SettingsWarning>>,
}

impl Default for SettingsStore {
    fn default() -> Self {
        Self {
            mutation_lock: Mutex::new(()),
            pending_warnings: Mutex::new(Vec::new()),
        }
    }
}

impl SettingsStore {
    pub fn load_for_setup(&self, path: &Path) -> io::Result<SettingsEnvelope> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| io::Error::other("设置存储锁定失败。"))?;
        let envelope = load_settings_envelope_from(path)?;
        if !envelope.warnings.is_empty() {
            *self
                .pending_warnings
                .lock()
                .map_err(|_| io::Error::other("设置警告锁定失败。"))? = envelope.warnings.clone();
        }
        Ok(envelope)
    }

    pub fn load(&self, path: &Path) -> io::Result<SettingsEnvelope> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| io::Error::other("设置存储锁定失败。"))?;
        let mut envelope = load_settings_envelope_from(path)?;
        let mut pending = self
            .pending_warnings
            .lock()
            .map_err(|_| io::Error::other("设置警告锁定失败。"))?;
        envelope.warnings.extend(pending.drain(..));
        Ok(envelope)
    }

    pub fn patch(&self, path: &Path, mut patch: serde_json::Value) -> io::Result<SettingsEnvelope> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| io::Error::other("设置存储锁定失败。"))?;
        remove_tray_preference(&mut patch);
        patch_settings_to(path, patch)
    }

    pub fn save(&self, path: &Path, settings: &AppSettings) -> io::Result<()> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| io::Error::other("设置存储锁定失败。"))?;
        save_settings_to(path, settings)
    }

    pub fn set_tray_enabled<F>(
        &self,
        path: &Path,
        enabled: bool,
        mut apply_effect: F,
    ) -> io::Result<SettingsEnvelope>
    where
        F: FnMut(bool) -> io::Result<()>,
    {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| io::Error::other("设置存储锁定失败。"))?;
        let mut envelope = load_settings_envelope_from(path)?;
        let previous = envelope.settings.ui.show_in_menu_bar;
        if previous == enabled {
            apply_effect(enabled)?;
            return Ok(envelope);
        }

        apply_effect(enabled)?;
        envelope.settings.ui.show_in_menu_bar = enabled;
        if let Err(save_error) = save_settings_to(path, &envelope.settings) {
            if let Err(compensation_error) = apply_effect(previous) {
                return Err(io::Error::other(format!(
                    "保存托盘设置失败：{save_error}；恢复托盘状态也失败：{compensation_error}"
                )));
            }
            return Err(save_error);
        }
        Ok(envelope)
    }
}

fn remove_tray_preference(patch: &mut serde_json::Value) {
    if let Some(ui) = patch
        .get_mut("ui")
        .and_then(serde_json::Value::as_object_mut)
    {
        ui.remove("showInMenuBar");
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
    pub recovery_target: Option<String>,
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
        let backup = path.with_extension("json.bak");
        if backup.exists() {
            fs::rename(&backup, path)?;
            let mut envelope = load_settings_envelope_from(path)?;
            envelope.warnings.push(SettingsWarning {
                code: "settings_backup_restored".to_string(),
                message: "检测到未完成的 Windows 设置替换，已从备份恢复。".to_string(),
                recovery_action: "none".to_string(),
                recovery_target: None,
            });
            return Ok(envelope);
        }
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
            recovery_target: None,
        }],
    })
}

pub fn save_settings_to(path: &Path, settings: &AppSettings) -> io::Result<()> {
    ensure_parent(path)?;
    let content = serde_json::to_string_pretty(settings)?;
    let (temp_path, mut temp) = create_unique_temp_file(path)?;
    let result = (|| {
        temp.write_all(content.as_bytes())?;
        temp.sync_all()?;
        drop(temp);
        replace_file(&temp_path, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn create_unique_temp_file(path: &Path) -> io::Result<(PathBuf, fs::File)> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("settings.json");
    loop {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = path.with_file_name(format!(
            "{file_name}.tmp-{}-{nonce}-{counter}",
            std::process::id()
        ));
        match fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

pub fn patch_settings_to(path: &Path, patch: serde_json::Value) -> io::Result<SettingsEnvelope> {
    let mut envelope = load_settings_envelope_from(path)?;
    let settings = patch_settings_in_memory(&envelope.settings, patch)?;
    save_settings_to(path, &settings)?;
    envelope.settings = settings;
    Ok(envelope)
}

pub fn patch_settings_in_memory(
    current: &AppSettings,
    mut patch: serde_json::Value,
) -> io::Result<AppSettings> {
    remove_tray_preference(&mut patch);
    let mut value = serde_json::to_value(current)?;
    merge_json_patch(&mut value, patch);
    value["schemaVersion"] = serde_json::Value::from(3);
    serde_json::from_value::<AppSettings>(value)
        .map(normalize_settings)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
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
    let backup = create_corrupt_backup(path, content, &stamp.to_string())?;
    let recovery_target = fs::canonicalize(&backup)?;
    let settings = default_settings();
    save_settings_to(path, &settings)?;
    Ok(SettingsEnvelope {
        settings,
        warnings: vec![SettingsWarning {
            code: "settings_recovered".to_string(),
            message: format!("设置文件损坏，已备份到 {}。", backup.display()),
            recovery_action: "open-settings-backup".to_string(),
            recovery_target: Some(recovery_target.to_string_lossy().to_string()),
        }],
    })
}

fn create_corrupt_backup(path: &Path, content: &str, stamp: &str) -> io::Result<PathBuf> {
    let mut collision = 0_u64;
    loop {
        let suffix = if collision == 0 {
            String::new()
        } else {
            format!("-{collision}")
        };
        let backup = path.with_file_name(format!("settings.corrupt-{stamp}{suffix}.json"));
        match fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&backup)
        {
            Ok(mut file) => {
                file.write_all(content.as_bytes())?;
                file.sync_all()?;
                return Ok(backup);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                collision = collision
                    .checked_add(1)
                    .ok_or_else(|| io::Error::other("无法为损坏设置创建唯一备份文件。"))?;
            }
            Err(error) => return Err(error),
        }
    }
}

pub fn validate_settings_recovery_target(
    app_data_dir: &Path,
    requested_path: &Path,
) -> io::Result<PathBuf> {
    let requested_metadata = fs::symlink_metadata(requested_path)?;
    if requested_metadata.file_type().is_symlink() || !requested_metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "设置恢复目标必须是普通文件且不能是符号链接。",
        ));
    }
    let canonical_app_data = fs::canonicalize(app_data_dir)?;
    let canonical_target = fs::canonicalize(requested_path)?;
    if canonical_target.parent() != Some(canonical_app_data.as_path()) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "设置恢复目标不在应用数据目录中。",
        ));
    }
    let file_name = canonical_target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "设置恢复目标文件名无效。"))?;
    if !is_timestamped_corrupt_settings_backup(file_name) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "设置恢复目标不是有效的损坏设置备份。",
        ));
    }
    Ok(canonical_target)
}

fn is_timestamped_corrupt_settings_backup(file_name: &str) -> bool {
    let Some(stem) = file_name
        .strip_prefix("settings.corrupt-")
        .and_then(|name| name.strip_suffix(".json"))
    else {
        return false;
    };
    let Some(stamp) = stem.get(..19) else {
        return false;
    };
    let collision_suffix = &stem[19..];
    stamp.len() == 19
        && stamp.as_bytes().get(8) == Some(&b'T')
        && stamp.as_bytes().get(18) == Some(&b'Z')
        && stamp
            .bytes()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 18) || byte.is_ascii_digit())
        && (collision_suffix.is_empty()
            || collision_suffix.strip_prefix('-').is_some_and(|value| {
                !value.is_empty()
                    && !value.starts_with('0')
                    && value.bytes().all(|byte| byte.is_ascii_digit())
            }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevealPlatform {
    Macos,
    Windows,
    Linux,
}

impl RevealPlatform {
    pub fn current() -> Self {
        #[cfg(target_os = "macos")]
        return Self::Macos;
        #[cfg(target_os = "windows")]
        return Self::Windows;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        return Self::Linux;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevealCommandSpec {
    pub program: String,
    pub args: Vec<String>,
}

pub fn build_settings_backup_reveal_command(
    app_data_dir: &Path,
    requested_path: &Path,
    platform: RevealPlatform,
) -> io::Result<RevealCommandSpec> {
    let canonical_target = validate_settings_recovery_target(app_data_dir, requested_path)?;
    let canonical_app_data = canonical_target.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "设置恢复目标缺少应用数据父目录。",
        )
    })?;
    let directory = canonical_app_data.to_string_lossy().to_string();
    let program = match platform {
        RevealPlatform::Macos => "open",
        RevealPlatform::Windows => "explorer",
        RevealPlatform::Linux => "xdg-open",
    };
    Ok(RevealCommandSpec {
        program: program.to_string(),
        args: vec![directory],
    })
}

pub fn launch_settings_backup_reveal_with(
    command: &RevealCommandSpec,
    launch: impl FnOnce(&str, &[String]) -> io::Result<()>,
) -> io::Result<()> {
    launch(&command.program, &command.args)
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

#[cfg(not(target_os = "windows"))]
fn replace_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    fs::rename(temp_path, path)
}

#[cfg(target_os = "windows")]
fn replace_file(temp_path: &Path, path: &Path) -> io::Result<()> {
    if !path.exists() {
        return fs::rename(temp_path, path);
    }

    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    let replaced: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement: Vec<u16> = temp_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let success = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if success == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
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

#[cfg(all(test, unix))]
mod recovery_tests {
    use super::create_corrupt_backup;
    use std::{fs, os::unix::fs::symlink};

    #[test]
    fn corrupt_backup_creation_never_follows_or_truncates_an_existing_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let outside = dir.path().join("outside.json");
        fs::write(&outside, "outside sentinel").unwrap();
        let collision = dir.path().join("settings.corrupt-20260722T093015123Z.json");
        symlink(&outside, &collision).unwrap();

        let backup =
            create_corrupt_backup(&settings, "corrupt settings", "20260722T093015123Z").unwrap();

        assert_eq!(fs::read_to_string(outside).unwrap(), "outside sentinel");
        assert_eq!(
            backup.file_name().unwrap().to_string_lossy(),
            "settings.corrupt-20260722T093015123Z-1.json"
        );
        assert_eq!(fs::read_to_string(backup).unwrap(), "corrupt settings");
    }
}
