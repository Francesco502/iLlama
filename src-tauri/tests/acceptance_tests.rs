use illama_lib::acceptance::{
    write_startup_failure_report_from_lookup, NativeAcceptanceMarker, NativeAcceptanceState,
};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, path::Path};

#[test]
fn normal_acceptance_setup_focuses_the_packaged_window_for_trusted_keyboard_input() {
    let source = include_str!("../src/lib.rs");
    let normal_setup = source
        .split("if config.surface == \"normal-app\"")
        .nth(1)
        .expect("normal App setup branch");
    assert!(normal_setup.contains("window.show()"));
    assert!(normal_setup.contains("window.set_focus()"));
}

#[test]
fn acceptance_mode_is_gated_and_config_is_captured_immutably() {
    let dir = tempfile::tempdir().unwrap();
    let mut environment = acceptance_environment(dir.path());
    environment.insert("ILLAMA_ACCEPTANCE_MODE".into(), "0".into());
    let disabled = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    assert!(disabled.config().is_none());

    environment.insert("ILLAMA_ACCEPTANCE_MODE".into(), "1".into());
    let enabled = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    let captured = enabled.config().expect("acceptance config").clone();
    environment.insert(
        "ILLAMA_ACCEPTANCE_REPORT".into(),
        dir.path()
            .join("forged.json")
            .to_string_lossy()
            .into_owned(),
    );

    assert_eq!(enabled.config(), Some(&captured));
    assert_eq!(
        captured.report_path,
        fs::canonicalize(dir.path())
            .unwrap()
            .join("native-report.json")
            .to_string_lossy()
    );
    assert_eq!(captured.occupied_port, 18180);
    assert_eq!(captured.preferred_port, 18181);
    assert_eq!(captured.startup_timeout_ms, 180_000);
    assert_eq!(captured.chat_timeout_ms, 120_000);
    assert_eq!(captured.cancellation_timeout_ms, 120_000);
    assert!(!captured.fixture_control);
    assert_eq!(captured.surface, "deep-runner");
    assert_eq!(captured.run_nonce, "run-nonce-1234");
    assert_eq!(captured.viewport_width, 1180);
    assert_eq!(captured.viewport_height, 760);
}

#[test]
fn bootstrap_markers_are_fixed_and_emitted_only_for_enabled_acceptance() {
    let dir = tempfile::tempdir().unwrap();
    let environment = acceptance_environment(dir.path());
    let enabled = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();

    assert_eq!(
        enabled.marker(NativeAcceptanceMarker::StateEnabled),
        Some("[native-acceptance] state-enabled")
    );
    assert_eq!(
        enabled.marker(NativeAcceptanceMarker::TauriSetup),
        Some("[native-acceptance] tauri-setup")
    );
    assert_eq!(
        enabled.marker(NativeAcceptanceMarker::WebviewIpc),
        Some("[native-acceptance] webview-ipc")
    );
    assert_eq!(
        enabled.marker(NativeAcceptanceMarker::RunnerStarted),
        Some("[native-acceptance] runner-started")
    );

    let disabled = NativeAcceptanceState::from_lookup(|_| None).unwrap();
    assert_eq!(disabled.marker(NativeAcceptanceMarker::StateEnabled), None);
    assert_eq!(disabled.marker(NativeAcceptanceMarker::TauriSetup), None);
    assert_eq!(disabled.marker(NativeAcceptanceMarker::WebviewIpc), None);
    assert_eq!(disabled.marker(NativeAcceptanceMarker::RunnerStarted), None);
}

#[cfg(unix)]
#[test]
fn configured_paths_are_canonicalized_before_the_state_is_captured() {
    use std::os::unix::fs::symlink;

    let real = tempfile::tempdir().unwrap();
    let aliases = tempfile::tempdir().unwrap();
    let alias = aliases.path().join("fixtures-alias");
    symlink(real.path(), &alias).unwrap();
    let environment = acceptance_environment(&alias);

    let state = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    let config = state.config().unwrap();

    assert_eq!(
        config.model_path,
        fs::canonicalize(real.path().join("fixture.gguf"))
            .unwrap()
            .to_string_lossy()
    );
    assert_eq!(
        config.model_directory,
        fs::canonicalize(real.path()).unwrap().to_string_lossy()
    );
    assert_eq!(
        config.report_path,
        fs::canonicalize(real.path())
            .unwrap()
            .join("native-report.json")
            .to_string_lossy()
    );
}

