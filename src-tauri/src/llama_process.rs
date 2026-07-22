use crate::{
    gguf::{inspect_gguf, GgufStatus},
    health::{check_http_health, http_get, is_port_available},
    monitor::{
        collect_process_metrics, empty_metrics, merge_metrics, parse_prometheus_metrics_with_hints,
        PrometheusMetricHints, RuntimeMetrics,
    },
    parameters::{
        build_command_args, prometheus_metric_hints_from_config, validate_launch_config,
        AppliedParameter, FlashAttentionSetting, GpuLayerSetting, LaunchConfig,
        ResolvedStartupParameters, ThreadSetting,
    },
    server_probe::{CommandSpec, ServerCapabilities},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    io::{BufRead, BufReader, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeStatus {
    Idle,
    Starting,
    Healthy,
    Failed,
    Stopping,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub status: RuntimeStatus,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub active_model_path: Option<String>,
    pub active_launch: Option<ActiveLaunchSnapshot>,
    pub last_error: Option<String>,
    pub metrics: RuntimeMetrics,
    pub logs: Vec<ProcessLogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveLaunchSnapshot {
    pub binary_path: String,
    pub model_path: String,
    pub host: String,
    pub port: u16,
    pub parameters: ResolvedStartupParameters,
    pub command_args: Vec<String>,
    pub prometheus_hints: crate::parameters::PrometheusHintsConfig,
    pub started_at: String,
    pub model_id: Option<String>,
    pub server_capabilities: Option<ServerCapabilities>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessLogEntry {
    pub id: String,
    pub timestamp: String,
    pub stream: String,
    pub message: String,
}

pub struct LlamaProcessState {
    inner: Mutex<InnerState>,
    logs: Arc<Mutex<VecDeque<ProcessLogEntry>>>,
    sys: Mutex<System>,
}

#[derive(Default)]
struct InnerState {
    child: Option<Child>,
    active_launch: Option<ActiveLaunchSnapshot>,
    metrics_enabled: bool,
    last_error: Option<String>,
    health_confirmed: bool,
    metric_hints: PrometheusMetricHints,
}

impl Default for LlamaProcessState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(InnerState::default()),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            sys: Mutex::new(System::new()),
        }
    }
}

impl LlamaProcessState {
    pub fn refresh_snapshot(&self) -> RuntimeSnapshot {
        let initial = self.snapshot();
        let Some(pid) = initial.pid else {
            return initial;
        };
        let Some(active) = initial.active_launch.as_ref() else {
            return initial;
        };
        let health = check_http_health(&active.host, active.port, 2_000);
        if !health.healthy {
            if let Ok(mut state) = self.inner.lock() {
                let same_process = state
                    .child
                    .as_ref()
                    .map(|child| child.id() == pid)
                    .unwrap_or(false);
                if same_process {
                    state.health_confirmed = false;
                }
            }
            return self.snapshot();
        }

        let model_id = active
            .model_id
            .clone()
            .or_else(|| fetch_first_model_id(&active.host, active.port));
        if let Ok(mut state) = self.inner.lock() {
            let same_process = state
                .child
                .as_ref()
                .map(|child| child.id() == pid)
                .unwrap_or(false);
            if same_process {
                state.health_confirmed = true;
                if let Some(active_launch) = state.active_launch.as_mut() {
                    active_launch.model_id = model_id;
                }
            }
        }
        self.snapshot()
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        let mut state = self.inner.lock().expect("process state poisoned");
        let (status, pid) = match state.child.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(exit_status)) => {
                    let was_healthy = state.health_confirmed;
                    state.last_error = exit_status
                        .code()
                        .map(|code| format!("llama-server exited with {code}"))
                        .or_else(|| Some("llama-server exited".to_string()));
                    state.health_confirmed = false;
                    state.child = None;
                    state.active_launch = None;
                    state.metrics_enabled = false;
                    let status = if was_healthy && exit_status.success() {
                        RuntimeStatus::Stopped
                    } else {
                        RuntimeStatus::Failed
                    };
                    (status, None)
                }
                Ok(None) => {
                    let current_pid = child.id();
                    let s = if state.health_confirmed {
                        RuntimeStatus::Healthy
                    } else {
                        RuntimeStatus::Starting
                    };
                    (s, Some(current_pid))
                }
                Err(error) => {
                    let current_pid = child.id();
                    state.last_error = Some(error.to_string());
                    state.health_confirmed = false;
                    (RuntimeStatus::Failed, Some(current_pid))
                }
            },
            None => (RuntimeStatus::Idle, None),
        };

        let metrics = if let Some(pid_val) = pid {
            if let Ok(mut sys) = self.sys.lock() {
                let process_metrics = collect_process_metrics(&mut sys, pid_val);
                if state.metrics_enabled {
                    match state.active_launch.as_ref() {
                        Some(active) => http_get(&active.host, active.port, "/metrics", 250)
                            .map(|response| {
                                merge_metrics(
                                    process_metrics.clone(),
                                    parse_prometheus_metrics_with_hints(
                                        &response.body,
                                        &state.metric_hints,
                                    ),
                                )
                            })
                            .unwrap_or(process_metrics),
                        _ => process_metrics,
                    }
                } else {
                    process_metrics
                }
            } else {
                empty_metrics()
            }
        } else {
            empty_metrics()
        };

        RuntimeSnapshot {
            status,
            pid,
            started_at: state
                .active_launch
                .as_ref()
                .map(|launch| launch.started_at.clone()),
            active_model_path: state
                .active_launch
                .as_ref()
                .map(|launch| launch.model_path.clone()),
            active_launch: state.active_launch.clone(),
            last_error: state.last_error.clone(),
            metrics,
            logs: self.current_logs(),
        }
    }

    pub fn start(&self, config: LaunchConfig) -> Result<RuntimeSnapshot, String> {
        self.start_internal(config, None)
    }

    pub fn start_with_spec(
        &self,
        config: LaunchConfig,
        spec: CommandSpec,
    ) -> Result<RuntimeSnapshot, String> {
        self.start_internal(config, Some(spec))
    }

    fn start_internal(
        &self,
        config: LaunchConfig,
        spec: Option<CommandSpec>,
    ) -> Result<RuntimeSnapshot, String> {
        let validation = validate_launch_config(&config);
        if !validation.valid {
            return Err(validation.errors.join("\n"));
        }

        let binary_path = spec
            .as_ref()
            .map(|spec| spec.executable.clone())
            .or_else(|| config.binary_path.clone())
            .ok_or_else(|| "未找到 llama-server，请选择可执行文件。".to_string())?;
        let command_args = spec
            .as_ref()
            .map(|spec| spec.args.clone())
            .unwrap_or_else(|| build_command_args(&config));
        let parsed_args = parse_command_args(&command_args)?;
        let config_binary_path = config.binary_path.as_deref().unwrap_or_default();
        let config_model_path = config.model_path.as_deref().unwrap_or_default();
        if binary_path != config_binary_path {
            return Err("CommandSpec executable 与已验证配置不一致。".to_string());
        }
        if parsed_args.model_path != config_model_path {
            return Err("CommandSpec --model 与已验证配置不一致。".to_string());
        }
        if parsed_args.host != config.host {
            return Err("CommandSpec --host 与已验证配置不一致。".to_string());
        }
        if parsed_args.port != config.port {
            return Err("CommandSpec --port 与已验证配置不一致。".to_string());
        }

        if !Path::new(&binary_path).exists() {
            return Err("llama-server 可执行文件不存在。".to_string());
        }

        if !Path::new(&parsed_args.model_path).exists() {
            return Err("模型文件不存在。".to_string());
        }
        let inspection = inspect_gguf(Path::new(&parsed_args.model_path));
        if inspection.status == GgufStatus::Invalid {
            return Err(format!(
                "GGUF 模型无效：{}",
                inspection
                    .warning
                    .unwrap_or_else(|| "格式校验失败".to_string())
            ));
        }

        let mut state = self
            .inner
            .lock()
            .map_err(|_| "进程状态锁定失败。".to_string())?;
        reap_finished_child(&mut state);
        if state.child.is_some() {
            return Err("已有模型进程正在运行。".to_string());
        }
        if !is_port_available(&parsed_args.host, parsed_args.port) {
            return Err(format!(
                "端口已被占用：{}，请换一个端口或开启自动端口。",
                parsed_args.port
            ));
        }

        self.clear_logs();
        self.push_log(
            "system",
            format!("启动命令：{} {}", binary_path, command_args.join(" ")),
        );
        if let Some(spec) = spec.as_ref() {
            for warning in &spec.warnings {
                self.push_log("system", warning.clone());
            }
        }

        let mut child = Command::new(&binary_path)
            .args(&command_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("启动 llama-server 失败：{error}"))?;

        if let Some(stdout) = child.stdout.take() {
            spawn_log_reader(stdout, "stdout", Arc::clone(&self.logs));
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_log_reader(stderr, "stderr", Arc::clone(&self.logs));
        }

        let started_at = Utc::now().to_rfc3339();
        let resolved_parameters = parsed_args.parameters;
        let metrics_enabled = matches!(
            resolved_parameters.metrics,
            AppliedParameter::Argument { value: true }
        );
        state.active_launch = Some(ActiveLaunchSnapshot {
            binary_path,
            model_path: parsed_args.model_path,
            host: parsed_args.host,
            port: parsed_args.port,
            parameters: resolved_parameters,
            command_args: command_args.clone(),
            prometheus_hints: config.prometheus_hints.clone(),
            started_at,
            model_id: None,
            server_capabilities: spec.map(|spec| spec.capabilities),
        });
        state.metrics_enabled = metrics_enabled;
        state.metric_hints = prometheus_metric_hints_from_config(&config.prometheus_hints);
        state.last_error = None;
        state.health_confirmed = false;
        state.child = Some(child);
        drop(state);

        Ok(self.snapshot())
    }

    pub fn stop(&self) -> Result<RuntimeSnapshot, String> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "进程状态锁定失败。".to_string())?;
        if let Some(child) = state.child.as_mut() {
            child
                .kill()
                .map_err(|error| format!("停止 llama-server 失败：{error}"))?;
            let _ = child.wait();
        }
        state.child = None;
        state.active_launch = None;
        state.metrics_enabled = false;
        state.metric_hints = PrometheusMetricHints::default();
        state.health_confirmed = false;
        Ok(RuntimeSnapshot {
            status: RuntimeStatus::Stopped,
            pid: None,
            started_at: None,
            active_model_path: None,
            active_launch: None,
            last_error: state.last_error.clone(),
            metrics: empty_metrics(),
            logs: self.current_logs(),
        })
    }

    fn push_log(&self, stream: &str, message: String) {
        push_log_entry(&self.logs, stream, message);
    }

    fn clear_logs(&self) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.clear();
        }
    }

    fn current_logs(&self) -> Vec<ProcessLogEntry> {
        self.logs
            .lock()
            .map(|logs| logs.iter().cloned().collect())
            .unwrap_or_default()
    }
}

