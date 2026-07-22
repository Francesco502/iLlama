use illama_lib::gguf::{inspect_gguf, GgufStatus};
use std::{fs, io::Write};

#[test]
fn oversized_primitive_arrays_are_limited_when_the_inspection_budget_is_exceeded() {
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

    assert_eq!(inspection.status, GgufStatus::Limited);
    assert_eq!(inspection.metadata.unwrap().version, 3);
    assert!(inspection.warning.unwrap().contains("budget"));
}

#[test]
fn oversized_string_arrays_are_limited_when_the_inspection_budget_is_exceeded() {
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

    assert_eq!(inspection.status, GgufStatus::Limited);
    assert_eq!(inspection.metadata.unwrap().version, 3);
    assert!(inspection.warning.unwrap().contains("element budget"));
}

#[test]
fn unknown_metadata_value_types_are_limited_after_a_valid_header() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("unknown-metadata-type.gguf");
    let mut bytes = header(3, 1, 1);
    write_string(&mut bytes, "future.metadata");
    bytes.extend_from_slice(&u32::MAX.to_le_bytes());
    append_f32_tensor(&mut bytes, "weight", &[2], &[0; 8]);
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Limited);
    assert_eq!(inspection.metadata.unwrap().version, 3);
    assert!(inspection
        .warning
        .unwrap()
        .contains("unsupported value type"));
}

#[test]
fn metadata_entry_count_above_the_inspection_budget_is_limited() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("many-metadata-entries.gguf");
    let mut bytes = header(3, 1, 513);
    for index in 0..513 {
        write_string(&mut bytes, &format!("test.entry.{index}"));
        bytes.extend_from_slice(&0_u32.to_le_bytes());
        bytes.push(0);
    }
    append_f32_tensor(&mut bytes, "weight", &[2], &[0; 8]);
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Limited);
    assert_eq!(inspection.metadata.unwrap().version, 3);
    assert!(inspection.warning.unwrap().contains("inspection limit"));
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
fn rejects_truncated_data_for_current_gguf_v3_tensor_types() {
    for (tensor_type, block_size) in [(34_u32, 256_u64), (35, 256), (39, 32), (40, 64), (41, 128)] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join(format!("truncated-type-{tensor_type}.gguf"));
        let mut bytes = header(3, 1, 0);
        append_tensor(&mut bytes, "weight", &[block_size], tensor_type, 0, &[0]);
        fs::write(&path, bytes).unwrap();

        let inspection = inspect_gguf(&path);

        assert_eq!(
            inspection.status,
            GgufStatus::Invalid,
            "tensor type {tensor_type} must not be launchable with truncated data"
        );
        assert!(inspection.warning.unwrap().contains("tensor data"));
    }
}

#[test]
fn accepts_complete_data_for_current_gguf_v3_tensor_types() {
    for (tensor_type, block_size, type_size) in [
        (34_u32, 256_u64, 54_usize),
        (35, 256, 66),
        (39, 32, 17),
        (40, 64, 36),
        (41, 128, 18),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("complete-type-{tensor_type}.gguf"));
        let mut bytes = header(3, 1, 0);
        append_tensor(
            &mut bytes,
            "weight",
            &[block_size],
            tensor_type,
            0,
            &vec![0; type_size],
        );
        fs::write(&path, bytes).unwrap();

        let inspection = inspect_gguf(&path);

        assert_eq!(
            inspection.status,
            GgufStatus::Ready,
            "tensor type {tensor_type} should be ready when its full block is present"
        );
    }
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
