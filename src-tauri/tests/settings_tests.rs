use illama_lib::settings::{
    default_settings, detect_llama_server_in_path, load_settings_envelope_from, load_settings_from,
    patch_settings_to, resolve_llama_server_path, save_settings_to,
};
use serde_json::json;
use std::{env, fs, path::Path};

#[test]
fn creates_default_settings_when_file_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    let settings = load_settings_from(&path).unwrap();

    assert_eq!(settings.schema_version, 3);
    assert!(settings.model_directories.is_empty());
    assert_eq!(settings.launch_draft.profile_id, "auto");
    assert_eq!(
        settings.launch_draft.parameter_preset_source_id,
        "model-family:auto"
    );
    assert_eq!(settings.launch_draft.port, 8080);
    assert_eq!(settings.sampling.max_tokens, 2048);
    assert!(!settings.ui.show_in_menu_bar);
    assert_eq!(settings.ui.log_panel_height, 180);
}

#[test]
fn migrates_v2_settings_to_v3_without_losing_launcher_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    fs::write(
        &path,
        r#"{
          "schemaVersion": 2,
          "modelDirectories": ["/models"],
          "llamaServerPath": "/usr/local/bin/llama-server",
          "defaultPresetId": "custom",
          "parameterPresetSourceId": "user:precise",
          "lastSelectedModelPath": "/models/demo.gguf",
          "autoPort": true,
          "defaultPort": 9090,
          "idleSleepSeconds": 30,
          "showInMenuBar": true
        }"#,
    )
    .unwrap();

    let envelope = load_settings_envelope_from(&path).unwrap();
    let loaded = envelope.settings;

    assert_eq!(loaded.schema_version, 3);
    assert_eq!(loaded.model_directories, vec!["/models"]);
    assert_eq!(loaded.launch_draft.profile_id, "custom");
    assert_eq!(
        loaded.launch_draft.parameter_preset_source_id,
        "user:precise"
    );
    assert_eq!(
        loaded.launch_draft.selected_model_path.as_deref(),
        Some("/models/demo.gguf")
    );
    assert_eq!(loaded.launch_draft.port, 9090);
    assert_eq!(loaded.launch_draft.parameters.idle_sleep_seconds, 30);
    assert!(loaded.ui.show_in_menu_bar);
    assert!(envelope
        .warnings
        .iter()
        .any(|warning| warning.code == "settings_migrated"));
    let persisted: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(persisted["schemaVersion"], 3);
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

    assert_eq!(loaded.launch_draft.profile_id, "custom");
}

#[test]
fn normalizes_unknown_parameter_source_to_model_family_auto() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    fs::write(
        &path,
        r#"{
          "schemaVersion": 2,
          "modelDirectories": [],
          "llamaServerPath": null,
          "defaultPresetId": "custom",
          "parameterPresetSourceId": "user:removed",
          "lastSelectedModelPath": null,
          "autoPort": true,
          "defaultPort": 8080,
          "idleSleepSeconds": 0
        }"#,
    )
    .unwrap();

    let loaded = load_settings_from(&path).unwrap();

    assert_eq!(
        loaded.launch_draft.parameter_preset_source_id,
        "model-family:auto"
    );
}

#[test]
fn round_trips_settings_json() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut settings = default_settings();
    settings.model_directories.push("/models".into());
    settings.llama_server_path = Some("/usr/local/bin/llama-server".into());
    settings.launch_draft.parameters.ctx_size = 16_384;
    settings.sampling.temperature = 0.3;

    save_settings_to(&path, &settings).unwrap();
    let loaded = load_settings_from(&path).unwrap();

    assert_eq!(loaded.model_directories, vec!["/models"]);
    assert_eq!(
        loaded.llama_server_path.as_deref(),
        Some("/usr/local/bin/llama-server")
    );
    assert_eq!(loaded.launch_draft.parameters.ctx_size, 16_384);
    assert_eq!(loaded.sampling.temperature, 0.3);
}

#[test]
fn corrupt_settings_are_backed_up_and_replaced_with_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    fs::write(&path, "{ definitely not json").unwrap();

    let envelope = load_settings_envelope_from(&path).unwrap();

    assert_eq!(envelope.settings.schema_version, 3);
    assert!(envelope
        .warnings
        .iter()
        .any(|warning| warning.code == "settings_recovered"));
    let backups = fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("settings.corrupt-")
        })
        .count();
    assert_eq!(backups, 1);
    assert!(serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&path).unwrap()).is_ok());
}

#[test]
fn settings_patch_preserves_unmentioned_sections_and_allows_explicit_null() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut settings = default_settings();
    settings.llama_server_path = Some("/tmp/llama-server".into());
    save_settings_to(&path, &settings).unwrap();

    let patched = patch_settings_to(
        &path,
        json!({
            "llamaServerPath": null,
            "launchDraft": { "port": 9091 },
            "ui": { "logPanelOpen": true }
        }),
    )
    .unwrap()
    .settings;

    assert_eq!(patched.llama_server_path, None);
    assert_eq!(patched.launch_draft.port, 9091);
    assert_eq!(
        patched.launch_draft.parameters.ctx_size,
        settings.launch_draft.parameters.ctx_size
    );
    assert!(patched.ui.log_panel_open);
    assert_eq!(patched.ui.log_panel_height, 180);
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
