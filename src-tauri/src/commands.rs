use crate::{
    health::{check_http_health, find_available_port, HealthStatus},
    llama_process::{LlamaProcessState, RuntimeSnapshot},
    model_scan::{scan_model_directory, ModelEntry},
    parameters::{build_command_args, validate_launch_config, LaunchConfig, ValidationResult},
    settings::{
        load_settings_from, resolve_llama_server_path, save_settings_to, settings_path, AppSettings,
    },
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
pub fn scan_model_directory_command(path: String) -> Result<Vec<ModelEntry>, String> {
    scan_model_directory(path.as_ref()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_settings_command(app: AppHandle) -> Result<AppSettings, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    load_settings_from(&settings_path(app_data_dir)).map_err(|error| error.to_string())
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
pub fn save_settings_command(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    save_settings_to(&settings_path(app_data_dir), &settings).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn start_llama_command(
    state: State<'_, LlamaProcessState>,
    config: LaunchConfig,
) -> Result<RuntimeSnapshot, String> {
    state.start(config)
}

#[tauri::command]
pub fn stop_llama_command(state: State<'_, LlamaProcessState>) -> Result<RuntimeSnapshot, String> {
    state.stop()
}

#[tauri::command]
pub fn runtime_snapshot_command(state: State<'_, LlamaProcessState>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
pub fn confirm_health_command(state: State<'_, LlamaProcessState>) {
    state.confirm_health();
}

#[tauri::command]
pub fn check_health_command(host: String, port: u16) -> HealthStatus {
    check_http_health(&host, port, 500)
}

#[tauri::command]
pub fn find_available_port_command(host: String, preferred: u16) -> Result<u16, String> {
    find_available_port(&host, preferred, 200)
        .ok_or_else(|| "未找到可用端口，请手动选择端口。".to_string())
}
