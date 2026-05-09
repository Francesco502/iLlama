pub mod chat_history;
pub mod commands;
pub mod gguf;
pub mod health;
pub mod llama_process;
pub mod model_scan;
pub mod monitor;
pub mod parameters;
pub mod settings;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(llama_process::LlamaProcessState::default())
        .invoke_handler(tauri::generate_handler![
            commands::validate_launch_config_command,
            commands::build_command_args_command,
            commands::scan_model_directory_command,
            commands::load_settings_command,
            commands::resolve_llama_server_path_command,
            commands::save_settings_command,
            commands::start_llama_command,
            commands::stop_llama_command,
            commands::runtime_snapshot_command,
            commands::confirm_health_command,
            commands::check_health_command,
            commands::find_available_port_command,
            commands::load_chat_history_index_command,
            commands::load_chat_conversation_command,
            commands::save_chat_conversation_command,
            commands::delete_chat_conversation_command,
            commands::export_chat_conversation_command,
            commands::clear_chat_history_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
