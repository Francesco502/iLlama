use illama_lib::parameters::{
    build_command_args, validate_launch_config, FlashAttentionSetting, GpuLayerSetting,
    LaunchConfig, StartupParameters, ThreadSetting,
};

fn base_config() -> LaunchConfig {
    LaunchConfig {
        binary_path: Some("/usr/local/bin/llama-server".into()),
        model_path: Some("/models/qwen2.5-7b-instruct-q4_k_m.gguf".into()),
        host: "127.0.0.1".into(),
        port: 8080,
        parameters: StartupParameters {
            ctx_size: 8192,
            threads: ThreadSetting::Auto,
            threads_batch: ThreadSetting::Auto,
            gpu_layers: GpuLayerSetting::Auto,
            batch_size: 1024,
            ubatch_size: 256,
            flash_attention: FlashAttentionSetting::Auto,
            mmap: true,
            mlock: false,
            metrics: true,
            idle_sleep_seconds: 0,
            mmproj_path: None,
            mmproj_offload: true,
        },
    }
}

#[test]
fn builds_balanced_command_args() {
    let args = build_command_args(&base_config());

    assert_eq!(
        args,
        vec![
            "--model",
            "/models/qwen2.5-7b-instruct-q4_k_m.gguf",
            "--host",
            "127.0.0.1",
            "--port",
            "8080",
            "--ctx-size",
            "8192",
            "--threads",
            "-1",
            "--threads-batch",
            "-1",
            "--n-gpu-layers",
            "auto",
            "--batch-size",
            "1024",
            "--ubatch-size",
            "256",
            "--mmap",
            "--metrics",
        ]
    );
}

#[test]
fn includes_multimodal_projector_args() {
    let mut config = base_config();
    config.parameters.mmproj_path = Some("/models/mmproj-qwen2.5-vl.gguf".into());
    config.parameters.mmproj_offload = false;

    let args = build_command_args(&config);

    assert!(args
        .windows(2)
        .any(|pair| pair == ["--mmproj", "/models/mmproj-qwen2.5-vl.gguf"]));
    assert!(args.iter().any(|arg| arg == "--no-mmproj-offload"));
}

#[test]
fn rejects_invalid_port() {
    let mut config = base_config();
    config.port = 80;

    let result = validate_launch_config(&config);

    assert!(!result.valid);
    assert!(result
        .errors
        .contains(&"端口必须在 1024 到 65535 之间。".into()));
}

#[test]
fn rejects_ubatch_larger_than_batch() {
    let mut config = base_config();
    config.parameters.batch_size = 256;
    config.parameters.ubatch_size = 512;

    let result = validate_launch_config(&config);

    assert!(!result.valid);
    assert!(result
        .errors
        .contains(&"Micro-batch 不能大于 batch size。".into()));
}

#[test]
fn deserializes_numeric_thread_and_gpu_values_from_frontend() {
    let json = r#"{
        "binaryPath": "/usr/local/bin/llama-server",
        "modelPath": "/models/qwen.gguf",
        "host": "127.0.0.1",
        "port": 8080,
        "parameters": {
            "ctxSize": 8192,
            "threads": 8,
            "threadsBatch": 4,
            "gpuLayers": 35,
            "batchSize": 1024,
            "ubatchSize": 256,
            "flashAttention": "auto",
            "mmap": true,
            "mlock": false,
            "metrics": true,
            "idleSleepSeconds": 0,
            "mmprojPath": null,
            "mmprojOffload": true
        }
    }"#;

    let config: LaunchConfig = serde_json::from_str(json).unwrap();
    let args = build_command_args(&config);

    assert!(args.windows(2).any(|pair| pair == ["--threads", "8"]));
    assert!(args.windows(2).any(|pair| pair == ["--threads-batch", "4"]));
    assert!(args.windows(2).any(|pair| pair == ["--n-gpu-layers", "35"]));
}
