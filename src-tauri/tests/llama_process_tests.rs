#[cfg(unix)]
use illama_lib::{
    llama_process::{LlamaProcessState, RuntimeStatus},
    parameters::{
        FlashAttentionSetting, GpuLayerSetting, LaunchConfig, StartupParameters, ThreadSetting,
    },
};
#[cfg(unix)]
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    sync::{Mutex, MutexGuard, OnceLock},
    thread,
    time::Duration,
};

#[cfg(unix)]
#[test]
fn start_rejects_an_occupied_port_before_spawning_process() {
    let _guard = process_test_lock();
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
    let _guard = process_test_lock();
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
#[test]
fn start_snapshot_preserves_the_resolved_launch_config() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    fs::write(&model, b"GGUF").unwrap();
    let state = LlamaProcessState::default();

    let snapshot = state
        .start(config(
            binary.to_string_lossy().as_ref(),
            model.to_string_lossy().as_ref(),
            port,
        ))
        .unwrap();

    let active = snapshot.active_launch.expect("active launch snapshot");
    assert_eq!(active.binary_path, binary.to_string_lossy());
    assert_eq!(active.model_path, model.to_string_lossy());
    assert_eq!(active.host, "127.0.0.1");
    assert_eq!(active.port, port);
    assert_eq!(active.parameters.ctx_size, 4096);
    assert_eq!(active.model_id, None);
    assert!(snapshot.pid.is_some());

    state.stop().unwrap();
}

#[cfg(unix)]
#[test]
fn stop_clears_the_active_launch_snapshot() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    fs::write(&model, b"GGUF").unwrap();
    let state = LlamaProcessState::default();
    state
        .start(config(
            binary.to_string_lossy().as_ref(),
            model.to_string_lossy().as_ref(),
            port,
        ))
        .unwrap();

    let stopped = state.stop().unwrap();

    assert_eq!(stopped.status, RuntimeStatus::Stopped);
    assert_eq!(stopped.pid, None);
    assert_eq!(stopped.active_launch, None);
}

#[cfg(unix)]
#[test]
fn refresh_snapshot_confirms_health_and_records_the_api_model_id() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    fs::write(&model, b"GGUF").unwrap();
    let state = LlamaProcessState::default();
    state
        .start(config(
            binary.to_string_lossy().as_ref(),
            model.to_string_lossy().as_ref(),
            port,
        ))
        .unwrap();
    let server = spawn_health_server(port);

    let snapshot = state.refresh_snapshot();

    assert_eq!(snapshot.status, RuntimeStatus::Healthy);
    assert_eq!(
        snapshot.active_launch.and_then(|active| active.model_id),
        Some("fixture-model".to_string())
    );
    server.join().unwrap();
    state.stop().unwrap();
}

#[cfg(unix)]
fn spawn_health_server(port: u16) -> thread::JoinHandle<()> {
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
    thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 2048];
            let read = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..read]);
            let body = if request.starts_with("GET /v1/models") {
                r#"{"data":[{"id":"fixture-model"}]}"#
            } else {
                r#"{"status":"ok"}"#
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).unwrap();
        }
    })
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

#[cfg(unix)]
fn process_test_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

#[cfg(unix)]
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
