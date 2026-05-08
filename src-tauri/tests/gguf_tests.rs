use illama_lib::gguf::read_gguf_metadata;
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

fn write_string(bytes: &mut Vec<u8>, value: &str) {
    bytes
        .write_all(&(value.len() as u64).to_le_bytes())
        .unwrap();
    bytes.write_all(value.as_bytes()).unwrap();
}
