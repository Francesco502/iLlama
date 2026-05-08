use serde::{
    de::{Error as DeError, Unexpected, Visitor},
    Deserialize, Deserializer, Serialize, Serializer,
};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    pub binary_path: Option<String>,
    pub model_path: Option<String>,
    pub host: String,
    pub port: u16,
    pub parameters: StartupParameters,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartupParameters {
    pub ctx_size: u32,
    pub threads: ThreadSetting,
    pub threads_batch: ThreadSetting,
    pub gpu_layers: GpuLayerSetting,
    pub batch_size: u32,
    pub ubatch_size: u32,
    pub flash_attention: FlashAttentionSetting,
    pub mmap: bool,
    pub mlock: bool,
    pub metrics: bool,
    pub idle_sleep_seconds: u32,
    pub mmproj_path: Option<String>,
    pub mmproj_offload: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadSetting {
    Auto,
    Fixed(u16),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GpuLayerSetting {
    Auto,
    All,
    Fixed(u16),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FlashAttentionSetting {
    Auto,
    On,
    Off,
}

pub fn validate_launch_config(config: &LaunchConfig) -> ValidationResult {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if config
        .binary_path
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        errors.push("未找到 llama-server，请选择可执行文件。".to_string());
    }

    match config.model_path.as_deref() {
        Some(path) if path.to_ascii_lowercase().ends_with(".gguf") => {}
        Some(_) => errors.push("模型文件必须是 .gguf 格式。".to_string()),
        None => errors.push("请选择 GGUF 模型文件。".to_string()),
    }

    if config.host != "127.0.0.1" {
        errors.push("v1 仅允许绑定到 127.0.0.1。".to_string());
    }

    if config.port < 1024 {
        errors.push("端口必须在 1024 到 65535 之间。".to_string());
    }

    if config.parameters.ctx_size == 0 {
        errors.push("上下文长度必须是正整数。".to_string());
    } else if config.parameters.ctx_size > 32768 {
        warnings.push("较大的上下文长度会显著增加内存或显存占用。".to_string());
    }

    if config.parameters.batch_size == 0 {
        errors.push("Batch size 必须是正整数。".to_string());
    }

    if config.parameters.ubatch_size == 0 {
        errors.push("Micro-batch 必须是正整数。".to_string());
    }

    if config.parameters.ubatch_size > config.parameters.batch_size {
        errors.push("Micro-batch 不能大于 batch size。".to_string());
    }

    if config.parameters.mlock {
        warnings.push("mlock 会锁定内存，低内存设备可能变慢或不稳定。".to_string());
    }

    if let Some(path) = config.parameters.mmproj_path.as_deref() {
        if !path.trim().is_empty() && !path.to_ascii_lowercase().ends_with(".gguf") {
            errors.push("mmproj 文件必须是 .gguf 格式。".to_string());
        }
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

pub fn build_command_args(config: &LaunchConfig) -> Vec<String> {
    let mut args = vec![
        "--model".to_string(),
        config.model_path.clone().unwrap_or_default(),
        "--host".to_string(),
        config.host.clone(),
        "--port".to_string(),
        config.port.to_string(),
        "--ctx-size".to_string(),
        config.parameters.ctx_size.to_string(),
        "--threads".to_string(),
        normalize_thread(&config.parameters.threads),
        "--threads-batch".to_string(),
        normalize_thread(&config.parameters.threads_batch),
        "--n-gpu-layers".to_string(),
        normalize_gpu_layers(&config.parameters.gpu_layers),
        "--batch-size".to_string(),
        config.parameters.batch_size.to_string(),
        "--ubatch-size".to_string(),
        config.parameters.ubatch_size.to_string(),
    ];

    match config.parameters.flash_attention {
        FlashAttentionSetting::On => args.push("--flash-attn".to_string()),
        FlashAttentionSetting::Auto | FlashAttentionSetting::Off => {}
    }

    args.push(if config.parameters.mmap {
        "--mmap".to_string()
    } else {
        "--no-mmap".to_string()
    });

    if config.parameters.mlock {
        args.push("--mlock".to_string());
    }

    if config.parameters.metrics {
        args.push("--metrics".to_string());
    }

    if config.parameters.idle_sleep_seconds > 0 {
        args.push("--sleep-idle-seconds".to_string());
        args.push(config.parameters.idle_sleep_seconds.to_string());
    }

    if let Some(path) = config.parameters.mmproj_path.as_deref() {
        if !path.trim().is_empty() {
            args.push("--mmproj".to_string());
            args.push(path.trim().to_string());
            if !config.parameters.mmproj_offload {
                args.push("--no-mmproj-offload".to_string());
            }
        }
    }

    args
}

fn normalize_thread(value: &ThreadSetting) -> String {
    match value {
        ThreadSetting::Auto => "-1".to_string(),
        ThreadSetting::Fixed(value) => value.to_string(),
    }
}

fn normalize_gpu_layers(value: &GpuLayerSetting) -> String {
    match value {
        GpuLayerSetting::Auto => "auto".to_string(),
        GpuLayerSetting::All => "all".to_string(),
        GpuLayerSetting::Fixed(value) => value.to_string(),
    }
}

// flash-attn is a boolean flag, no normalize function needed.

impl Serialize for ThreadSetting {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            ThreadSetting::Auto => serializer.serialize_str("auto"),
            ThreadSetting::Fixed(value) => serializer.serialize_u16(*value),
        }
    }
}

impl<'de> Deserialize<'de> for ThreadSetting {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(ThreadSettingVisitor)
    }
}

struct ThreadSettingVisitor;

impl Visitor<'_> for ThreadSettingVisitor {
    type Value = ThreadSetting;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("\"auto\" or a positive integer")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        if value == "auto" {
            Ok(ThreadSetting::Auto)
        } else {
            Err(E::invalid_value(Unexpected::Str(value), &self))
        }
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        u16::try_from(value)
            .map(ThreadSetting::Fixed)
            .map_err(|_| E::invalid_value(Unexpected::Unsigned(value), &self))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        if value <= 0 {
            return Err(E::invalid_value(Unexpected::Signed(value), &self));
        }
        u16::try_from(value)
            .map(ThreadSetting::Fixed)
            .map_err(|_| E::invalid_value(Unexpected::Signed(value), &self))
    }
}

impl Serialize for GpuLayerSetting {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            GpuLayerSetting::Auto => serializer.serialize_str("auto"),
            GpuLayerSetting::All => serializer.serialize_str("all"),
            GpuLayerSetting::Fixed(value) => serializer.serialize_u16(*value),
        }
    }
}

impl<'de> Deserialize<'de> for GpuLayerSetting {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(GpuLayerSettingVisitor)
    }
}

struct GpuLayerSettingVisitor;

impl Visitor<'_> for GpuLayerSettingVisitor {
    type Value = GpuLayerSetting;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("\"auto\", \"all\", or a non-negative integer")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        match value {
            "auto" => Ok(GpuLayerSetting::Auto),
            "all" => Ok(GpuLayerSetting::All),
            _ => Err(E::invalid_value(Unexpected::Str(value), &self)),
        }
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        u16::try_from(value)
            .map(GpuLayerSetting::Fixed)
            .map_err(|_| E::invalid_value(Unexpected::Unsigned(value), &self))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        if value < 0 {
            return Err(E::invalid_value(Unexpected::Signed(value), &self));
        }
        u16::try_from(value)
            .map(GpuLayerSetting::Fixed)
            .map_err(|_| E::invalid_value(Unexpected::Signed(value), &self))
    }
}
