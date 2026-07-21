use illama_lib::gguf::{inspect_gguf, read_gguf_metadata, GgufStatus};
use std::{fs, io::Write};

#[test]
fn gguf_reader_skips_large_arrays_without_corrupting_following_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large-array.gguf");
    let mut bytes = Vec::new();

    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&3_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u64.to_le_bytes());
    bytes.extend_from_slice(&2_u64.to_le_bytes());

    write_string(&mut bytes, "test.large_array");
    bytes.extend_from_slice(&9_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&(1_048_577_u64).to_le_bytes());
    bytes.resize(bytes.len() + 1_048_577, 7);

    write_string(&mut bytes, "general.architecture");
    bytes.extend_from_slice(&8_u32.to_le_bytes());
    write_string(&mut bytes, "qwen3");

    fs::write(&path, bytes).unwrap();

    let metadata = read_gguf_metadata(&path).unwrap();

    assert_eq!(metadata.architecture.as_deref(), Some("qwen3"));
}

#[test]
fn classifies_supported_complete_headers_as_ready() {
    for version in [2_u32, 3_u32] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("ready-v{version}.gguf"));
        fs::write(&path, minimal_header(version, 0)).unwrap();

        let inspection = inspect_gguf(&path);

        assert_eq!(inspection.status, GgufStatus::Ready);
        assert_eq!(inspection.metadata.unwrap().version, version);
        assert_eq!(inspection.warning, None);
    }
}

#[test]
fn classifies_truncated_optional_metadata_as_limited() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("limited.gguf");
    let mut bytes = minimal_header(3, 1);
    write_string(&mut bytes, "general.architecture");
    bytes.extend_from_slice(&8_u32.to_le_bytes());
    bytes.extend_from_slice(&10_u64.to_le_bytes());
    bytes.extend_from_slice(b"qwen");
    fs::write(&path, bytes).unwrap();

    let inspection = inspect_gguf(&path);

    assert_eq!(inspection.status, GgufStatus::Limited);
    assert_eq!(inspection.metadata.unwrap().version, 3);
    assert!(inspection.warning.unwrap().contains("metadata"));
}

#[test]
fn rejects_wrong_magic_instead_of_treating_it_as_limited() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("wrong-magic.gguf");
    let mut bytes = minimal_header(3, 0);
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
    fs::write(&path, minimal_header(99, 0)).unwrap();

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

fn minimal_header(version: u32, metadata_count: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&version.to_le_bytes());
    bytes.extend_from_slice(&0_u64.to_le_bytes());
    bytes.extend_from_slice(&metadata_count.to_le_bytes());
    bytes
}

fn write_string(bytes: &mut Vec<u8>, value: &str) {
    bytes
        .write_all(&(value.len() as u64).to_le_bytes())
        .unwrap();
    bytes.write_all(value.as_bytes()).unwrap();
}
