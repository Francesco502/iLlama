use illama_lib::gguf::{inspect_gguf, GgufStatus};
use std::{fs, io::Write};

#[test]
fn oversized_primitive_arrays_are_invalid_when_tensor_structure_cannot_be_verified() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large-array.gguf");
    let mut bytes = Vec::new();

    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&3_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u64.to_le_bytes());
    bytes.extend_from_slice(&1_u64.to_le_bytes());

    write_string(&mut bytes, "test.large_array");
    bytes.extend_from_slice(&9_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&(2 * 1024 * 1024_u64).to_le_bytes());
    bytes.resize(bytes.len() + 2 * 1024 * 1024, 7);
    append_f32_tensor(&mut bytes, "weight", &[2], &[0; 8]);

    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("budget"));
}

#[test]
fn oversized_string_arrays_are_invalid_when_tensor_structure_cannot_be_verified() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large-string-array.gguf");
    let mut bytes = header(3, 1, 1);
    write_string(&mut bytes, "tokenizer.ggml.tokens");
    bytes.extend_from_slice(&9_u32.to_le_bytes());
    bytes.extend_from_slice(&8_u32.to_le_bytes());
    bytes.extend_from_slice(&300_000_u64.to_le_bytes());
    for _ in 0..300_000 {
        bytes.extend_from_slice(&0_u64.to_le_bytes());
    }
    append_f32_tensor(&mut bytes, "weight", &[2], &[0; 8]);
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("element budget"));
}

#[test]
fn classifies_supported_complete_headers_as_ready() {
    for version in [2_u32, 3_u32] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("ready-v{version}.gguf"));
        fs::write(&path, minimal_valid_gguf(version)).unwrap();

        let inspection = inspect_gguf(&path);

        assert_eq!(inspection.status, GgufStatus::Ready);
        assert_eq!(inspection.metadata.unwrap().version, version);
        assert_eq!(inspection.warning, None);
    }
}

#[test]
fn rejects_truncated_metadata_when_required_tensor_sections_cannot_be_located() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("limited.gguf");
    let mut bytes = header(3, 1, 1);
    write_string(&mut bytes, "general.architecture");
    bytes.extend_from_slice(&8_u32.to_le_bytes());
    bytes.extend_from_slice(&10_u64.to_le_bytes());
    bytes.extend_from_slice(b"qwen");
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("metadata"));
}

#[test]
fn rejects_zero_tensor_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("header-only.gguf");
    fs::write(&path, header(3, 0, 0)).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("zero tensors"));
}

#[test]
fn rejects_a_tensor_count_without_tensor_info() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("missing-tensor-info.gguf");
    fs::write(&path, header(3, 1, 0)).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("tensor info"));
}

#[test]
fn rejects_truncated_tensor_info() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("truncated-tensor-info.gguf");
    let mut bytes = header(3, 1, 0);
    write_string(&mut bytes, "weight");
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("tensor info"));
}

#[test]
fn rejects_truncated_tensor_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("truncated-tensor-data.gguf");
    let mut bytes = header(3, 1, 0);
    append_f32_tensor(&mut bytes, "weight", &[2], &[0; 4]);
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("tensor data"));
}

#[test]
fn rejects_out_of_bounds_offsets_even_for_unknown_tensor_types() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("unknown-type-bad-offset.gguf");
    let mut bytes = header(3, 1, 0);
    append_tensor(&mut bytes, "weight", &[1], u32::MAX, 32, &[0]);
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("tensor data"));
}

#[test]
fn rejects_wrong_magic_instead_of_treating_it_as_limited() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("wrong-magic.gguf");
    let mut bytes = minimal_valid_gguf(3);
    bytes[..4].copy_from_slice(b"NOPE");
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("magic"));
}

#[test]
fn rejects_unsupported_versions() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("future.gguf");
    fs::write(&path, minimal_valid_gguf(99)).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("version 99"));
}

#[test]
fn rejects_structurally_incomplete_headers() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("broken-header.gguf");
    fs::write(&path, [b'G', b'G', b'U', b'F', 3, 0, 0, 0]).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("header"));
}

#[test]
fn rejects_structurally_impossible_header_counts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("impossible-header.gguf");
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&3_u32.to_le_bytes());
    bytes.extend_from_slice(&u64::MAX.to_le_bytes());
    bytes.extend_from_slice(&0_u64.to_le_bytes());
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("tensor count"));
}

#[test]
fn rejects_tensor_counts_above_the_bounded_inspection_limit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("too-many-tensors.gguf");
    fs::write(&path, header(3, 100_001, 0)).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(24 + 100_001 * 32)
        .unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Invalid);
    assert!(inspection.warning.unwrap().contains("inspection limit"));
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
    append_tensor(bytes, name, dimensions, 0, 0, data);
}

fn append_tensor(
    bytes: &mut Vec<u8>,
    name: &str,
    dimensions: &[u64],
    tensor_type: u32,
    offset: u64,
    data: &[u8],
) {
    write_string(bytes, name);
    bytes.extend_from_slice(&(dimensions.len() as u32).to_le_bytes());
    for dimension in dimensions {
        bytes.extend_from_slice(&dimension.to_le_bytes());
    }
    bytes.extend_from_slice(&tensor_type.to_le_bytes());
    bytes.extend_from_slice(&offset.to_le_bytes());
    let padding = (32 - (bytes.len() % 32)) % 32;
    bytes.resize(bytes.len() + padding, 0);
    bytes.extend_from_slice(data);
}

fn write_string(bytes: &mut Vec<u8>, value: &str) {
    bytes
        .write_all(&(value.len() as u64).to_le_bytes())
        .unwrap();
    bytes.write_all(value.as_bytes()).unwrap();
}
