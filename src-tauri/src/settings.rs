use crate::parameters::PrometheusHintsConfig;
use serde::{Deserialize, Serialize};
use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistorySettings {
    pub enabled: bool,
    pub image_persistence: String,
    pub include_reasoning_in_export_default: bool,
    pub max_conversations: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub model_directories: Vec<String>,
    pub llama_server_path: Option<String>,
    pub default_preset_id: String,
    pub last_selected_model_path: Option<String>,
    pub auto_port: bool,
    pub default_port: u16,
    pub idle_sleep_seconds: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save_chat_history: Option<bool>,
    #[serde(default)]
    pub prometheus_hints: PrometheusHintsConfig,
    #[serde(default = "default_chat_history_settings")]
    pub chat_history: ChatHistorySettings,
}

pub fn default_settings() -> AppSettings {
    AppSettings {
        schema_version: 2,
        model_directories: Vec::new(),
        llama_server_path: detect_default_llama_server_path()
            .map(|path| path.to_string_lossy().to_string()),
        default_preset_id: "balanced".to_string(),
        last_selected_model_path: None,
        auto_port: true,
        default_port: 8080,
        idle_sleep_seconds: 0,
        save_chat_history: None,
        prometheus_hints: PrometheusHintsConfig::default(),
        chat_history: default_chat_history_settings(),
    }
}

pub fn load_settings_from(path: &Path) -> io::Result<AppSettings> {
    if !path.exists() {
        return Ok(default_settings());
    }

    let content = fs::read_to_string(path)?;
    let settings = serde_json::from_str(&content).unwrap_or_else(|_| default_settings());
    Ok(migrate_settings(settings))
}

pub fn save_settings_to(path: &Path, settings: &AppSettings) -> io::Result<()> {
    ensure_parent(path)?;
    let content = serde_json::to_string_pretty(settings)?;
    fs::write(path, content)
}

pub fn settings_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("settings.json")
}

pub fn default_chat_history_settings() -> ChatHistorySettings {
    ChatHistorySettings {
        enabled: true,
        image_persistence: "thumbnail".to_string(),
        include_reasoning_in_export_default: false,
        max_conversations: 200,
    }
}

fn migrate_settings(mut settings: AppSettings) -> AppSettings {
    if settings.schema_version < 2 {
        let enabled = settings.save_chat_history.unwrap_or(false);
        settings.schema_version = 2;
        settings.chat_history = ChatHistorySettings {
            enabled,
            image_persistence: if enabled {
                "thumbnail".to_string()
            } else {
                "none".to_string()
            },
            include_reasoning_in_export_default: false,
            max_conversations: 200,
        };
        settings.save_chat_history = None;
    }
    settings
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
