use crate::{
    health::{check_http_health, find_available_port, HealthStatus},
    legacy_chat_export::export_legacy_chat_history,
    llama_process::{LlamaProcessState, RuntimeSnapshot},
    model_scan::{scan_model_directory, ModelEntry},
    parameters::{build_command_args, validate_launch_config, LaunchConfig, ValidationResult},
    server_probe::{
        build_command_spec, probe_llama_server, CommandSpec, ProbeStatus, ServerCapabilities,
    },
    settings::{
        load_settings_envelope_from, resolve_llama_server_path, settings_path, AppSettings,
        SettingsEnvelope, SettingsStore,
    },
    tray,
};
use std::{env, path::PathBuf};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn validate_launch_config_command(config: LaunchConfig) -> ValidationResult {
    validate_launch_config(&config)
}

#[tauri::command]
pub fn build_command_args_command(config: LaunchConfig) -> Vec<String> {
    build_command_args(&config)
}

#[tauri::command]
pub fn probe_llama_server_command(path: String) -> ServerCapabilities {
    probe_llama_server(&path)
}

#[tauri::command]
pub fn build_command_spec_command(config: LaunchConfig) -> Result<CommandSpec, String> {
    let binary_path = config
        .binary_path
        .as_deref()
        .ok_or_else(|| "未找到 llama-server，请选择可执行文件。".to_string())?;
    let capabilities = probe_llama_server(binary_path);
    build_command_spec(&config, &capabilities)
}

#[tauri::command]
pub async fn scan_model_directory_command(path: String) -> Result<Vec<ModelEntry>, String> {
    scan_model_directory(path.as_ref()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_settings_command(app: AppHandle) -> Result<SettingsEnvelope, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    load_settings_envelope_from(&settings_path(app_data_dir)).map_err(|error| error.to_string())
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
pub async fn save_settings_command(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    settings: AppSettings,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    store
        .save(&settings_path(app_data_dir), &settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn patch_settings_command(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    patch: serde_json::Value,
) -> Result<SettingsEnvelope, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let envelope = store
        .patch(&settings_path(app_data_dir), patch)
        .map_err(|error| error.to_string())?;
    if envelope.settings.ui.show_in_menu_bar {
        if !tray::is_tray_active(&app) {
            tray::create_tray(&app).map_err(|error| error.to_string())?;
        }
    } else {
        tray::destroy_tray(&app);
    }
    Ok(envelope)
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
pub fn start_llama_command(
    state: State<'_, LlamaProcessState>,
    config: LaunchConfig,
) -> Result<RuntimeSnapshot, String> {
    let binary_path = config
        .binary_path
        .as_deref()
        .ok_or_else(|| "未找到 llama-server，请选择可执行文件。".to_string())?;
    let capabilities = probe_llama_server(binary_path);
    if capabilities.status == ProbeStatus::Invalid {
        return Err(capabilities.warnings.join("\n"));
    }
    let spec = build_command_spec(&config, &capabilities)?;
    state.start_with_spec(config, spec)
}

#[tauri::command]
pub fn stop_llama_command(state: State<'_, LlamaProcessState>) -> Result<RuntimeSnapshot, String> {
    state.stop()
}

#[tauri::command]
pub async fn runtime_snapshot_command(
    state: State<'_, LlamaProcessState>,
) -> Result<RuntimeSnapshot, String> {
    Ok(state.refresh_snapshot())
}

#[tauri::command]
pub fn confirm_health_command(state: State<'_, LlamaProcessState>) {
    state.confirm_health();
}

#[tauri::command]
pub async fn check_health_command(host: String, port: u16) -> HealthStatus {
    check_http_health(&host, port, 500)
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
) -> Result<(), String> {
    if enabled {
        if !tray::is_tray_active(&app) {
            tray::create_tray(&app).map_err(|e| e.to_string())?;
        }
    } else {
        tray::destroy_tray(&app);
    }

    // Persist the preference
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = settings_path(app_data_dir);
    store
        .patch(
            &path,
            serde_json::json!({ "ui": { "showInMenuBar": enabled } }),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_tray_enabled_command(app: AppHandle) -> bool {
    tray::is_tray_active(&app)
}
