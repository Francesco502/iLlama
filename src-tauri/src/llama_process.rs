use crate::{
    health::{check_http_health, http_get, is_port_available},
    monitor::{
        collect_process_metrics, empty_metrics, merge_metrics, parse_prometheus_metrics_with_hints,
        PrometheusMetricHints, RuntimeMetrics,
    },
    parameters::{
        build_command_args, prometheus_metric_hints_from_config, validate_launch_config,
        LaunchConfig,
    },
    server_probe::{CommandSpec, ServerCapabilities},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
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
    pub parameters: crate::parameters::StartupParameters,
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
        let health = check_http_health(&active.host, active.port, 500);
        if !health.healthy {
            return initial;
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
                    state.last_error = Some(error.to_string());
                    state.health_confirmed = false;
                    (RuntimeStatus::Failed, None)
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

    /// Mark the backend health as confirmed (called after frontend health check passes).
    pub fn confirm_health(&self) {
        if let Ok(mut state) = self.inner.lock() {
            if state.child.is_some() {
                state.health_confirmed = true;
            }
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

        if !Path::new(&binary_path).exists() {
            return Err("llama-server 可执行文件不存在。".to_string());
        }

        if let Some(model_path) = config.model_path.as_deref() {
            if !Path::new(model_path).exists() {
                return Err("模型文件不存在。".to_string());
            }
        }

        let mut state = self
            .inner
            .lock()
            .map_err(|_| "进程状态锁定失败。".to_string())?;
        reap_finished_child(&mut state);
        if state.child.is_some() {
            return Err("已有模型进程正在运行。".to_string());
        }
        if !is_port_available(&config.host, config.port) {
            return Err(format!(
                "端口已被占用：{}，请换一个端口或开启自动端口。",
                config.port
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
        let metrics_enabled = config.parameters.metrics;
        state.active_launch = Some(ActiveLaunchSnapshot {
            binary_path,
            model_path: config.model_path.expect("validated model path"),
            host: config.host,
            port: config.port,
            parameters: config.parameters,
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
    let response = http_get(host, port, "/v1/models", 2_000).ok()?;
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
