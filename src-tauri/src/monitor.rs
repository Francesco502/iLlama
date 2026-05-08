use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMetrics {
    pub cpu_percent: Option<f32>,
    pub memory_bytes: Option<u64>,
    pub tokens_per_second: Option<f32>,
    pub prompt_tokens_per_second: Option<f32>,
    pub kv_cache_usage_ratio: Option<f32>,
}

pub fn empty_metrics() -> RuntimeMetrics {
    RuntimeMetrics {
        cpu_percent: None,
        memory_bytes: None,
        tokens_per_second: None,
        prompt_tokens_per_second: None,
        kv_cache_usage_ratio: None,
    }
}

/// Collect real CPU and memory metrics for a running llama-server process.
///
/// `sys` should be a long-lived `System` instance so that `cpu_usage()` can
/// compute deltas between successive calls.
pub fn collect_process_metrics(sys: &mut System, pid: u32) -> RuntimeMetrics {
    let sysinfo_pid = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[sysinfo_pid]), true);

    match sys.process(sysinfo_pid) {
        Some(process) => RuntimeMetrics {
            cpu_percent: Some(process.cpu_usage()),
            memory_bytes: Some(process.memory()),
            tokens_per_second: None,
            prompt_tokens_per_second: None,
            kv_cache_usage_ratio: None,
        },
        None => empty_metrics(),
    }
}

pub fn parse_prometheus_metrics(content: &str) -> RuntimeMetrics {
    let mut metrics = empty_metrics();

    for line in content.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else {
            continue;
        };
        let Some(value) = parts.next().and_then(|raw| raw.parse::<f32>().ok()) else {
            continue;
        };
        let normalized = name.to_ascii_lowercase();

        if normalized.contains("kv_cache") && normalized.contains("usage") {
            metrics.kv_cache_usage_ratio = Some(value);
        } else if normalized.contains("prompt")
            && normalized.contains("tokens")
            && normalized.contains("seconds")
        {
            metrics.prompt_tokens_per_second = Some(value);
        } else if (normalized.contains("predicted") || normalized.contains("generation"))
            && normalized.contains("tokens")
            && normalized.contains("seconds")
        {
            metrics.tokens_per_second = Some(value);
        }
    }

    metrics
}

pub fn merge_metrics(process: RuntimeMetrics, server: RuntimeMetrics) -> RuntimeMetrics {
    RuntimeMetrics {
        cpu_percent: process.cpu_percent,
        memory_bytes: process.memory_bytes,
        tokens_per_second: server.tokens_per_second.or(process.tokens_per_second),
        prompt_tokens_per_second: server
            .prompt_tokens_per_second
            .or(process.prompt_tokens_per_second),
        kv_cache_usage_ratio: server.kv_cache_usage_ratio.or(process.kv_cache_usage_ratio),
    }
}
