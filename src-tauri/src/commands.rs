use crate::{
    health::{check_http_health, find_available_port, HealthStatus},
    legacy_chat_export::export_legacy_chat_history,
    llama_process::{LlamaProcessState, RuntimeSnapshot},
    model_scan::{scan_model_directory_with_progress, ModelScanProgress, ModelScanResult},
    parameters::{build_command_args, validate_launch_config, LaunchConfig, ValidationResult},
    server_probe::{
        build_command_spec, probe_llama_server, CommandSpec, ProbeStatus, ServerCapabilities,
    },
    settings::{
        build_settings_backup_reveal_command, launch_settings_backup_reveal_with,
        resolve_llama_server_path, settings_path, RevealPlatform, SettingsEnvelope, SettingsStore,
    },
    tray,
};
use serde::Serialize;
use std::{env, path::PathBuf, process::Command};
use tauri::{AppHandle, Emitter, Manager, State};

const MODEL_SCAN_PROGRESS_EVENT: &str = "model-scan-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub recovery_action: String,
}

fn command_error(code: &str, recovery_action: &str, message: impl Into<String>) -> CommandError {
    CommandError {
        code: code.to_string(),
        message: message.into(),
        recovery_action: recovery_action.to_string(),
    }
}

fn launch_error(message: String) -> CommandError {
    if message.contains("端口") {
        command_error("port_unavailable", "changePort", message)
    } else if message.contains("llama-server") {
        command_error("server_unavailable", "selectBinary", message)
    } else if message.contains("模型") {
        command_error("model_unavailable", "selectModel", message)
    } else {
        command_error("launch_failed", "viewLogs", message)
    }
}

#[tauri::command]
pub fn validate_launch_config_command(config: LaunchConfig) -> ValidationResult {
    validate_launch_config(&config)
}

#[tauri::command]
pub fn build_command_args_command(config: LaunchConfig) -> Vec<String> {
    build_command_args(&config)
}

#[tauri::command]
pub async fn probe_llama_server_command(path: String) -> Result<ServerCapabilities, String> {
    tauri::async_runtime::spawn_blocking(move || probe_llama_server(&path))
        .await
        .map_err(|error| format!("llama-server 探测任务失败：{error}"))
}

#[tauri::command]
pub async fn build_command_spec_command(
    config: LaunchConfig,
    capabilities: Option<ServerCapabilities>,
) -> Result<CommandSpec, CommandError> {
    let binary_path = config.binary_path.clone().ok_or_else(|| {
        command_error(
            "server_required",
            "selectBinary",
            "未找到 llama-server，请选择可执行文件。",
        )
    })?;
    let capabilities = match capabilities
        .filter(|capabilities| capabilities.binary_path == binary_path)
    {
        Some(capabilities) => capabilities,
        None => tauri::async_runtime::spawn_blocking(move || probe_llama_server(&binary_path))
            .await
            .map_err(|error| command_error("probe_failed", "selectBinary", error.to_string()))?,
    };
    build_command_spec(&config, &capabilities).map_err(launch_error)
}

#[tauri::command]
pub async fn scan_model_directory_command(
    app: AppHandle,
    path: String,
    request_id: String,
) -> Result<ModelScanResult, String> {
    scan_model_directory_in_background(path, request_id, move |progress| {
        let _ = app.emit(MODEL_SCAN_PROGRESS_EVENT, progress);
    })
    .await
}

pub async fn scan_model_directory_in_background(
    path: String,
    request_id: String,
    mut on_progress: impl FnMut(ModelScanProgress) + Send + 'static,
) -> Result<ModelScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_model_directory_with_progress(path.as_ref(), request_id, |progress| {
            on_progress(progress.clone());
        })
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("model scan task failed: {error}"))?
}

#[tauri::command]
pub fn load_settings_command(
    app: AppHandle,
    store: State<'_, SettingsStore>,
) -> Result<SettingsEnvelope, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    store
        .load(&settings_path(app_data_dir))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reveal_settings_backup_command(app: AppHandle, path: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let command = build_settings_backup_reveal_command(
        &app_data_dir,
        path.as_ref(),
        RevealPlatform::current(),
    )
    .map_err(|error| error.to_string())?;
    launch_settings_backup_reveal_with(&command, |program, args| {
        Command::new(program).args(args).spawn()?;
        Ok(())
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resolve_llama_server_path_command(
    app: AppHandle,
    requested_path: Option<String>,
) -> Option<String> {
    let mut resource_dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        resource_dirs.push(resource_dir.join("binaries"));
        resource_dirs.push(resource_dir);
    }
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        resource_dirs.push(app_data_dir.join("binaries"));
    }
    resource_dirs.push(PathBuf::from("src-tauri").join("binaries"));

    resolve_llama_server_path(
        requested_path.as_deref(),
        &resource_dirs,
        &env::var("PATH").unwrap_or_default(),
    )
    .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn patch_settings_command(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    patch: serde_json::Value,
) -> Result<SettingsEnvelope, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    store
        .patch(&settings_path(app_data_dir), patch)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_legacy_chat_history_command(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    export_legacy_chat_history(&app_data_dir).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn start_llama_command(
    state: State<'_, LlamaProcessState>,
    config: LaunchConfig,
) -> Result<RuntimeSnapshot, CommandError> {
    let binary_path = config.binary_path.clone().ok_or_else(|| {
        command_error(
            "server_required",
            "selectBinary",
            "未找到 llama-server，请选择可执行文件。",
        )
    })?;
    let capabilities =
        tauri::async_runtime::spawn_blocking(move || probe_llama_server(&binary_path))
            .await
            .map_err(|error| command_error("probe_failed", "selectBinary", error.to_string()))?;
    if capabilities.status == ProbeStatus::Invalid {
        return Err(command_error(
            "server_incompatible",
            "selectBinary",
            capabilities.warnings.join("\n"),
        ));
    }
    let spec = build_command_spec(&config, &capabilities).map_err(launch_error)?;
    state.start_with_spec(config, spec).map_err(launch_error)
}

#[tauri::command]
pub fn stop_llama_command(
    state: State<'_, LlamaProcessState>,
) -> Result<RuntimeSnapshot, CommandError> {
    state
        .stop()
        .map_err(|message| command_error("stop_failed", "retryStop", message))
}

#[tauri::command]
pub async fn runtime_snapshot_command(
    state: State<'_, LlamaProcessState>,
) -> Result<RuntimeSnapshot, String> {
    Ok(state.refresh_snapshot())
}

#[tauri::command]
pub async fn check_health_command(host: String, port: u16) -> HealthStatus {
    check_http_health(&host, port, 2_000)
}

#[tauri::command]
pub fn find_available_port_command(host: String, preferred: u16) -> Result<u16, String> {
    find_available_port(&host, preferred, 200)
        .ok_or_else(|| "未找到可用端口，请手动选择端口。".to_string())
}

#[tauri::command]
pub fn set_tray_enabled_command(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    enabled: bool,
) -> Result<bool, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = settings_path(app_data_dir);
    store
        .set_tray_enabled(&path, enabled, |next| {
            if next {
                if !tray::is_tray_active(&app) {
                    tray::create_tray(&app)
                        .map(|_| ())
                        .map_err(|error| std::io::Error::other(error.to_string()))?;
                }
            } else {
                tray::destroy_tray(&app);
            }
            Ok(())
        })
        .map_err(|error| error.to_string())?;
    Ok(tray::is_tray_active(&app))
}

#[tauri::command]
pub fn get_tray_enabled_command(app: AppHandle) -> bool {
    tray::is_tray_active(&app)
}
