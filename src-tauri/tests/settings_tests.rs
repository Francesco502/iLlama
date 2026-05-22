use illama_lib::settings::{
    default_settings, detect_llama_server_in_path, load_settings_from, resolve_llama_server_path,
    save_settings_to,
};
use std::{env, fs, path::Path};

#[test]
fn creates_default_settings_when_file_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    let settings = load_settings_from(&path).unwrap();

    assert_eq!(settings.schema_version, 2);
    assert!(settings.model_directories.is_empty());
    assert_eq!(settings.default_preset_id, "max-capability");
    assert_eq!(settings.default_port, 8080);
    assert!(!settings.chat_history.enabled);
    assert_eq!(settings.chat_history.image_persistence, "none");
}

#[test]
fn migrates_v1_chat_history_setting_to_v2() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    fs::write(
        &path,
        r#"{
          "schemaVersion": 1,
          "modelDirectories": [],
          "llamaServerPath": null,
          "defaultPresetId": "balanced",
          "lastSelectedModelPath": null,
          "autoPort": true,
          "defaultPort": 8080,
          "idleSleepSeconds": 0,
          "saveChatHistory": false
        }"#,
    )
    .unwrap();

    let loaded = load_settings_from(&path).unwrap();

    assert_eq!(loaded.schema_version, 2);
    assert!(!loaded.chat_history.enabled);
    assert_eq!(loaded.chat_history.image_persistence, "none");
    assert!(!loaded.chat_history.include_reasoning_in_export_default);
    assert_eq!(loaded.chat_history.max_conversations, 200);
}

#[test]
fn migrates_old_parameter_presets_to_custom_mode() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    fs::write(
        &path,
        r#"{
          "schemaVersion": 2,
          "modelDirectories": [],
          "llamaServerPath": null,
          "defaultPresetId": "performance",
          "lastSelectedModelPath": null,
          "autoPort": true,
          "defaultPort": 8080,
          "idleSleepSeconds": 0
        }"#,
    )
    .unwrap();

    let loaded = load_settings_from(&path).unwrap();

    assert_eq!(loaded.default_preset_id, "custom");
}

#[test]
fn round_trips_settings_json() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut settings = default_settings();
    settings.model_directories.push("/models".into());
    settings.llama_server_path = Some("/usr/local/bin/llama-server".into());

    save_settings_to(&path, &settings).unwrap();
    let loaded = load_settings_from(&path).unwrap();

    assert_eq!(loaded.model_directories, vec!["/models"]);
    assert_eq!(
        loaded.llama_server_path.as_deref(),
        Some("/usr/local/bin/llama-server")
    );
}

#[test]
fn detects_llama_server_from_path_env() {
    let dir = tempfile::tempdir().unwrap();
    let binary = dir.path().join(llama_server_binary_name());
    fs::write(&binary, "").unwrap();

    let detected = detect_llama_server_in_path(&path_env_for(dir.path())).unwrap();

    assert_eq!(detected, binary);
}

#[test]
fn resolves_packaged_sidecar_before_path_fallback() {
    let resource_dir = tempfile::tempdir().unwrap();
    let path_dir = tempfile::tempdir().unwrap();
    let sidecar = resource_dir.path().join(llama_server_sidecar_name());
    let path_binary = path_dir.path().join(llama_server_binary_name());
    fs::write(&sidecar, "").unwrap();
    fs::write(&path_binary, "").unwrap();

    let resolved = resolve_llama_server_path(
        None,
        &[resource_dir.path().to_path_buf()],
        &path_env_for(path_dir.path()),
    )
    .unwrap();

    assert_eq!(resolved, sidecar);
}

#[test]
fn explicit_existing_binary_path_wins_over_sidecar() {
    let resource_dir = tempfile::tempdir().unwrap();
    let explicit_dir = tempfile::tempdir().unwrap();
    let sidecar = resource_dir.path().join(llama_server_sidecar_name());
    let explicit = explicit_dir.path().join("custom-server");
    fs::write(&sidecar, "").unwrap();
    fs::write(&explicit, "").unwrap();

    let resolved = resolve_llama_server_path(
        Some(explicit.to_string_lossy().as_ref()),
        &[resource_dir.path().to_path_buf()],
        "",
    )
    .unwrap();

    assert_eq!(resolved, explicit);
}

fn llama_server_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

fn llama_server_sidecar_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server-x86_64-pc-windows-msvc.exe"
    } else {
        "llama-server-aarch64-apple-darwin"
    }
}

fn path_env_for(dir: &Path) -> String {
    env::join_paths([dir])
        .unwrap()
        .to_string_lossy()
        .into_owned()
}
