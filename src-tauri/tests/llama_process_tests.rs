#[cfg(unix)]
use illama_lib::{
    llama_process::{LlamaProcessState, RuntimeStatus},
    parameters::{
        AppliedParameter, FlashAttentionSetting, GpuLayerSetting, LaunchConfig, StartupParameters,
        ThreadSetting,
    },
    server_probe::{CommandSpec, ProbeStatus, ServerCapabilities},
};
#[cfg(unix)]
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::{Mutex, MutexGuard, OnceLock},
    thread,
    time::{Duration, Instant},
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
    write_minimal_gguf(&model);
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
    write_minimal_gguf(&model);
    let state = LlamaProcessState::default();

    state
        .start(config(
            binary.to_string_lossy().as_ref(),
            model.to_string_lossy().as_ref(),
            18080,
        ))
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let snapshot = loop {
        let snapshot = state.snapshot();
        if snapshot.status != RuntimeStatus::Starting || Instant::now() >= deadline {
            break snapshot;
        }
        thread::sleep(Duration::from_millis(20));
    };

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
    write_minimal_gguf(&model);
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
    assert_eq!(
        active.parameters.ctx_size,
        AppliedParameter::Argument { value: 4096 }
    );
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
    write_minimal_gguf(&model);
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
    write_minimal_gguf(&model);
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
#[test]
fn refresh_snapshot_downgrades_a_previously_healthy_process_when_health_fails() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    write_minimal_gguf(&model);
    let state = LlamaProcessState::default();
    state
        .start(config(
            binary.to_string_lossy().as_ref(),
            model.to_string_lossy().as_ref(),
            port,
        ))
        .unwrap();
    let server = spawn_health_server(port);
    assert_eq!(state.refresh_snapshot().status, RuntimeStatus::Healthy);
    server.join().unwrap();

    let snapshot = state.refresh_snapshot();

    assert_eq!(snapshot.status, RuntimeStatus::Starting);
    assert!(snapshot.pid.is_some());
    state.stop().unwrap();
}

#[cfg(unix)]
#[test]
fn active_launch_marks_omitted_parameters_as_server_defaults() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    write_minimal_gguf(&model);
    let mut requested = config(
        binary.to_string_lossy().as_ref(),
        model.to_string_lossy().as_ref(),
        port,
    );
    requested.parameters.metrics = true;
    requested.parameters.mmap = false;
    requested.parameters.flash_attention = FlashAttentionSetting::On;
    let capabilities = ServerCapabilities {
        binary_path: binary.to_string_lossy().to_string(),
        version_text: Some("fixture".to_string()),
        supported_flags: vec!["--model".into(), "--host".into(), "--port".into()],
        status: ProbeStatus::Compatible,
        warnings: vec![],
    };
    let spec = CommandSpec {
        executable: capabilities.binary_path.clone(),
        args: vec![
            "--model".into(),
            model.to_string_lossy().to_string(),
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
        ],
        warnings: vec![],
        capabilities,
    };
    let state = LlamaProcessState::default();

    let active = state
        .start_with_spec(requested, spec)
        .unwrap()
        .active_launch
        .unwrap();

    assert_eq!(
        active.parameters.ctx_size,
        AppliedParameter::ServerDefault { value: () }
    );
    assert_eq!(
        active.parameters.mmap,
        AppliedParameter::ServerDefault { value: () }
    );
    assert_eq!(
        active.parameters.flash_attention,
        AppliedParameter::ServerDefault { value: () }
    );
    assert_eq!(
        active.parameters.metrics,
        AppliedParameter::ServerDefault { value: () }
    );
    assert_eq!(active.command_args, spec_args(model.as_path(), port));
    state.stop().unwrap();
}

