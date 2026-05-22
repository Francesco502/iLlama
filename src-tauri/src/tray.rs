use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager,
};

use crate::llama_process::LlamaProcessState;

const TRAY_ID: &str = "illama-tray";

/// Create the system tray icon with a context menu.
pub fn create_tray(app: &AppHandle) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "显示 iLlama", true, None::<&str>)?;
    let stop_i = MenuItem::with_id(app, "stop", "停止模型", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出 iLlama", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &stop_i, &sep, &quit_i])?;

    let icon_bytes = include_bytes!("../icons/32x32.png");
    let icon = Image::from_bytes(icon_bytes)?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("iLlama")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "stop" => {
                let state: tauri::State<LlamaProcessState> = app.state();
                let _ = state.stop();
            }
            "quit" => {
                // Stop any running llama-server before quitting
                let state: tauri::State<LlamaProcessState> = app.state();
                let _ = state.stop();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(tray)
}

/// Remove the tray icon if it exists.
pub fn destroy_tray(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
        // Drop the tray reference — Tauri will clean up
        drop(tray);
    }
    // Remove from Tauri's internal tray registry
    let _ = app.remove_tray_by_id(TRAY_ID);
}

/// Check whether the tray icon is currently active.
pub fn is_tray_active(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}
