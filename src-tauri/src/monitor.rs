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
    parse_prometheus_metrics_with_hints(content, &PrometheusMetricHints::default())
}

/// Optional substring rules for matching llama.cpp / third-party Prometheus metric names.
#[derive(Debug, Clone)]
pub struct PrometheusMetricHints {
    /// Every entry (lowercased) must appear in the metric name for KV cache ratio.
    pub kv_substrings: Vec<String>,
    /// Every entry must appear for prompt tokens / second style lines.
    pub prompt_substrings: Vec<String>,
    /// At least one entry must appear for generation tokens / second.
    pub generation_any_of: Vec<String>,
    /// Every entry must appear together with `generation_any_of` for generation TPS.
    pub generation_required: Vec<String>,
}

impl Default for PrometheusMetricHints {
    fn default() -> Self {
        Self {
            kv_substrings: vec!["kv_cache".into(), "usage".into()],
            prompt_substrings: vec!["prompt".into(), "tokens".into(), "seconds".into()],
            generation_any_of: vec!["predicted".into(), "generation".into()],
            generation_required: vec!["tokens".into(), "seconds".into()],
        }
    }
}

pub fn parse_prometheus_metrics_with_hints(
    content: &str,
    hints: &PrometheusMetricHints,
) -> RuntimeMetrics {
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

        if hints
            .kv_substrings
            .iter()
            .all(|needle| normalized.contains(&needle.to_ascii_lowercase()))
        {
            metrics.kv_cache_usage_ratio = Some(value);
        } else if hints
            .prompt_substrings
            .iter()
            .all(|needle| normalized.contains(&needle.to_ascii_lowercase()))
        {
            metrics.prompt_tokens_per_second = Some(value);
        } else if hints
            .generation_any_of
            .iter()
            .any(|needle| normalized.contains(&needle.to_ascii_lowercase()))
            && hints
                .generation_required
                .iter()
                .all(|needle| normalized.contains(&needle.to_ascii_lowercase()))
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

#[cfg(test)]
mod prometheus_tests {
    use super::{
        parse_prometheus_metrics, parse_prometheus_metrics_with_hints, PrometheusMetricHints,
    };

    #[test]
    fn custom_hints_match_alternate_metric_names() {
        let hints = PrometheusMetricHints {
            kv_substrings: vec!["mykv".into(), "pct".into()],
            prompt_substrings: vec!["ingest".into(), "tok".into(), "sec".into()],
            generation_any_of: vec!["outgen".into()],
            generation_required: vec!["tok".into(), "sec".into()],
        };
        let content = "MYKV_USAGE_PCT 0.33\nINGEST_TOKENS_PER_SEC 10\nOUTGEN_TOKENS_PER_SEC 77\n";
        let m = parse_prometheus_metrics_with_hints(content, &hints);
        assert!((m.kv_cache_usage_ratio.unwrap() - 0.33).abs() < 0.001);
        assert!((m.prompt_tokens_per_second.unwrap() - 10.0).abs() < 0.001);
        assert!((m.tokens_per_second.unwrap() - 77.0).abs() < 0.001);
    }

    #[test]
    fn parses_kv_and_throughput_style_metrics() {
        let content = r#"
# HELP llamacpp_kv_cache_usage_ratio KV cache usage
llamacpp_kv_cache_usage_ratio 0.812
llamacpp_prompt_tokens_seconds 44.2
llamacpp_predicted_tokens_seconds 120.5
"#;
        let m = parse_prometheus_metrics(content);
        assert!((m.kv_cache_usage_ratio.unwrap() - 0.812).abs() < 0.001);
        assert!((m.prompt_tokens_per_second.unwrap() - 44.2).abs() < 0.001);
        assert!((m.tokens_per_second.unwrap() - 120.5).abs() < 0.001);
    }

    #[test]
    fn matches_substring_metric_names() {
        let m = parse_prometheus_metrics("foo_kv_cache_bar_usage_baz 0.25\n");
        assert!((m.kv_cache_usage_ratio.unwrap() - 0.25).abs() < 0.001);
    }
}