#[cfg(unix)]
#[test]
fn active_launch_uses_values_from_the_authoritative_command_spec() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    write_minimal_gguf(&model);
    let requested = config(
        binary.to_string_lossy().as_ref(),
        model.to_string_lossy().as_ref(),
        port,
    );
    let capabilities = ServerCapabilities {
        binary_path: binary.to_string_lossy().to_string(),
        version_text: Some("fixture".to_string()),
        supported_flags: vec![
            "--model".into(),
            "--host".into(),
            "--port".into(),
            "--ctx-size".into(),
            "--no-mmap".into(),
            "--flash-attn".into(),
            "--metrics".into(),
        ],
        status: ProbeStatus::Compatible,
        warnings: vec![],
    };
    let mut args = spec_args(model.as_path(), port);
    args.extend([
        "--ctx-size".into(),
        "8192".into(),
        "--no-mmap".into(),
        "--flash-attn".into(),
        "on".into(),
        "--metrics".into(),
    ]);
    let spec = CommandSpec {
        executable: capabilities.binary_path.clone(),
        args: args.clone(),
        warnings: vec![],
        capabilities,
    };
    let state = LlamaProcessState::default();

    let active = state
        .start_with_spec(requested, spec)
        .unwrap()
        .active_launch
        .unwrap();

    assert_eq!(active.command_args, args);
    assert_eq!(
        active.parameters.ctx_size,
        AppliedParameter::Argument { value: 8192 }
    );
    assert_eq!(
        active.parameters.mmap,
        AppliedParameter::Argument { value: false }
    );
    assert_eq!(
        active.parameters.flash_attention,
        AppliedParameter::Argument {
            value: FlashAttentionSetting::On,
        }
    );
    assert_eq!(
        active.parameters.metrics,
        AppliedParameter::Argument { value: true }
    );
    state.stop().unwrap();
}

#[cfg(unix)]
#[test]
fn start_accepts_a_model_path_beginning_with_double_dash() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model_file = tempfile::Builder::new()
        .prefix("--model-")
        .suffix(".gguf")
        .tempfile_in(".")
        .unwrap();
    write_minimal_gguf(model_file.path());
    let model_arg = model_file
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let requested = config(binary.to_string_lossy().as_ref(), &model_arg, port);
    let spec = spec_for(
        &binary,
        Path::new(&model_arg),
        port,
        spec_args(Path::new(&model_arg), port),
    );
    let state = LlamaProcessState::default();

    let active = state
        .start_with_spec(requested, spec)
        .unwrap()
        .active_launch
        .unwrap();

    assert_eq!(active.model_path, model_arg);
    state.stop().unwrap();
}

#[cfg(unix)]
#[test]
fn start_accepts_an_mmproj_path_beginning_with_double_dash() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    write_minimal_gguf(&model);
    let mut requested = config(
        binary.to_string_lossy().as_ref(),
        model.to_string_lossy().as_ref(),
        port,
    );
    requested.parameters.mmproj_path = Some("--projector.gguf".into());
    let mut args = spec_args(&model, port);
    args.extend(["--mmproj".into(), "--projector.gguf".into()]);
    let spec = spec_for(&binary, &model, port, args);
    let state = LlamaProcessState::default();

    let active = state
        .start_with_spec(requested, spec)
        .unwrap()
        .active_launch
        .unwrap();

    assert_eq!(
        active.parameters.mmproj_path,
        AppliedParameter::Argument {
            value: "--projector.gguf".into(),
        }
    );
    state.stop().unwrap();
}

#[cfg(unix)]
#[test]
fn start_rejects_command_spec_core_values_that_do_not_match_config_before_spawn() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("spawned");
    let binary = write_shell_script(
        dir.path().join("fake-llama-server"),
        &format!("touch '{}'; sleep 5", marker.display()),
    );
    let other_binary = write_shell_script(dir.path().join("other-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    let other_model = dir.path().join("other.gguf");
    write_minimal_gguf(&model);
    write_minimal_gguf(&other_model);
    let requested = config(
        binary.to_string_lossy().as_ref(),
        model.to_string_lossy().as_ref(),
        port,
    );
    let base = spec_for(&binary, &model, port, spec_args(&model, port));
    let mut mismatches = Vec::new();
    mismatches.push(CommandSpec {
        executable: other_binary.to_string_lossy().to_string(),
        ..base.clone()
    });
    mismatches.push(spec_for(
        &binary,
        &model,
        port,
        spec_args(&other_model, port),
    ));
    let mut host_args = spec_args(&model, port);
    host_args[3] = "0.0.0.0".into();
    mismatches.push(spec_for(&binary, &model, port, host_args));
    let mut port_args = spec_args(&model, port);
    port_args[5] = port.saturating_add(1).to_string();
    mismatches.push(spec_for(&binary, &model, port, port_args));

    for spec in mismatches {
        let error = LlamaProcessState::default()
            .start_with_spec(requested.clone(), spec)
            .unwrap_err();
        assert!(error.contains("CommandSpec"), "unexpected error: {error}");
        assert!(!marker.exists(), "invalid spec spawned the process");
    }
}

#[cfg(unix)]
#[test]
fn start_rejects_malformed_or_conflicting_known_argv_before_spawn() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("spawned");
    let binary = write_shell_script(
        dir.path().join("fake-llama-server"),
        &format!("touch '{}'; sleep 5", marker.display()),
    );
    let model = dir.path().join("model.gguf");
    write_minimal_gguf(&model);
    let requested = config(
        binary.to_string_lossy().as_ref(),
        model.to_string_lossy().as_ref(),
        port,
    );
    let base = spec_args(&model, port);
    let variants = [
        [base.clone(), vec!["--port".into(), port.to_string()]].concat(),
        [base.clone(), vec!["--mmap".into(), "--no-mmap".into()]].concat(),
        [base.clone(), vec!["--metrics".into(), "--metrics".into()]].concat(),
        [base.clone(), vec!["--mmproj".into(), "--metrics".into()]].concat(),
        [base, vec!["--no-mmproj-offload".into()]].concat(),
    ];

    for args in variants {
        let spec = spec_for(&binary, &model, port, args);
        let error = LlamaProcessState::default()
            .start_with_spec(requested.clone(), spec)
            .unwrap_err();
        assert!(error.contains("启动参数"), "unexpected error: {error}");
        assert!(!marker.exists(), "invalid argv spawned the process");
    }
}

