pub mod acceptance;
pub mod commands;
pub mod gguf;
pub mod health;
pub mod legacy_chat_export;
pub mod llama_process;
pub mod model_scan;
pub mod monitor;
pub mod parameters;
pub mod server_probe;
pub mod settings;
pub mod tray;

use settings::settings_path;
use tauri::{Manager, WindowEvent};

pub fn run() {
    let acceptance_state = acceptance::NativeAcceptanceState::from_env()
        .expect("invalid native acceptance configuration");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(acceptance_state)
        .manage(llama_process::LlamaProcessState::default())
        .manage(settings::SettingsStore::default())
        .invoke_handler(tauri::generate_handler![
            commands::validate_launch_config_command,
            commands::build_command_args_command,
            commands::probe_llama_server_command,
            commands::build_command_spec_command,
            commands::scan_model_directory_command,
            commands::load_settings_command,
            commands::reveal_settings_backup_command,
            commands::resolve_llama_server_path_command,
            commands::patch_settings_command,
            commands::export_legacy_chat_history_command,
            commands::start_llama_command,
            commands::stop_llama_command,
            commands::runtime_snapshot_command,
            commands::check_health_command,
            commands::find_available_port_command,
            commands::set_tray_enabled_command,
            commands::get_tray_enabled_command,
            commands::native_acceptance_config_command,
            commands::native_acceptance_runner_started_command,
            commands::normal_acceptance_progress_command,
            commands::native_acceptance_settings_isolation_command,
            commands::write_native_acceptance_report_command,
            commands::finish_native_acceptance_command
        ])
        .setup(|app| {
            let acceptance: tauri::State<acceptance::NativeAcceptanceState> = app.state();
            acceptance.emit_marker(acceptance::NativeAcceptanceMarker::TauriSetup);
            let acceptance_config = acceptance.config().cloned();
            if let Some(config) = acceptance_config.as_ref() {
                if config.surface == "normal-app" {
                    if let Ok(app_data_dir) = app.path().app_data_dir() {
                        acceptance
                            .capture_user_settings(&settings_path(app_data_dir))
                            .map_err(std::io::Error::other)?;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        window.set_size(tauri::LogicalSize::new(
                            f64::from(config.viewport_width),
                            f64::from(config.viewport_height),
                        ))?;
                    }
                }
            } else if let Ok(app_data_dir) = app.path().app_data_dir() {
                // Normal launches retain the persisted tray preference. Acceptance launches never
                // read/migrate user settings or create/destroy a tray icon.
                let path = settings_path(app_data_dir);
                let store: tauri::State<settings::SettingsStore> = app.state();
                if let Ok(envelope) = store.load_for_setup(&path) {
                    if envelope.settings.ui.show_in_menu_bar {
                        let _ = tray::create_tray(app.handle());
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                {
                    let _ = window.hide();
                    api.prevent_close();
                }
                #[cfg(target_os = "windows")]
                if tray::is_tray_active(window.app_handle()) {
                    let _ = window.hide();
                    api.prevent_close();
                }
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                let _ = (window, api);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        tauri::RunEvent::Exit => {
            let state: tauri::State<llama_process::LlamaProcessState> = app_handle.state();
            let _ = state.stop();
        }
        _ => {}
    });
}
