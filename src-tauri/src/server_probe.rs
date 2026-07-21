use crate::parameters::{build_command_args, LaunchConfig};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const DEFAULT_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const REQUIRED_FLAGS: [&str; 3] = ["--model", "--host", "--port"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProbeStatus {
    Compatible,
    Limited,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerCapabilities {
    pub binary_path: String,
    pub version_text: Option<String>,
    pub supported_flags: Vec<String>,
    pub status: ProbeStatus,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub executable: String,
    pub args: Vec<String>,
    pub warnings: Vec<String>,
    pub capabilities: ServerCapabilities,
}

pub fn build_command_spec(
    config: &LaunchConfig,
    capabilities: &ServerCapabilities,
) -> Result<CommandSpec, String> {
    if capabilities.status == ProbeStatus::Invalid {
        return Err(capabilities.warnings.join("\n"));
    }
    let mut warnings = capabilities.warnings.clone();
    let source = build_command_args(config);
    let mut args = Vec::with_capacity(source.len());
    let mut index = 0;
    while index < source.len() {
        let value = &source[index];
        if !value.starts_with("--") {
            args.push(value.clone());
            index += 1;
            continue;
        }
        let takes_value = flag_takes_value(value);
        if capabilities
            .supported_flags
            .iter()
            .any(|flag| flag == value)
        {
            args.push(value.clone());
            if takes_value && index + 1 < source.len() {
                args.push(source[index + 1].clone());
            }
        } else {
            warnings.push(format!(
                "当前 llama-server 不支持 {value}，已从启动命令省略。"
            ));
        }
        index += if takes_value { 2 } else { 1 };
    }
    Ok(CommandSpec {
        executable: capabilities.binary_path.clone(),
        args,
        warnings,
        capabilities: capabilities.clone(),
    })
}

pub fn probe_llama_server(binary_path: &str) -> ServerCapabilities {
    probe_llama_server_with_timeout(binary_path, DEFAULT_PROBE_TIMEOUT)
}

pub fn probe_llama_server_with_timeout(binary_path: &str, timeout: Duration) -> ServerCapabilities {
    let mut warnings = Vec::new();
    let version = run_probe(binary_path, &["--version"], timeout);
    let version_text = match version {
        Ok(output) if output.success => first_non_empty_line(&output.combined),
        Ok(output) => {
            warnings.push(format!("版本探测失败（退出码 {:?}）。", output.code));
            None
        }
        Err(error) => {
            warnings.push(error);
            None
        }
    };

    let help = run_probe(binary_path, &["--help"], timeout).or_else(|first_error| {
        run_probe(binary_path, &["-h"], timeout).map_err(|second_error| {
            if first_error.contains("超时") || second_error.contains("超时") {
                "llama-server 能力探测超时。".to_string()
            } else {
                format!("{first_error} {second_error}")
            }
        })
    });
    let supported_flags = match help {
        Ok(output) => extract_flags(&output.combined),
        Err(error) => {
            warnings.push(error);
            Vec::new()
        }
    };

    let missing: Vec<&str> = REQUIRED_FLAGS
        .into_iter()
        .filter(|flag| !supported_flags.iter().any(|item| item == flag))
        .collect();
    let status = if !missing.is_empty() {
        warnings.push(format!("缺少必需参数：{}。", missing.join(", ")));
        ProbeStatus::Invalid
    } else if version_text.is_none() {
        ProbeStatus::Limited
    } else {
        ProbeStatus::Compatible
    };

    ServerCapabilities {
        binary_path: binary_path.to_string(),
        version_text,
        supported_flags,
        status,
        warnings,
    }
}

struct ProbeOutput {
    success: bool,
    code: Option<i32>,
    combined: String,
}

fn run_probe(binary_path: &str, args: &[&str], timeout: Duration) -> Result<ProbeOutput, String> {
    let mut child = Command::new(binary_path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法执行 llama-server：{error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = thread::spawn(move || read_stream(stdout));
    let stderr_reader = thread::spawn(move || read_stream(stderr));
    let started = Instant::now();

    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err("llama-server 能力探测超时。".to_string());
            }
            Err(error) => return Err(format!("等待 llama-server 探测失败：{error}")),
        }
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    Ok(ProbeOutput {
        success: exit_status.success(),
        code: exit_status.code(),
        combined: format!("{stdout}\n{stderr}"),
    })
}

fn read_stream(stream: Option<impl Read>) -> String {
    let Some(mut stream) = stream else {
        return String::new();
    };
    let mut output = String::new();
    let _ = stream.read_to_string(&mut output);
    output
}

fn first_non_empty_line(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn extract_flags(output: &str) -> Vec<String> {
    let mut flags: Vec<String> = output
        .split_whitespace()
        .filter_map(|token| {
            let start = token.find("--")?;
            let flag = token[start..]
                .trim_matches(|character: char| {
                    matches!(character, ',' | ';' | '[' | ']' | '(' | ')')
                })
                .split(['=', '<'])
                .next()
                .unwrap_or_default();
            if flag.len() > 2 {
                Some(flag.to_string())
            } else {
                None
            }
        })
        .collect();
    flags.sort();
    flags.dedup();
    flags
}

fn flag_takes_value(flag: &str) -> bool {
    matches!(
        flag,
        "--model"
            | "--host"
            | "--port"
            | "--ctx-size"
            | "--threads"
            | "--threads-batch"
            | "--n-gpu-layers"
            | "--batch-size"
            | "--ubatch-size"
            | "--flash-attn"
            | "--sleep-idle-seconds"
            | "--mmproj"
    )
}

#[cfg(test)]
mod tests {
    use super::extract_flags;

    #[test]
    fn extracts_and_deduplicates_long_flags() {
        assert_eq!(
            extract_flags("--model FILE, [--port=8080] --model FILE"),
            vec!["--model".to_string(), "--port".to_string()]
        );
    }
}