fn fetch_first_model_id(host: &str, port: u16) -> Option<String> {
    let response = http_get(host, port, "/v1/models", 5_000).ok()?;
    if !(200..300).contains(&response.status_code) {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(&response.body).ok()?;
    value
        .get("data")?
        .as_array()?
        .first()?
        .get("id")?
        .as_str()
        .map(str::to_string)
}

struct ParsedCommandArgs {
    model_path: String,
    host: String,
    port: u16,
    parameters: ResolvedStartupParameters,
}

fn parse_command_args(args: &[String]) -> Result<ParsedCommandArgs, String> {
    let mut seen = HashSet::new();
    let mut model_path = None;
    let mut host = None;
    let mut port = None;
    let mut ctx_size = AppliedParameter::server_default();
    let mut threads = AppliedParameter::server_default();
    let mut threads_batch = AppliedParameter::server_default();
    let mut gpu_layers = AppliedParameter::server_default();
    let mut batch_size = AppliedParameter::server_default();
    let mut ubatch_size = AppliedParameter::server_default();
    let mut flash_attention = AppliedParameter::server_default();
    let mut mmap = AppliedParameter::server_default();
    let mut mlock = AppliedParameter::server_default();
    let mut metrics = AppliedParameter::server_default();
    let mut idle_sleep_seconds = AppliedParameter::server_default();
    let mut mmproj_path = AppliedParameter::server_default();
    let mut mmproj_offload = AppliedParameter::server_default();
    let mut has_mmproj = false;
    let mut has_mmproj_offload = false;
    let mut index = 0;

    while index < args.len() {
        let flag = args[index].as_str();
        if !flag.starts_with("--") {
            return Err(format!("启动参数包含无法识别的位置参数：{flag}"));
        }
        if !seen.insert(flag) {
            return Err(format!("启动参数重复：{flag}"));
        }
        let takes_value = matches!(
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
        );
        let value = if takes_value {
            let value = args
                .get(index + 1)
                .filter(|value| !is_known_flag(value))
                .ok_or_else(|| format!("启动参数 {flag} 缺少值。"))?;
            index += 2;
            Some(value.as_str())
        } else {
            index += 1;
            None
        };

        match flag {
            "--model" => model_path = value.map(str::to_string),
            "--host" => host = value.map(str::to_string),
            "--port" => port = Some(parse_value(flag, value.unwrap())?),
            "--ctx-size" => {
                ctx_size = AppliedParameter::argument(parse_value(flag, value.unwrap())?)
            }
            "--threads" => {
                threads = AppliedParameter::argument(
                    parse_thread_setting(value.unwrap())
                        .map_err(|_| format!("启动参数 {flag} 的值无效。"))?,
                )
            }
            "--threads-batch" => {
                threads_batch = AppliedParameter::argument(
                    parse_thread_setting(value.unwrap())
                        .map_err(|_| format!("启动参数 {flag} 的值无效。"))?,
                )
            }
            "--n-gpu-layers" => {
                gpu_layers = AppliedParameter::argument(
                    parse_gpu_layer_setting(value.unwrap())
                        .map_err(|_| format!("启动参数 {flag} 的值无效。"))?,
                )
            }
            "--batch-size" => {
                batch_size = AppliedParameter::argument(parse_value(flag, value.unwrap())?)
            }
            "--ubatch-size" => {
                ubatch_size = AppliedParameter::argument(parse_value(flag, value.unwrap())?)
            }
            "--flash-attn" => {
                flash_attention = AppliedParameter::argument(
                    parse_flash_attention(value.unwrap())
                        .map_err(|_| format!("启动参数 {flag} 的值无效。"))?,
                )
            }
            "--mmap" => {
                if seen.contains("--no-mmap") {
                    return Err("启动参数 --mmap 与 --no-mmap 冲突。".to_string());
                }
                mmap = AppliedParameter::argument(true);
            }
            "--no-mmap" => {
                if seen.contains("--mmap") {
                    return Err("启动参数 --mmap 与 --no-mmap 冲突。".to_string());
                }
                mmap = AppliedParameter::argument(false);
            }
            "--mlock" => mlock = AppliedParameter::argument(true),
            "--metrics" => metrics = AppliedParameter::argument(true),
            "--sleep-idle-seconds" => {
                idle_sleep_seconds = AppliedParameter::argument(parse_value(flag, value.unwrap())?)
            }
            "--mmproj" => {
                has_mmproj = true;
                mmproj_path = AppliedParameter::argument(value.unwrap().to_string());
            }
            "--no-mmproj-offload" => {
                has_mmproj_offload = true;
                mmproj_offload = AppliedParameter::argument(false);
            }
            _ => return Err(format!("启动参数不受支持：{flag}")),
        }
    }

    if has_mmproj_offload && !has_mmproj {
        return Err("启动参数 --no-mmproj-offload 需要 --mmproj。".to_string());
    }

    Ok(ParsedCommandArgs {
        model_path: model_path.ok_or_else(|| "启动参数缺少 --model。".to_string())?,
        host: host.ok_or_else(|| "启动参数缺少 --host。".to_string())?,
        port: port.ok_or_else(|| "启动参数缺少 --port。".to_string())?,
        parameters: ResolvedStartupParameters {
            ctx_size,
            threads,
            threads_batch,
            gpu_layers,
            batch_size,
            ubatch_size,
            flash_attention,
            mmap,
            mlock,
            metrics,
            idle_sleep_seconds,
            mmproj_path,
            mmproj_offload,
        },
    })
}

fn is_known_flag(value: &str) -> bool {
    matches!(
        value,
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
            | "--mmap"
            | "--no-mmap"
            | "--mlock"
            | "--metrics"
            | "--sleep-idle-seconds"
            | "--mmproj"
            | "--no-mmproj-offload"
    )
}

fn parse_value<T: std::str::FromStr>(flag: &str, value: &str) -> Result<T, String> {
    value
        .parse()
        .map_err(|_| format!("启动参数 {flag} 的值无效。"))
}

fn parse_thread_setting(value: &str) -> Result<ThreadSetting, std::num::ParseIntError> {
    if matches!(value, "auto" | "-1") {
        Ok(ThreadSetting::Auto)
    } else {
        value.parse().map(ThreadSetting::Fixed)
    }
}

fn parse_gpu_layer_setting(value: &str) -> Result<GpuLayerSetting, std::num::ParseIntError> {
    match value {
        "auto" => Ok(GpuLayerSetting::Auto),
        "all" => Ok(GpuLayerSetting::All),
        value => value.parse().map(GpuLayerSetting::Fixed),
    }
}

fn parse_flash_attention(value: &str) -> Result<FlashAttentionSetting, ()> {
    match value {
        "auto" => Ok(FlashAttentionSetting::Auto),
        "on" => Ok(FlashAttentionSetting::On),
        "off" => Ok(FlashAttentionSetting::Off),
        _ => Err(()),
    }
}

fn reap_finished_child(state: &mut InnerState) {
    let Some(child) = state.child.as_mut() else {
        return;
    };
    let Ok(Some(exit_status)) = child.try_wait() else {
        return;
    };

    state.last_error = exit_status
        .code()
        .map(|code| format!("llama-server exited with {code}"))
        .or_else(|| Some("llama-server exited".to_string()));
    state.child = None;
    state.active_launch = None;
    state.health_confirmed = false;
    state.metrics_enabled = false;
}

fn spawn_log_reader(
    reader: impl Read + Send + 'static,
    stream: &'static str,
    logs: Arc<Mutex<VecDeque<ProcessLogEntry>>>,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(message) => push_log_entry(&logs, stream, message),
                Err(error) => {
                    push_log_entry(&logs, "system", format!("读取 {stream} 日志失败：{error}"));
                    break;
                }
            }
        }
    });
}

fn push_log_entry(logs: &Arc<Mutex<VecDeque<ProcessLogEntry>>>, stream: &str, message: String) {
    let Ok(mut logs) = logs.lock() else {
        return;
    };
    if logs.len() >= 500 {
        logs.pop_front();
    }
    let sequence = logs.len();
    logs.push_back(ProcessLogEntry {
        id: format!(
            "{}-{sequence}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ),
        timestamp: Utc::now().to_rfc3339(),
        stream: stream.to_string(),
        message,
    });
}
