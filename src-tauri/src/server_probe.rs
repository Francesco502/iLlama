use crate::parameters::{build_command_args, LaunchConfig};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const DEFAULT_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_READER_DRAIN_TIMEOUT: Duration = Duration::from_millis(200);
const MAX_PROBE_OUTPUT_BYTES: u64 = 1024 * 1024;
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
    let mut command = Command::new(binary_path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_probe_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法执行 llama-server：{error}"))?;
    let stdout_reader = spawn_reader(child.stdout.take());
    let stderr_reader = spawn_reader(child.stderr.take());
    let started = Instant::now();

    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                terminate_probe_tree(&mut child);
                drain_reader(stdout_reader);
                drain_reader(stderr_reader);
                return Err("llama-server 能力探测超时。".to_string());
            }
            Err(error) => {
                terminate_probe_tree(&mut child);
                drain_reader(stdout_reader);
                drain_reader(stderr_reader);
                return Err(format!("等待 llama-server 探测失败：{error}"));
            }
        }
    };
    let stdout = drain_reader(stdout_reader);
    let stderr = drain_reader(stderr_reader);
    Ok(ProbeOutput {
        success: exit_status.success(),
        code: exit_status.code(),
        combined: format!("{stdout}\n{stderr}"),
    })
}

fn spawn_reader(stream: Option<impl Read + Send + 'static>) -> mpsc::Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = sender.send(read_stream(stream));
    });
    receiver
}

fn drain_reader(reader: mpsc::Receiver<String>) -> String {
    reader
        .recv_timeout(PROBE_READER_DRAIN_TIMEOUT)
        .unwrap_or_default()
}

fn read_stream(stream: Option<impl Read>) -> String {
    let Some(stream) = stream else {
        return String::new();
    };
    let mut output = String::new();
    let _ = stream
        .take(MAX_PROBE_OUTPUT_BYTES)
        .read_to_string(&mut output);
    output
}

#[cfg(unix)]
fn configure_probe_process(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
}

#[cfg(windows)]
fn configure_probe_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(not(any(unix, windows)))]
fn configure_probe_process(_command: &mut Command) {}

fn terminate_probe_tree(child: &mut Child) {
    #[cfg(target_os = "linux")]
    if terminate_linux_probe_tree(child) {
        return;
    }

    #[cfg(all(unix, not(target_os = "linux")))]
    unsafe {
        let _ = libc::kill(-(child.id() as i32), libc::SIGKILL);
    }

    #[cfg(target_os = "linux")]
    unsafe {
        // Fall back to the original group kill if procfs was unavailable or the
        // session leader did not reap its children promptly.
        let _ = libc::kill(-(child.id() as i32), libc::SIGKILL);
    }

    #[cfg(windows)]
    {
        // The child is created in its own process group; taskkill /T terminates descendants too.
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(target_os = "linux")]
fn terminate_linux_probe_tree(child: &mut Child) -> bool {
    let Ok(leader_pid) = i32::try_from(child.id()) else {
        return false;
    };

    // Killing the complete process group in one operation can orphan zombie
    // grandchildren: the shell dies before it can reap the background command.
    // Freeze the group, kill descendants first, then resume the session leader
    // so its normal `wait` path can reap them before we fall back to SIGKILL.
    unsafe {
        if libc::kill(-leader_pid, libc::SIGSTOP) == -1 {
            return false;
        }
    }

    let descendants = linux_descendant_pids(leader_pid);
    for descendant in descendants.into_iter().rev() {
        unsafe {
            let _ = libc::kill(descendant, libc::SIGKILL);
        }
    }
    unsafe {
        let _ = libc::kill(leader_pid, libc::SIGCONT);
    }

    let deadline = Instant::now() + PROBE_READER_DRAIN_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let _ = child.wait();
                return true;
            }
            Ok(None) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(5));
            }
            _ => return false,
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_descendant_pids(root_pid: i32) -> Vec<i32> {
    let mut descendants = Vec::new();
    let mut pending = vec![root_pid];

    while let Some(parent_pid) = pending.pop() {
        let children_path = format!("/proc/{parent_pid}/task/{parent_pid}/children");
        let Ok(children) = std::fs::read_to_string(children_path) else {
            continue;
        };
        for child_pid in children
            .split_whitespace()
            .filter_map(|value| value.parse::<i32>().ok())
        {
            descendants.push(child_pid);
            pending.push(child_pid);
        }
    }

    descendants
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
