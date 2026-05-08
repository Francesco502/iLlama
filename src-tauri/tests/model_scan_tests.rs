use illama_lib::model_scan::scan_model_directory;
use std::{fs, path::Path};

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

fn write_minimal_gguf(path: &Path) {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&3u32.to_le_bytes());
    bytes.extend_from_slice(&0u64.to_le_bytes());
    bytes.extend_from_slice(&0u64.to_le_bytes());
    fs::write(path, bytes).unwrap();
}