#[test]
fn startup_timeout_defaults_to_three_minutes_and_can_only_be_increased() {
    let dir = tempfile::tempdir().unwrap();
    let mut environment = acceptance_environment(dir.path());
    environment.insert(
        "ILLAMA_ACCEPTANCE_STARTUP_TIMEOUT_MS".into(),
        "240000".into(),
    );
    let increased =
        NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    assert_eq!(increased.config().unwrap().startup_timeout_ms, 240_000);

    environment.insert(
        "ILLAMA_ACCEPTANCE_STARTUP_TIMEOUT_MS".into(),
        "30000".into(),
    );
    let clamped = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    assert_eq!(clamped.config().unwrap().startup_timeout_ms, 180_000);
}

#[test]
fn fixture_health_control_is_enabled_only_by_its_exact_environment_gate() {
    let dir = tempfile::tempdir().unwrap();
    let mut environment = acceptance_environment(dir.path());
    environment.insert("ILLAMA_ACCEPTANCE_FIXTURE_CONTROL".into(), "true".into());
    let disabled = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    assert!(!disabled.config().unwrap().fixture_control);

    environment.insert("ILLAMA_ACCEPTANCE_FIXTURE_CONTROL".into(), "1".into());
    let enabled = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    assert!(enabled.config().unwrap().fixture_control);
}

#[test]
fn normal_surface_uses_only_in_memory_fixture_settings_and_hashes_the_user_file() {
    let dir = tempfile::tempdir().unwrap();
    let mut environment = acceptance_environment(dir.path());
    environment.insert("ILLAMA_ACCEPTANCE_SURFACE".into(), "normal-app".into());
    environment.insert("ILLAMA_ACCEPTANCE_VIEWPORT_WIDTH".into(), "1000".into());
    environment.insert("ILLAMA_ACCEPTANCE_VIEWPORT_HEIGHT".into(), "680".into());
    let state = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();

    let envelope = state.normal_settings_envelope().unwrap().unwrap();
    assert_eq!(
        envelope.settings.llama_server_path.as_deref(),
        Some(state.config().unwrap().binary_path.as_str())
    );
    assert_eq!(
        envelope.settings.model_directories,
        vec![state.config().unwrap().model_directory.clone()]
    );
    assert_eq!(envelope.settings.launch_draft.selected_model_path, None);
    assert!(!envelope.settings.launch_draft.auto_port);
    assert_eq!(envelope.settings.launch_draft.port, 18180);

    let patched = state
        .patch_normal_settings(json!({ "launchDraft": { "port": 18181 } }))
        .unwrap()
        .unwrap();
    assert_eq!(patched.settings.launch_draft.port, 18181);
    assert_eq!(state.set_normal_tray_enabled(true).unwrap(), Some(true));
    assert_eq!(state.normal_tray_enabled().unwrap(), Some(true));

    let user_settings = dir.path().join("user-settings.json");
    fs::write(&user_settings, b"user-owned-bytes").unwrap();
    state.capture_user_settings(&user_settings).unwrap();
    let unchanged = state.settings_isolation_evidence().unwrap();
    assert!(unchanged.unchanged);
    assert_eq!(unchanged.before, unchanged.after);
    fs::write(&user_settings, b"changed").unwrap();
    assert!(!state.settings_isolation_evidence().unwrap().unchanged);
}

#[test]
fn enabled_mode_rejects_relative_or_missing_configured_paths() {
    let dir = tempfile::tempdir().unwrap();
    let mut environment = acceptance_environment(dir.path());
    environment.insert("ILLAMA_ACCEPTANCE_MODEL".into(), "relative.gguf".into());

    let error =
        NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap_err();

    assert!(error.contains("ILLAMA_ACCEPTANCE_MODEL"));
    assert!(error.contains("absolute"));
}

