use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{self, Read},
    path::Path,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GgufMetadata {
    pub version: u32,
    pub architecture: Option<String>,
    pub quantization: Option<String>,
    pub context_length: Option<u64>,
    pub parameter_count: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GgufStatus {
    Ready,
    Limited,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GgufInspection {
    pub status: GgufStatus,
    pub metadata: Option<GgufMetadata>,
    pub warning: Option<String>,
}

const SUPPORTED_GGUF_VERSIONS: [u32; 2] = [2, 3];
const MAX_INSPECTED_METADATA_ENTRIES: u64 = 512;

pub fn read_gguf_metadata(path: &Path) -> io::Result<GgufMetadata> {
    let inspection = inspect_gguf(path);
    inspection.metadata.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            inspection
                .warning
                .unwrap_or_else(|| "invalid GGUF file".to_string()),
        )
    })
}

pub fn inspect_gguf(path: &Path) -> GgufInspection {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) => return invalid_inspection(format!("unable to open GGUF file: {error}")),
    };
    let mut magic = [0u8; 4];
    if let Err(error) = file.read_exact(&mut magic) {
        return invalid_inspection(format!("GGUF header is truncated: {error}"));
    }
    if &magic != b"GGUF" {
        return invalid_inspection("invalid GGUF magic".to_string());
    }

    let version = match read_u32(&mut file) {
        Ok(version) => version,
        Err(error) => return invalid_inspection(format!("GGUF header is truncated: {error}")),
    };
    if !SUPPORTED_GGUF_VERSIONS.contains(&version) {
        return invalid_inspection(format!("unsupported GGUF version {version}"));
    }
    let (tensor_count, metadata_count) = match (read_u64(&mut file), read_u64(&mut file)) {
        (Ok(tensor_count), Ok(metadata_count)) => (tensor_count, metadata_count),
        _ => return invalid_inspection("GGUF header is structurally incomplete".to_string()),
    };
    if tensor_count > i64::MAX as u64 {
        return invalid_inspection(format!(
            "GGUF tensor count {tensor_count} is structurally impossible"
        ));
    }
    if metadata_count > i64::MAX as u64 {
        return invalid_inspection(format!(
            "GGUF metadata count {metadata_count} is structurally impossible"
        ));
    }
    let mut metadata = GgufMetadata {
        version,
        ..GgufMetadata::default()
    };

    for _ in 0..metadata_count.min(MAX_INSPECTED_METADATA_ENTRIES) {
        if let Err(error) = read_metadata_entry(&mut file, &mut metadata) {
            return GgufInspection {
                status: GgufStatus::Limited,
                metadata: Some(metadata),
                warning: Some(format!(
                    "GGUF metadata could not be read completely: {error}"
                )),
            };
        }
    }

    if metadata_count > MAX_INSPECTED_METADATA_ENTRIES {
        return GgufInspection {
            status: GgufStatus::Limited,
            metadata: Some(metadata),
            warning: Some(format!(
                "GGUF metadata exceeds the inspection limit of {MAX_INSPECTED_METADATA_ENTRIES} entries"
            )),
        };
    }

    GgufInspection {
        status: GgufStatus::Ready,
        metadata: Some(metadata),
        warning: None,
    }
}

fn invalid_inspection(warning: String) -> GgufInspection {
    GgufInspection {
        status: GgufStatus::Invalid,
        metadata: None,
        warning: Some(warning),
    }
}

fn read_metadata_entry(reader: &mut impl Read, metadata: &mut GgufMetadata) -> io::Result<()> {
    let key = read_string(reader)?;
    let value_type = read_u32(reader)?;
    match value_type {
        4 => {
            let value = read_u32(reader)?;
            if key.ends_with(".context_length") {
                metadata.context_length = Some(value as u64);
            } else if key == "general.file_type" {
                metadata.quantization = Some(file_type_to_quantization(value));
            }
        }
        8 => {
            let value = read_string(reader)?;
            match key.as_str() {
                "general.architecture" => metadata.architecture = Some(value),
                "general.size_label" => metadata.parameter_count = Some(value),
                _ => {}
            }
        }
        10 => {
            let value = read_u64(reader)?;
            if key.ends_with(".context_length") {
                metadata.context_length = Some(value);
            }
        }
        _ => skip_scalar_value(reader, value_type)?,
    }
    Ok(())
}

/// Map the GGUF `general.file_type` integer to a human-readable quantization name.
fn file_type_to_quantization(file_type: u32) -> String {
    match file_type {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        6 => "Q5_0",
        7 => "Q5_1",
        8 => "Q8_0",
        9 => "Q8_1",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        19 => "IQ2_XXS",
        20 => "IQ2_XS",
        21 => "IQ3_XXS",
        22 => "IQ1_S",
        23 => "IQ4_NL",
        24 => "IQ3_S",
        25 => "IQ2_S",
        26 => "IQ4_XS",
        27 => "IQ1_M",
        28 => "BF16",
        29 => "Q4_0_4_4",
        30 => "Q4_0_4_8",
        31 => "Q4_0_8_8",
        _ => return format!("type_{file_type}"),
    }
    .to_string()
}

fn read_u32(reader: &mut impl Read) -> io::Result<u32> {
    let mut bytes = [0u8; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(reader: &mut impl Read) -> io::Result<u64> {
    let mut bytes = [0u8; 8];
    reader.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_string(reader: &mut impl Read) -> io::Result<String> {
    let len = read_u64(reader)? as usize;
    if len > 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "GGUF string too large",
        ));
    }
    let mut bytes = vec![0u8; len];
    reader.read_exact(&mut bytes)?;
    String::from_utf8(bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid UTF-8"))
}

fn skip_scalar_value(reader: &mut impl Read, value_type: u32) -> io::Result<()> {
    let bytes = match value_type {
        0 | 1 | 7 => 1,
        2 | 3 => 2,
        5 | 6 => 4,
        11 | 12 => 8,
        9 => return skip_array(reader),
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unsupported GGUF value type",
            ))
        }
    };
    let mut buffer = vec![0u8; bytes];
    reader.read_exact(&mut buffer)
}

fn skip_array(reader: &mut impl Read) -> io::Result<()> {
    let element_type = read_u32(reader)?;
    let len = read_u64(reader)? as usize;
    let element_size = match element_type {
        0 | 1 | 7 => 1,
        2 | 3 => 2,
        4..=6 => 4,
        8 => {
            for _ in 0..len {
                let _ = read_string(reader)?;
            }
            return Ok(());
        }
        10..=12 => 8,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unsupported GGUF array type",
            ))
        }
    };
    skip_exact(reader, len.saturating_mul(element_size))
}

fn skip_exact(reader: &mut impl Read, bytes: usize) -> io::Result<()> {
    let mut remaining = bytes;
    let mut buffer = [0_u8; 8192];
    while remaining > 0 {
        let chunk = remaining.min(buffer.len());
        reader.read_exact(&mut buffer[..chunk])?;
        remaining -= chunk;
    }
    Ok(())
}
