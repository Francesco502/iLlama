#[cfg(unix)]
use illama_lib::{
    parameters::{
        FlashAttentionSetting, GpuLayerSetting, LaunchConfig, StartupParameters, ThreadSetting,
    },
    server_probe::{
        build_command_spec, probe_llama_server_with_timeout, ProbeStatus, ServerCapabilities,
    },
};
#[cfg(unix)]
use std::{
    fs,
    time::{Duration, Instant},
};

#[cfg(unix)]
#[test]
fn discovers_version_and_supported_flags_from_help_output() {
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(
        dir.path().join("fake-llama-server"),
        r#"
if [ "$1" = "--version" ]; then
  echo "llama-server fixture 42"
  exit 0
fi
echo "Usage: llama-server --model FILE --host HOST --port PORT --ctx-size N --metrics --flash-attn MODE"
"#,
    );

    let capabilities =
        probe_llama_server_with_timeout(binary.to_string_lossy().as_ref(), Duration::from_secs(5));

    assert_eq!(
        capabilities.status,
        ProbeStatus::Compatible,
        "probe warnings: {:?}",
        capabilities.warnings
    );
    assert_eq!(
        capabilities.version_text.as_deref(),
        Some("llama-server fixture 42")
    );
    assert!(capabilities
        .supported_flags
        .contains(&"--model".to_string()));
    assert!(capabilities
        .supported_flags
        .contains(&"--flash-attn".to_string()));
}

#[cfg(unix)]
#[test]
fn marks_a_hanging_binary_invalid_after_the_probe_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("hanging-server"), "sleep 1");

    let capabilities = probe_llama_server_with_timeout(
        binary.to_string_lossy().as_ref(),
        Duration::from_millis(50),
    );

    assert_eq!(capabilities.status, ProbeStatus::Invalid);
    assert!(capabilities
        .warnings
        .iter()
        .any(|warning| warning.contains("超时")));
}

#[cfg(unix)]
#[test]
fn probe_timeout_kills_background_processes_holding_output_pipes() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("children.pid");
    fs::write(&pid_file, "").unwrap();
    let binary = write_shell_script(
        dir.path().join("process-tree-server"),
        &format!(
            "trap '' HUP\necho $$ >> '{}'\nsleep 5 &\necho $! >> '{}'\nwait",
            pid_file.to_string_lossy(),
            pid_file.to_string_lossy(),
        ),
    );
    let started = Instant::now();

    let capabilities =
        probe_llama_server_with_timeout(binary.to_string_lossy().as_ref(), Duration::from_secs(1));

    assert_eq!(capabilities.status, ProbeStatus::Invalid);
    assert!(
        capabilities
            .warnings
            .iter()
            .any(|warning| warning.contains("超时")),
        "{:?}",
        capabilities.warnings
    );
    assert!(started.elapsed() < Duration::from_secs(4));
    let pids = fs::read_to_string(pid_file).unwrap();
    assert!(!pids.is_empty());
    for pid in pids.lines() {
        let pid = pid.parse::<i32>().unwrap();
        let alive = unsafe { libc::kill(pid, 0) == 0 };
        assert!(!alive, "background process {pid} survived probe timeout");
    }
}

#[cfg(unix)]
#[test]
fn command_spec_omits_optional_flags_that_the_server_does_not_support() {
    let capabilities = ServerCapabilities {
        binary_path: "/bin/llama-server".to_string(),
        version_text: Some("fixture".to_string()),
        supported_flags: ["--model", "--host", "--port", "--ctx-size"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        status: ProbeStatus::Compatible,
        warnings: Vec::new(),
    };

    let spec = build_command_spec(&config(), &capabilities).unwrap();

    assert!(spec.args.contains(&"--ctx-size".to_string()));
    assert!(!spec.args.contains(&"--metrics".to_string()));
    assert!(!spec.args.contains(&"--flash-attn".to_string()));
    assert!(spec
        .warnings
        .iter()
        .any(|warning| warning.contains("--metrics")));
}

#[cfg(unix)]
fn config() -> LaunchConfig {
    LaunchConfig {
        binary_path: Some("/bin/llama-server".to_string()),
        model_path: Some("/models/a.gguf".to_string()),
        host: "127.0.0.1".to_string(),
        port: 8080,
        parameters: StartupParameters {
            ctx_size: 4096,
            threads: ThreadSetting::Auto,
            threads_batch: ThreadSetting::Auto,
            gpu_layers: GpuLayerSetting::All,
            batch_size: 512,
            ubatch_size: 128,
            flash_attention: FlashAttentionSetting::Auto,
            mmap: true,
            mlock: false,
            metrics: true,
            idle_sleep_seconds: 0,
            mmproj_path: None,
            mmproj_offload: true,
        },
        prometheus_hints: Default::default(),
    }
}

#[cfg(unix)]
fn write_shell_script(path: std::path::PathBuf, body: &str) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;

    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).unwrap();
    path
}