#[test]
fn invalid_startup_config_writes_a_schema_valid_failure_only_to_the_safe_report_path() {
    let dir = tempfile::tempdir().unwrap();
    let mut invalid_environment = acceptance_environment(dir.path());
    invalid_environment.insert("ILLAMA_ACCEPTANCE_MODEL".into(), "relative.gguf".into());
    let config_error =
        NativeAcceptanceState::from_lookup(|key| invalid_environment.get(key).cloned())
            .unwrap_err();

    let written = write_startup_failure_report_from_lookup(
        |key| invalid_environment.get(key).cloned(),
        &config_error,
    )
    .unwrap()
    .expect("failure report path");
    let report: Value = serde_json::from_slice(&fs::read(&written).unwrap()).unwrap();
    assert_eq!(report["schemaVersion"], json!(1));
    assert_eq!(report["kind"], json!("native-tauri"));
    assert_eq!(report["status"], json!("failure"));
    assert_eq!(report["scan"], Value::Null);
    assert_eq!(report["commandSpec"], Value::Null);
    assert_eq!(report["activeLaunch"], Value::Null);
    assert_eq!(report["modelId"], Value::Null);
    assert_eq!(report["chat"], Value::Null);
    assert_eq!(report["cancellation"], Value::Null);
    assert_eq!(report["recovery"], Value::Null);
    assert!(report["error"]
        .as_str()
        .unwrap()
        .contains("ILLAMA_ACCEPTANCE_MODEL"));

    let valid_environment = acceptance_environment(dir.path());
    let valid_state =
        NativeAcceptanceState::from_lookup(|key| valid_environment.get(key).cloned()).unwrap();
    valid_state.validate_finish(&report, 1).unwrap();

    let disabled_report = dir.path().join("disabled-report.json");
    let disabled_environment = HashMap::from([
        ("ILLAMA_ACCEPTANCE_MODE".to_string(), "0".to_string()),
        (
            "ILLAMA_ACCEPTANCE_REPORT".to_string(),
            disabled_report.to_string_lossy().into_owned(),
        ),
    ]);
    assert_eq!(
        write_startup_failure_report_from_lookup(
            |key| disabled_environment.get(key).cloned(),
            "disabled",
        )
        .unwrap(),
        None
    );
    assert!(!disabled_report.exists());
}

#[test]
fn report_write_is_atomic_and_cannot_be_redirected_by_frontend_payload() {
    let dir = tempfile::tempdir().unwrap();
    let environment = acceptance_environment(dir.path());
    let state = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    let configured_report = dir.path().join("native-report.json");
    let forged_report = dir.path().join("forged.json");
    let mut report = successful_report(state.config().unwrap());
    report["reportPath"] = Value::String(forged_report.to_string_lossy().into_owned());

    state.write_report(&report).unwrap();

    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&configured_report).unwrap()).unwrap(),
        report
    );
    assert!(!forged_report.exists());
    let leftovers: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "atomic temp files must be renamed away"
    );
}

#[test]
fn finish_validation_rejects_invalid_schema_kind_status_and_exit_code() {
    let dir = tempfile::tempdir().unwrap();
    let environment = acceptance_environment(dir.path());
    let state = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    let success = successful_report(state.config().unwrap());

    state.validate_finish(&success, 0).unwrap();
    assert!(state.validate_finish(&success, 1).is_err());
    assert!(state.validate_finish(&success, 2).is_err());

    let mut failure = successful_report(state.config().unwrap());
    failure["status"] = Value::String("failure".into());
    failure["error"] = Value::String("injected failure".into());
    failure["steps"] = json!([{
        "name": "acceptance-failure",
        "status": "failure",
        "transport": "tauri-ipc",
        "detail": "injected failure"
    }]);
    state.validate_finish(&failure, 1).unwrap();
    assert!(state.validate_finish(&failure, 0).is_err());

    for (field, replacement) in [
        ("schemaVersion", json!(2)),
        ("kind", json!("browser-preview")),
        ("status", json!("operator-entered")),
        ("steps", json!("not-an-array")),
    ] {
        let mut invalid = successful_report(state.config().unwrap());
        invalid[field] = replacement;
        assert!(
            state.validate_finish(&invalid, 0).is_err(),
            "{field} must be validated"
        );
    }
}

