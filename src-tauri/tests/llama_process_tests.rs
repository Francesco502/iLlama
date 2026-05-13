use illama_lib::{
    llama_process::{LlamaProcessState, RuntimeStatus},
    parameters::{
        FlashAttentionSetting, GpuLayerSetting, LaunchConfig, StartupParameters, ThreadSetting,
    },
};
use std::{fs, net::TcpListener, thread, time::Duration};

#[cfg(unix)]
#[test]
fn start_rejects_an_occupied_port_before_spawning_process() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    fs::write(&model, b"GGUF").unwrap();
    let state = LlamaProcessState::default();

    let result = state.start(config(
        binary.to_string_lossy().as_ref(),
        model.to_string_lossy().as_ref(),
        port,
    ));

    assert!(result.unwrap_err().contains("端口已被占用"));
}

#[cfg(unix)]
#[test]
fn process_that_exits_before_health_confirmation_is_reported_as_failed() {
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "exit 7");
    let model = dir.path().join("model.gguf");
    fs::write(&model, b"GGUF").unwrap();
    let state = LlamaProcessState::default();

    state
        .start(config(
            binary.to_string_lossy().as_ref(),
            model.to_string_lossy().as_ref(),
            18080,
        ))
        .unwrap();
    let mut snapshot = state.snapshot();
    for _ in 0..20 {
        if snapshot.status != RuntimeStatus::Starting {
            break;
        }
        thread::sleep(Duration::from_millis(50));
        snapshot = state.snapshot();
    }

    assert_eq!(snapshot.status, RuntimeStatus::Failed);
    assert_eq!(
        snapshot.last_error.as_deref(),
        Some("llama-server exited with 7")
    );
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

fn config(binary: &str, model: &str, port: u16) -> LaunchConfig {
    LaunchConfig {
        binary_path: Some(binary.to_string()),
        model_path: Some(model.to_string()),
        host: "127.0.0.1".to_string(),
        port,
        parameters: StartupParameters {
            ctx_size: 4096,
            threads: ThreadSetting::Auto,
            threads_batch: ThreadSetting::Auto,
            gpu_layers: GpuLayerSetting::Fixed(0),
            batch_size: 512,
            ubatch_size: 128,
            flash_attention: FlashAttentionSetting::Auto,
            mmap: true,
            mlock: false,
            metrics: false,
            idle_sleep_seconds: 0,
            mmproj_path: None,
            mmproj_offload: true,
        },
        prometheus_hints: Default::default(),
    }
}
