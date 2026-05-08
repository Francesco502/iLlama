use illama_lib::settings::{
    default_settings, detect_llama_server_in_path, load_settings_from, resolve_llama_server_path,
    save_settings_to,
};
use std::fs;

#[test]
fn creates_default_settings_when_file_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");

    let settings = load_settings_from(&path).unwrap();

    assert_eq!(settings.schema_version, 1);
    assert!(settings.model_directories.is_empty());
    assert_eq!(settings.default_preset_id, "balanced");
    assert_eq!(settings.default_port, 8080);
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
    let binary = dir.path().join("llama-server");
    fs::write(&binary, "").unwrap();

    let detected = detect_llama_server_in_path(&dir.path().to_string_lossy()).unwrap();

    assert_eq!(detected, binary);
}

#[test]
fn resolves_packaged_sidecar_before_path_fallback() {
    let resource_dir = tempfile::tempdir().unwrap();
    let path_dir = tempfile::tempdir().unwrap();
    let sidecar = resource_dir
        .path()
        .join("llama-server-aarch64-apple-darwin");
    let path_binary = path_dir.path().join("llama-server");
    fs::write(&sidecar, "").unwrap();
    fs::write(&path_binary, "").unwrap();

    let resolved = resolve_llama_server_path(
        None,
        &[resource_dir.path().to_path_buf()],
        &path_dir.path().to_string_lossy(),
    )
    .unwrap();

    assert_eq!(resolved, sidecar);
}

#[test]
fn explicit_existing_binary_path_wins_over_sidecar() {
    let resource_dir = tempfile::tempdir().unwrap();
    let explicit_dir = tempfile::tempdir().unwrap();
    let sidecar = resource_dir
        .path()
        .join("llama-server-aarch64-apple-darwin");
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
