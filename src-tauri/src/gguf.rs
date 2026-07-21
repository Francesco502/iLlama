use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{self, Read, Seek},
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
const MAX_METADATA_BYTES: u64 = 1024 * 1024;
const MAX_METADATA_STRING_ELEMENTS: u64 = 262_144;
const DEFAULT_ALIGNMENT: u64 = 32;
const MAX_TENSOR_NAME_BYTES: u64 = 64;
const MAX_TENSOR_DIMENSIONS: u32 = 4;

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
    let file_len = match file.metadata() {
        Ok(metadata) => metadata.len(),
        Err(error) => return invalid_inspection(format!("unable to inspect GGUF file: {error}")),
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
    if tensor_count == 0 {
        return invalid_inspection("GGUF model declares zero tensors".to_string());
    }
    let mut metadata = GgufMetadata {
        version,
        ..GgufMetadata::default()
    };
    let mut alignment = DEFAULT_ALIGNMENT;
    let mut budget = MetadataBudget::new();

    for _ in 0..metadata_count.min(MAX_INSPECTED_METADATA_ENTRIES) {
        if let Err(error) =
            read_metadata_entry(&mut file, &mut metadata, &mut alignment, &mut budget)
        {
            return inspection_from_parse_error(error, metadata);
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

    if alignment == 0 || !alignment.is_multiple_of(8) {
        return invalid_inspection(format!(
            "GGUF metadata specifies invalid alignment {alignment}"
        ));
    }

    if let Err(error) = validate_tensor_sections(&mut file, file_len, tensor_count, alignment) {
        return inspection_from_parse_error(error, metadata);
    }

    GgufInspection {
        status: GgufStatus::Ready,
        metadata: Some(metadata),
        warning: None,
    }
}

fn inspection_from_parse_error(error: ParseError, metadata: GgufMetadata) -> GgufInspection {
    match error {
        ParseError::Limited(message) => GgufInspection {
            status: GgufStatus::Limited,
            metadata: Some(metadata),
            warning: Some(message),
        },
        ParseError::Invalid(message) => invalid_inspection(message),
    }
}

fn invalid_inspection(warning: String) -> GgufInspection {
    GgufInspection {
        status: GgufStatus::Invalid,
        metadata: None,
        warning: Some(warning),
    }
}

#[derive(Debug)]
enum ParseError {
    Limited(String),
    Invalid(String),
}

impl ParseError {
    fn metadata_io(error: io::Error) -> Self {
        Self::Invalid(format!("GGUF metadata is structurally incomplete: {error}"))
    }

    fn tensor_io(error: io::Error) -> Self {
        Self::Invalid(format!("GGUF tensor info is truncated: {error}"))
    }
}

struct MetadataBudget {
    bytes_read: u64,
    string_elements: u64,
}

impl MetadataBudget {
    fn new() -> Self {
        Self {
            bytes_read: 0,
            string_elements: 0,
        }
    }

    fn consume_bytes(&mut self, bytes: u64) -> Result<(), ParseError> {
        let total = self.bytes_read.checked_add(bytes).ok_or_else(|| {
            ParseError::Limited("GGUF metadata byte budget overflowed".to_string())
        })?;
        if total > MAX_METADATA_BYTES {
            return Err(ParseError::Limited(format!(
                "GGUF metadata exceeds the {MAX_METADATA_BYTES}-byte inspection budget"
            )));
        }
        self.bytes_read = total;
        Ok(())
    }

    fn consume_string_elements(&mut self, elements: u64) -> Result<(), ParseError> {
        let total = self.string_elements.checked_add(elements).ok_or_else(|| {
            ParseError::Limited("GGUF metadata string element budget overflowed".to_string())
        })?;
        if total > MAX_METADATA_STRING_ELEMENTS {
            return Err(ParseError::Limited(format!(
                "GGUF metadata exceeds the {MAX_METADATA_STRING_ELEMENTS}-element budget"
            )));
        }
        self.string_elements = total;
        Ok(())
    }
}

fn read_metadata_entry(
    reader: &mut impl Read,
    metadata: &mut GgufMetadata,
    alignment: &mut u64,
    budget: &mut MetadataBudget,
) -> Result<(), ParseError> {
    let key = read_budgeted_string(reader, budget)?;
    let value_type = read_budgeted_u32(reader, budget)?;
    match value_type {
        4 => {
            let value = read_budgeted_u32(reader, budget)?;
            if key.ends_with(".context_length") {
                metadata.context_length = Some(value as u64);
            } else if key == "general.file_type" {
                metadata.quantization = Some(file_type_to_quantization(value));
            } else if key == "general.alignment" {
                *alignment = value as u64;
            }
        }
        8 => {
            let value = read_budgeted_string(reader, budget)?;
            match key.as_str() {
                "general.architecture" => metadata.architecture = Some(value),
                "general.size_label" => metadata.parameter_count = Some(value),
                _ => {}
            }
        }
        10 => {
            let value = read_budgeted_u64(reader, budget)?;
            if key.ends_with(".context_length") {
                metadata.context_length = Some(value);
            }
        }
        _ => skip_scalar_value(reader, value_type, budget)?,
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

fn read_budgeted_u32(
    reader: &mut impl Read,
    budget: &mut MetadataBudget,
) -> Result<u32, ParseError> {
    budget.consume_bytes(4)?;
    read_u32(reader).map_err(ParseError::metadata_io)
}

fn read_budgeted_u64(
    reader: &mut impl Read,
    budget: &mut MetadataBudget,
) -> Result<u64, ParseError> {
    budget.consume_bytes(8)?;
    read_u64(reader).map_err(ParseError::metadata_io)
}

fn read_budgeted_string(
    reader: &mut impl Read,
    budget: &mut MetadataBudget,
) -> Result<String, ParseError> {
    let len = read_budgeted_u64(reader, budget)?;
    budget.consume_bytes(len)?;
    let len = usize::try_from(len).map_err(|_| {
        ParseError::Limited("GGUF string length does not fit this platform".to_string())
    })?;
    let mut bytes = vec![0u8; len];
    reader
        .read_exact(&mut bytes)
        .map_err(ParseError::metadata_io)?;
    String::from_utf8(bytes)
        .map_err(|_| ParseError::Invalid("GGUF metadata contains invalid UTF-8".to_string()))
}

fn skip_scalar_value(
    reader: &mut impl Read,
    value_type: u32,
    budget: &mut MetadataBudget,
) -> Result<(), ParseError> {
    let bytes = match value_type {
        0 | 1 | 7 => 1,
        2 | 3 => 2,
        5 | 6 => 4,
        11 | 12 => 8,
        9 => return skip_array(reader, budget),
        _ => {
            return Err(ParseError::Limited(format!(
                "GGUF metadata uses unsupported value type {value_type}"
            )))
        }
    };
    budget.consume_bytes(bytes)?;
    let mut buffer = [0_u8; 8];
    reader
        .read_exact(&mut buffer[..bytes as usize])
        .map_err(ParseError::metadata_io)
}

fn skip_array(reader: &mut impl Read, budget: &mut MetadataBudget) -> Result<(), ParseError> {
    let element_type = read_budgeted_u32(reader, budget)?;
    let len = read_budgeted_u64(reader, budget)?;
    let element_size = match element_type {
        0 | 1 | 7 => 1_u64,
        2 | 3 => 2_u64,
        4..=6 => 4_u64,
        8 => {
            budget.consume_string_elements(len)?;
            for _ in 0..len {
                let _ = read_budgeted_string(reader, budget)?;
            }
            return Ok(());
        }
        10..=12 => 8_u64,
        _ => {
            return Err(ParseError::Limited(format!(
                "GGUF metadata uses unsupported array type {element_type}"
            )))
        }
    };
    let bytes = len.checked_mul(element_size).ok_or_else(|| {
        ParseError::Limited("GGUF metadata array byte length overflowed".to_string())
    })?;
    budget.consume_bytes(bytes)?;
    let bytes = usize::try_from(bytes).map_err(|_| {
        ParseError::Limited("GGUF metadata array length does not fit this platform".to_string())
    })?;
    skip_exact(reader, bytes).map_err(ParseError::metadata_io)
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

struct TensorInfo {
    dimensions: Vec<u64>,
    tensor_type: u32,
    offset: u64,
}

fn validate_tensor_sections(
    reader: &mut (impl Read + Seek),
    file_len: u64,
    tensor_count: u64,
    alignment: u64,
) -> Result<(), ParseError> {
    let tensor_info_start = reader.stream_position().map_err(ParseError::tensor_io)?;
    let minimum_tensor_info_bytes = tensor_count
        .checked_mul(32)
        .ok_or_else(|| ParseError::Invalid("GGUF tensor info size overflows u64".to_string()))?;
    let minimum_tensor_info_end = tensor_info_start
        .checked_add(minimum_tensor_info_bytes)
        .ok_or_else(|| ParseError::Invalid("GGUF tensor info offset overflows u64".to_string()))?;
    if minimum_tensor_info_end > file_len {
        return Err(ParseError::Invalid(
            "GGUF tensor info section is missing or truncated".to_string(),
        ));
    }

    let tensor_capacity = usize::try_from(tensor_count).map_err(|_| {
        ParseError::Invalid("GGUF tensor count does not fit this platform".to_string())
    })?;
    let mut tensors = Vec::with_capacity(tensor_capacity);
    for _ in 0..tensor_count {
        let name = read_tensor_string(reader)?;
        if name.is_empty() {
            return Err(ParseError::Invalid(
                "GGUF tensor info contains an empty tensor name".to_string(),
            ));
        }
        let dimension_count = read_u32(reader).map_err(ParseError::tensor_io)?;
        if dimension_count == 0 || dimension_count > MAX_TENSOR_DIMENSIONS {
            return Err(ParseError::Invalid(format!(
                "GGUF tensor info has invalid dimension count {dimension_count}"
            )));
        }
        let mut dimensions = Vec::with_capacity(dimension_count as usize);
        for _ in 0..dimension_count {
            let dimension = read_u64(reader).map_err(ParseError::tensor_io)?;
            if dimension == 0 {
                return Err(ParseError::Invalid(
                    "GGUF tensor info contains a zero dimension".to_string(),
                ));
            }
            dimensions.push(dimension);
        }
        let tensor_type = read_u32(reader).map_err(ParseError::tensor_io)?;
        let offset = read_u64(reader).map_err(ParseError::tensor_io)?;
        if offset % alignment != 0 {
            return Err(ParseError::Invalid(format!(
                "GGUF tensor data offset {offset} is not aligned to {alignment} bytes"
            )));
        }
        tensors.push(TensorInfo {
            dimensions,
            tensor_type,
            offset,
        });
    }

    let tensor_info_end = reader.stream_position().map_err(ParseError::tensor_io)?;
    let data_start = align_up(tensor_info_end, alignment)?;
    if data_start >= file_len {
        return Err(ParseError::Invalid(
            "GGUF tensor data section is missing".to_string(),
        ));
    }

    for tensor in tensors {
        let tensor_start = data_start.checked_add(tensor.offset).ok_or_else(|| {
            ParseError::Invalid("GGUF tensor data offset overflows u64".to_string())
        })?;
        if tensor_start >= file_len {
            return Err(ParseError::Invalid(
                "GGUF tensor data offset is outside the file".to_string(),
            ));
        }
        let Some(required_bytes) = tensor_data_bytes(&tensor.dimensions, tensor.tensor_type)?
        else {
            return Err(ParseError::Limited(format!(
                "GGUF tensor uses unsupported type {}",
                tensor.tensor_type
            )));
        };
        let tensor_end = tensor_start.checked_add(required_bytes).ok_or_else(|| {
            ParseError::Invalid("GGUF tensor data length overflows u64".to_string())
        })?;
        if tensor_end > file_len {
            return Err(ParseError::Invalid(
                "GGUF tensor data is truncated".to_string(),
            ));
        }
    }

    Ok(())
}

fn read_tensor_string(reader: &mut impl Read) -> Result<String, ParseError> {
    let len = read_u64(reader).map_err(ParseError::tensor_io)?;
    if len > MAX_TENSOR_NAME_BYTES {
        return Err(ParseError::Invalid(format!(
            "GGUF tensor name exceeds {MAX_TENSOR_NAME_BYTES} bytes"
        )));
    }
    let len = usize::try_from(len).map_err(|_| {
        ParseError::Invalid("GGUF tensor name length does not fit this platform".to_string())
    })?;
    let mut bytes = vec![0_u8; len];
    reader
        .read_exact(&mut bytes)
        .map_err(ParseError::tensor_io)?;
    String::from_utf8(bytes)
        .map_err(|_| ParseError::Invalid("GGUF tensor name is not valid UTF-8".to_string()))
}

fn align_up(offset: u64, alignment: u64) -> Result<u64, ParseError> {
    let padding = (alignment - (offset % alignment)) % alignment;
    offset
        .checked_add(padding)
        .ok_or_else(|| ParseError::Invalid("GGUF tensor data alignment overflows u64".to_string()))
}

fn tensor_data_bytes(dimensions: &[u64], tensor_type: u32) -> Result<Option<u64>, ParseError> {
    let Some(&(block_size, type_size)) = tensor_type_layout(tensor_type) else {
        return Ok(None);
    };
    let first_dimension = dimensions[0];
    if !first_dimension.is_multiple_of(block_size) {
        return Err(ParseError::Invalid(format!(
            "GGUF tensor dimension {first_dimension} is incompatible with type {tensor_type} block size {block_size}"
        )));
    }
    let row_count = dimensions[1..]
        .iter()
        .try_fold(1_u64, |count, dimension| count.checked_mul(*dimension))
        .ok_or_else(|| ParseError::Invalid("GGUF tensor dimensions overflow u64".to_string()))?;
    first_dimension
        .checked_div(block_size)
        .and_then(|blocks| blocks.checked_mul(row_count))
        .and_then(|blocks| blocks.checked_mul(type_size))
        .map(Some)
        .ok_or_else(|| ParseError::Invalid("GGUF tensor byte length overflows u64".to_string()))
}

fn tensor_type_layout(tensor_type: u32) -> Option<&'static (u64, u64)> {
    const LAYOUTS: [(u64, u64); 31] = [
        (1, 4),   // F32
        (1, 2),   // F16
        (32, 18), // Q4_0
        (32, 20), // Q4_1
        (0, 0),   // removed Q4_2
        (0, 0),   // removed Q4_3
        (32, 22), // Q5_0
        (32, 24), // Q5_1
        (32, 34), // Q8_0
        (32, 40), // Q8_1
        (256, 84),
        (256, 110),
        (256, 144),
        (256, 176),
        (256, 210),
        (256, 292),
        (256, 66),
        (256, 74),
        (256, 98),
        (256, 50),
        (32, 18),
        (256, 110),
        (256, 82),
        (256, 136),
        (1, 1),
        (1, 2),
        (1, 4),
        (1, 8),
        (1, 8),
        (256, 56),
        (1, 2),
    ];
    let layout = LAYOUTS.get(tensor_type as usize)?;
    (layout.0 != 0).then_some(layout)
}