#[test]
fn report_schema_rejects_wrong_surface_nonce_transport_order_duplicates_and_empty_nested_objects() {
    let dir = tempfile::tempdir().unwrap();
    let environment = acceptance_environment(dir.path());
    let state = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    let config = state.config().unwrap();

    for (label, mutate) in [
        ("surface", ("surface", json!("normal-app"))),
        ("run nonce", ("runNonce", json!("stale-run-nonce"))),
        ("version", ("appVersion", json!("3.1.9"))),
        ("required stop", ("stop", json!({}))),
        ("nested command spec", ("commandSpec", json!({}))),
    ] {
        let mut invalid = successful_report(config);
        invalid[mutate.0] = mutate.1;
        assert!(
            state.validate_finish(&invalid, 0).is_err(),
            "{label} must be rejected"
        );
    }

    let mut wrong_transport = successful_report(config);
    wrong_transport["steps"][0]["transport"] = json!("webview-http");
    assert!(state.validate_finish(&wrong_transport, 0).is_err());

    let mut out_of_order = successful_report(config);
    out_of_order["steps"].as_array_mut().unwrap().swap(0, 1);
    assert!(state.validate_finish(&out_of_order, 0).is_err());

    let mut duplicate = successful_report(config);
    let repeated = duplicate["steps"][0].clone();
    duplicate["steps"].as_array_mut().unwrap().push(repeated);
    assert!(state.validate_finish(&duplicate, 0).is_err());
}

#[test]
fn normal_report_requires_exact_steps_trusted_inputs_layout_and_settings_hashes() {
    let dir = tempfile::tempdir().unwrap();
    let mut environment = acceptance_environment(dir.path());
    environment.insert("ILLAMA_ACCEPTANCE_SURFACE".into(), "normal-app".into());
    environment.insert("ILLAMA_ACCEPTANCE_VIEWPORT_WIDTH".into(), "1000".into());
    environment.insert("ILLAMA_ACCEPTANCE_VIEWPORT_HEIGHT".into(), "680".into());
    let state = NativeAcceptanceState::from_lookup(|key| environment.get(key).cloned()).unwrap();
    let report = successful_normal_report(state.config().unwrap());

    state.validate_finish(&report, 0).unwrap();

    let mut untrusted = report.clone();
    untrusted["trustedInputs"][0]["isTrusted"] = json!(false);
    assert!(state.validate_finish(&untrusted, 0).is_err());

    let mut changed_settings = report.clone();
    changed_settings["settingsIsolation"]["after"]["byteLength"] = json!(1);
    assert!(state.validate_finish(&changed_settings, 0).is_err());

    let mut hidden_target = report;
    hidden_target["layout"]["targets"][0]["withinViewport"] = json!(false);
    assert!(state.validate_finish(&hidden_target, 0).is_err());
}