#[cfg(unix)]
#[test]
fn server_default_parameters_serialize_with_explicit_null_values() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    write_minimal_gguf(&model);
    let requested = config(
        binary.to_string_lossy().as_ref(),
        model.to_string_lossy().as_ref(),
        port,
    );
    let spec = spec_for(&binary, &model, port, spec_args(&model, port));
    let state = LlamaProcessState::default();
    let parameters = state
        .start_with_spec(requested, spec)
        .unwrap()
        .active_launch
        .unwrap()
        .parameters;

    let json = serde_json::to_value(parameters).unwrap();
    for parameter in json.as_object().unwrap().values() {
        assert_eq!(parameter["source"], "serverDefault");
        assert!(parameter.get("value").unwrap().is_null());
    }
    state.stop().unwrap();
}

#[cfg(unix)]
#[test]
fn start_rejects_a_model_replaced_with_invalid_gguf_after_scan() {
    let _guard = process_test_lock();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let dir = tempfile::tempdir().unwrap();
    let binary = write_shell_script(dir.path().join("fake-llama-server"), "sleep 5");
    let model = dir.path().join("model.gguf");
    write_minimal_gguf(&model);
    fs::write(&model, b"truncated").unwrap();
    let state = LlamaProcessState::default();

    let error = state
        .start(config(
            binary.to_string_lossy().as_ref(),
            model.to_string_lossy().as_ref(),
            port,
        ))
        .unwrap_err();

    assert!(error.contains("GGUF"));
    assert_eq!(state.snapshot().pid, None);
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
fn write_minimal_gguf(path: &std::path::Path) {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"GGUF");
    bytes.extend_from_slice(&3_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u64.to_le_bytes());
    bytes.extend_from_slice(&0_u64.to_le_bytes());
    bytes.extend_from_slice(&6_u64.to_le_bytes());
    bytes.extend_from_slice(b"weight");
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    bytes.extend_from_slice(&2_u64.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u64.to_le_bytes());
    let padding = (32 - (bytes.len() % 32)) % 32;
    bytes.resize(bytes.len() + padding, 0);
    bytes.extend_from_slice(&[0; 8]);
    fs::write(path, bytes).unwrap();
}

#[cfg(unix)]
fn spec_args(model: &std::path::Path, port: u16) -> Vec<String> {
    vec![
        "--model".into(),
        model.to_string_lossy().to_string(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
    ]
}

#[cfg(unix)]
fn spec_for(
    binary: &std::path::Path,
    _model: &std::path::Path,
    _port: u16,
    args: Vec<String>,
) -> CommandSpec {
    CommandSpec {
        executable: binary.to_string_lossy().to_string(),
        capabilities: ServerCapabilities {
            binary_path: binary.to_string_lossy().to_string(),
            version_text: Some("fixture".to_string()),
            supported_flags: vec![],
            status: ProbeStatus::Compatible,
            warnings: vec![],
        },
        args,
        warnings: vec![],
    }
}

#[cfg(unix)]
fn process_test_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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
