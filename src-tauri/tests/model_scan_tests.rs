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

    let mut limited = header(3, 1, 0);
    write_string(&mut limited, "future-weight");
    limited.extend_from_slice(&1_u32.to_le_bytes());
    limited.extend_from_slice(&1_u64.to_le_bytes());
    limited.extend_from_slice(&u32::MAX.to_le_bytes());
    limited.extend_from_slice(&0_u64.to_le_bytes());
    let padding = (32 - (limited.len() % 32)) % 32;
    limited.resize(limited.len() + padding, 0);
    limited.push(0);
    fs::write(root.join("limited.gguf"), limited).unwrap();

    let mut invalid = minimal_valid_gguf(3);
    invalid[..4].copy_from_slice(b"NOPE");
    fs::write(root.join("invalid.gguf"), invalid).unwrap();
    write_minimal_gguf(&root.join("mmproj-vision.gguf"));
    fs::write(root.join("notes.txt"), "not a model").unwrap();

    let mut progress = Vec::new();
    let result = scan_model_directory_with_progress(root, "request-42".to_string(), |update| {
        progress.push(update.clone());
    })
    .unwrap();

    assert_eq!(result.request_id, "request-42");
    assert_eq!(result.directory, root.to_string_lossy());
    assert_eq!(result.models.len(), 3);
    assert_eq!(result.files_scanned, 5);
    assert_eq!(result.models_found, 2);
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
    assert_eq!(final_progress.files_scanned, 5);
    assert_eq!(final_progress.models_found, 2);
}

#[test]
fn a_header_only_candidate_is_invalid_and_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("truncated.gguf"), header(3, 1, 0)).unwrap();

    let models = scan_model_directory(dir.path()).unwrap();

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].metadata_status, MetadataStatus::Invalid);
    assert!(!models[0].available);
    assert!(models[0]
        .metadata_error
        .as_deref()
        .unwrap()
        .contains("tensor info"));
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
    assert_eq!(result.files_scanned, 1);
    assert_eq!(result.models_found, 1);
    assert_eq!(updates.lock().unwrap().last().unwrap().files_scanned, 1);
}

fn write_minimal_gguf(path: &Path) {
    fs::write(path, minimal_valid_gguf(3)).unwrap();
}

fn header(version: u32, tensor_count: u64, metadata_count: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&version.to_le_bytes());
    bytes.extend_from_slice(&tensor_count.to_le_bytes());
    bytes.extend_from_slice(&metadata_count.to_le_bytes());
    bytes
}

fn minimal_valid_gguf(version: u32) -> Vec<u8> {
    let mut bytes = header(version, 1, 0);
    append_f32_tensor(&mut bytes, "weight", &[2], &[0; 8]);
    bytes
}

fn append_f32_tensor(bytes: &mut Vec<u8>, name: &str, dimensions: &[u64], data: &[u8]) {
    write_string(bytes, name);
    bytes.extend_from_slice(&(dimensions.len() as u32).to_le_bytes());
    for dimension in dimensions {
        bytes.extend_from_slice(&dimension.to_le_bytes());
    }
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u64.to_le_bytes());
    let padding = (32 - (bytes.len() % 32)) % 32;
    bytes.resize(bytes.len() + padding, 0);
    bytes.extend_from_slice(data);
}

fn write_string(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend_from_slice(&(value.len() as u64).to_le_bytes());
    bytes.extend_from_slice(value.as_bytes());
}