fn acceptance_environment(root: &Path) -> HashMap<String, String> {
    let binary = root.join("fake-llama-server");
    let model = root.join("fixture.gguf");
    fs::write(&binary, b"fixture").unwrap();
    fs::write(&model, b"fixture").unwrap();
    HashMap::from([
        ("ILLAMA_ACCEPTANCE_MODE".into(), "1".into()),
        ("ILLAMA_ACCEPTANCE_SURFACE".into(), "deep-runner".into()),
        (
            "ILLAMA_ACCEPTANCE_RUN_NONCE".into(),
            "run-nonce-1234".into(),
        ),
        (
            "ILLAMA_ACCEPTANCE_BINARY".into(),
            binary.to_string_lossy().into_owned(),
        ),
        (
            "ILLAMA_ACCEPTANCE_MODEL".into(),
            model.to_string_lossy().into_owned(),
        ),
        (
            "ILLAMA_ACCEPTANCE_MODEL_DIRECTORY".into(),
            root.to_string_lossy().into_owned(),
        ),
        (
            "ILLAMA_ACCEPTANCE_REPORT".into(),
            root.join("native-report.json")
                .to_string_lossy()
                .into_owned(),
        ),
        ("ILLAMA_ACCEPTANCE_OCCUPIED_PORT".into(), "18180".into()),
        ("ILLAMA_ACCEPTANCE_PREFERRED_PORT".into(), "18181".into()),
        ("ILLAMA_ACCEPTANCE_VIEWPORT_WIDTH".into(), "1180".into()),
        ("ILLAMA_ACCEPTANCE_VIEWPORT_HEIGHT".into(), "760".into()),
    ])
}

fn successful_report(config: &illama_lib::acceptance::NativeAcceptanceConfig) -> Value {
    let args = json!([
        "--model",
        config.model_path,
        "--host",
        "127.0.0.1",
        "--port",
        "18181"
    ]);
    let steps = [
        ("tauri-runtime", "tauri-ipc"),
        ("scan-model-directory", "tauri-ipc"),
        ("probe-llama-server", "tauri-ipc"),
        ("build-command-spec", "tauri-ipc"),
        ("occupied-port-recovery", "tauri-ipc"),
        ("start-llama", "tauri-ipc"),
        ("healthy-runtime-snapshot", "tauri-ipc"),
        ("models", "tauri-ipc"),
        ("non-stream-chat", "webview-http"),
        ("stream-cancellation", "webview-http"),
        ("stop-llama", "tauri-ipc"),
        ("port-closed", "tauri-ipc"),
    ]
    .into_iter()
    .map(|(name, transport)| {
        json!({
            "name": name,
            "status": "success",
            "transport": transport
        })
    })
    .collect::<Vec<_>>();
    json!({
        "schemaVersion": 1,
        "kind": "native-tauri",
        "surface": "deep-runner",
        "runNonce": config.run_nonce,
        "status": "success",
        "appVersion": "3.2.0",
        "steps": steps,
        "scan": {
            "requestId": "native-acceptance-run-nonce-1234",
            "directory": config.model_directory,
            "filesScanned": 1,
            "modelsFound": 1,
            "configuredModel": {
                "path": config.model_path,
                "metadataStatus": "ready",
                "available": true
            },
            "rejectedInvalidModels": []
        },
        "commandSpec": {
            "executable": config.binary_path,
            "args": args,
            "warnings": [],
            "capabilities": {
                "binaryPath": config.binary_path,
                "supportedFlags": ["--model", "--host", "--port"],
                "status": "compatible",
                "warnings": []
            }
        },
        "activeLaunch": {
            "binaryPath": config.binary_path,
            "modelPath": config.model_path,
            "host": "127.0.0.1",
            "port": 18181,
            "parameters": { "ctxSize": { "source": "argument", "value": 2048 } },
            "commandArgs": args,
            "startedAt": "2026-07-22T00:00:00Z",
            "modelId": "fixture-model"
        },
        "modelId": "fixture-model",
        "chat": { "content": "OK", "finishReason": "stop" },
        "cancellation": {
            "abortControllerAborted": true,
            "abortErrorObserved": true,
            "streamStarted": true
        },
        "recovery": {
            "code": "port_unavailable",
            "message": "port occupied",
            "recoveryAction": "changePort",
            "exercised": true
        },
        "stop": { "pid": null, "activeLaunch": null, "portReachable": false },
        "startedPid": 4321,
        "healthTransition": {
            "exercised": false,
            "healthyStatus": "healthy",
            "degradedStatus": null,
            "recoveredStatus": null
        }
    })
}

