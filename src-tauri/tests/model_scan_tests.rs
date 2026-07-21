use illama_lib::model_scan::{
    scan_model_directory, scan_model_directory_with_progress, MetadataStatus,
};
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

#[test]
fn scans_only_gguf_files_below_selected_directory() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let nested = root.join("nested");
    fs::create_dir(&nested).unwrap();
    write_minimal_gguf(&root.join("model-a.gguf"));
    write_minimal_gguf(&nested.join("model-b.GGUF"));
    fs::write(root.join("notes.txt"), "not a model").unwrap();

    let models = scan_model_directory(root).unwrap();

    let names: Vec<_> = models.into_iter().map(|model| model.file_name).collect();
    assert_eq!(names, vec!["model-a.gguf", "model-b.GGUF"]);
}

#[test]
fn ignores_hidden_directories() {
    let dir = tempfile::tempdir().unwrap();
    let hidden = dir.path().join(".cache");
    fs::create_dir(&hidden).unwrap();
    write_minimal_gguf(&hidden.join("hidden.gguf"));

    let models = scan_model_directory(dir.path()).unwrap();

    assert!(models.is_empty());
}

#[test]
fn treats_mmproj_files_as_multimodal_candidates_not_models() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write_minimal_gguf(&root.join("qwen2_5-vl.gguf"));
    write_minimal_gguf(&root.join("mmproj-qwen2_5-vl.gguf"));

    let models = scan_model_directory(root).unwrap();

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].file_name, "qwen2_5-vl.gguf");
    assert_eq!(models[0].mmproj_candidates.len(), 1);
    assert!(models[0].mmproj_candidates[0].ends_with("mmproj-qwen2_5-vl.gguf"));
}

#[test]
fn classifies_ready_limited_and_invalid_models_and_reports_progress_envelope() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write_minimal_gguf(&root.join("ready.gguf"));

    let mut limited = minimal_header(3, 1);
    write_string(&mut limited, "general.architecture");
    limited.extend_from_slice(&8_u32.to_le_bytes());
    limited.extend_from_slice(&5_u64.to_le_bytes());
    limited.extend_from_slice(b"qw");
    fs::write(root.join("limited.gguf"), limited).unwrap();

    let mut invalid = minimal_header(99, 0);
    invalid[..4].copy_from_slice(b"NOPE");
    fs::write(root.join("invalid.gguf"), invalid).unwrap();

    let mut progress = Vec::new();
    let result = scan_model_directory_with_progress(root, "request-42".to_string(), |update| {
        progress.push(update.clone());
    })
    .unwrap();

    assert_eq!(result.request_id, "request-42");
    assert_eq!(result.directory, root.to_string_lossy());
    assert_eq!(result.models.len(), 3);
    assert_eq!(
        result
            .models
            .iter()
            .map(|model| (&model.metadata_status, model.available))
            .collect::<Vec<_>>(),
        vec![
            (&MetadataStatus::Invalid, false),
            (&MetadataStatus::Limited, true),
            (&MetadataStatus::Ready, true),
        ]
    );
    let final_progress = progress.last().unwrap();
    assert_eq!(final_progress.request_id, "request-42");
    assert_eq!(final_progress.directory, root.to_string_lossy());
    assert_eq!(final_progress.files_scanned, 3);
    assert_eq!(final_progress.models_found, 3);
}

#[tokio::test]
async fn background_scan_preserves_request_id_and_emits_progress() {
    let dir = tempfile::tempdir().unwrap();
    write_minimal_gguf(&dir.path().join("ready.gguf"));
    let updates = Arc::new(Mutex::new(Vec::new()));
    let captured_updates = Arc::clone(&updates);

    let result = illama_lib::commands::scan_model_directory_in_background(
        dir.path().to_string_lossy().to_string(),
        "async-request".to_string(),
        move |progress| captured_updates.lock().unwrap().push(progress),
    )
    .await
    .unwrap();

    assert_eq!(result.request_id, "async-request");
    assert_eq!(result.models.len(), 1);
    assert_eq!(updates.lock().unwrap().last().unwrap().files_scanned, 1);
}

fn write_minimal_gguf(path: &Path) {
    fs::write(path, minimal_header(3, 0)).unwrap();
}

fn minimal_header(version: u32, metadata_count: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&version.to_le_bytes());
    bytes.extend_from_slice(&0_u64.to_le_bytes());
    bytes.extend_from_slice(&metadata_count.to_le_bytes());
    bytes
}

fn write_string(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend_from_slice(&(value.len() as u64).to_le_bytes());
    bytes.extend_from_slice(value.as_bytes());
}
