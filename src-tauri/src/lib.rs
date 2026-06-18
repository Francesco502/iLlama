pub mod commands;
pub mod gguf;
pub mod health;
pub mod legacy_chat_export;
pub mod llama_process;
pub mod model_scan;
pub mod monitor;
pub mod parameters;
pub mod settings;
pub mod tray;

use settings::{load_settings_from, settings_path};
use tauri::{Manager, WindowEvent};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(llama_process::LlamaProcessState::default())
        .invoke_handler(tauri::generate_handler![
            commands::validate_launch_config_command,
            commands::build_command_args_command,
            commands::scan_model_directory_command,
            commands::load_settings_command,
            commands::resolve_llama_server_path_command,
            commands::save_settings_command,
            commands::export_legacy_chat_history_command,
            commands::start_llama_command,
            commands::stop_llama_command,
            commands::runtime_snapshot_command,
            commands::confirm_health_command,
            commands::check_health_command,
            commands::find_available_port_command,
            commands::set_tray_enabled_command,
            commands::get_tray_enabled_command
        ])
        .setup(|app| {
            // Read persisted setting; create tray if enabled
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let path = settings_path(app_data_dir);
                if let Ok(settings) = load_settings_from(&path) {
                    if settings.show_in_menu_bar {
                        let _ = tray::create_tray(app.handle());
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
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