fn successful_normal_report(config: &illama_lib::acceptance::NativeAcceptanceConfig) -> Value {
    let deep = successful_report(config);
    let step_pairs = [
        ("normal-app-mounted", "tauri-ipc"),
        ("settings-isolated", "tauri-ipc"),
        ("scan-model-directory", "tauri-ipc"),
        ("keyboard-select-model", "trusted-os-input"),
        ("occupied-port-visible-recovery", "trusted-os-input"),
        ("keyboard-change-port", "trusted-os-input"),
        ("keyboard-start-llama", "trusted-os-input"),
        ("healthy-runtime-snapshot", "tauri-ipc"),
        ("keyboard-connection-check", "trusted-os-input"),
        ("models", "webview-http"),
        ("keyboard-open-test", "trusted-os-input"),
        ("keyboard-send-stream", "trusted-os-input"),
        ("stream-started", "webview-http"),
        ("keyboard-cancel-stream", "trusted-os-input"),
        ("server-disconnect", "webview-http"),
        ("keyboard-stop-llama", "trusted-os-input"),
        ("port-closed", "tauri-ipc"),
        ("layout-no-overflow", "dom-layout"),
    ];
    let steps = step_pairs
        .into_iter()
        .map(|(name, transport)| {
            json!({
                "name": name,
                "status": "success",
                "transport": transport
            })
        })
        .collect::<Vec<_>>();
    let activation_targets = [
        "model-option",
        "start",
        "change-port",
        "start",
        "connection-check",
        "open-test",
        "chat-input",
        "cancel-stream",
        "tab-run",
        "stop",
    ];
    let trusted_inputs = activation_targets
        .iter()
        .enumerate()
        .map(|(index, target)| {
            json!({
                "sequence": index + 1,
                "eventType": "keydown",
                "key": "Enter",
                "target": target,
                "isTrusted": true
            })
        })
        .collect::<Vec<_>>();
    let unique_targets = [
        "model-option",
        "start",
        "change-port",
        "connection-check",
        "open-test",
        "chat-input",
        "cancel-stream",
        "tab-run",
        "stop",
    ];
    let targets = unique_targets
        .into_iter()
        .map(|target| {
            json!({
                "target": target,
                "focusObserved": true,
                "enabled": true,
                "visible": true,
                "withinViewport": true
            })
        })
        .collect::<Vec<_>>();
    let missing_settings = json!({ "exists": false, "byteLength": 0, "sha256": null });
    json!({
        "schemaVersion": 1,
        "kind": "normal-app-keyboard",
        "surface": "normal-app",
        "runNonce": config.run_nonce,
        "status": "success",
        "appVersion": "3.2.0",
        "steps": steps,
        "scan": {
            "directory": config.model_directory,
            "filesScanned": 1,
            "modelsFound": 1,
            "configuredModel": {
                "path": config.model_path,
                "metadataStatus": "ready",
                "available": true
            }
        },
        "activeLaunch": deep["activeLaunch"],
        "modelId": "fixture-model",
        "connection": { "checked": true, "ok": true, "models": ["fixture-model"] },
        "chat": {
            "prompt": "slow cancellation acceptance",
            "streamStarted": true,
            "contentObserved": "partial"
        },
        "cancellation": {
            "cancelControlActivated": true,
            "cancelledUiObserved": true,
            "serverDisconnectObserved": true
        },
        "recovery": {
            "code": "port_unavailable",
            "message": "visible occupied port error",
            "recoveryAction": "changePort",
            "exercised": true,
            "visible": true
        },
        "stop": { "pid": null, "activeLaunch": null, "portReachable": false },
        "startedPid": 4321,
        "trustedInputs": trusted_inputs,
        "layout": {
            "requestedWidth": 1000,
            "requestedHeight": 680,
            "viewportWidth": 1000,
            "viewportHeight": 680,
            "documentScrollWidth": 1000,
            "documentScrollHeight": 680,
            "overflowX": false,
            "overflowY": false,
            "targets": targets
        },
        "settingsIsolation": {
            "mode": "in-memory",
            "path": "/Users/test/Library/Application Support/com.illama.mac/settings.json",
            "before": missing_settings,
            "after": missing_settings,
            "unchanged": true
        }
    })
}
