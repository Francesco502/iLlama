use crate::settings::{default_settings, patch_settings_in_memory, AppSettings, SettingsEnvelope};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

static REPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const DEFAULT_STARTUP_TIMEOUT_MS: u64 = 180_000;
const CHAT_TIMEOUT_MS: u64 = 120_000;
const CANCELLATION_TIMEOUT_MS: u64 = 120_000;
const EXTERNAL_CLIENT_TIMEOUT: Duration = Duration::from_secs(300);
const EXTERNAL_CLIENT_METADATA: [(&str, &str); 6] = [
    ("ILLAMA_EXTERNAL_CLIENT_REPORT", "--report"),
    ("ILLAMA_EVIDENCE_HEAD_SHA", "--head-sha"),
    ("ILLAMA_EVIDENCE_WORKFLOW_PATH", "--workflow-path"),
    ("ILLAMA_EVIDENCE_RUN_ID", "--run-id"),
    ("ILLAMA_EVIDENCE_RUN_ATTEMPT", "--run-attempt"),
    ("ILLAMA_EVIDENCE_REPOSITORY", "--repository"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalClientInvocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub report_path: PathBuf,
}

impl ExternalClientInvocation {
    pub fn run(self) -> Result<(), String> {
        let mut child = Command::new(&self.program)
            .args(&self.args)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("unable to start configured external client: {error}"))?;
        let deadline = Instant::now() + EXTERNAL_CLIENT_TIMEOUT;
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => break,
                Ok(Some(status)) => {
                    return Err(format!("configured external client exited with {status}"));
                }
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(100));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "configured external client timed out after {} seconds",
                        EXTERNAL_CLIENT_TIMEOUT.as_secs()
                    ));
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "unable to wait for configured external client: {error}"
                    ));
                }
            }
        }
        if !self.report_path.is_file() {
            return Err(
                "configured external client did not create its evidence report".to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeAcceptanceMarker {
    StateEnabled,
    TauriSetup,
    WebviewIpc,
    RunnerStarted,
}

impl NativeAcceptanceMarker {
    fn text(self) -> &'static str {
        match self {
            Self::StateEnabled => "[native-acceptance] state-enabled",
            Self::TauriSetup => "[native-acceptance] tauri-setup",
            Self::WebviewIpc => "[native-acceptance] webview-ipc",
            Self::RunnerStarted => "[native-acceptance] runner-started",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeAcceptanceConfig {
    pub surface: String,
    pub run_nonce: String,
    pub binary_path: String,
    pub model_path: String,
    pub model_directory: String,
    pub report_path: String,
    pub occupied_port: u16,
    pub preferred_port: u16,
    pub startup_timeout_ms: u64,
    pub chat_timeout_ms: u64,
    pub cancellation_timeout_ms: u64,
    pub fixture_control: bool,
    pub external_client: Option<String>,
    pub viewport_width: u16,
    pub viewport_height: u16,
}

#[derive(Debug)]
pub struct NativeAcceptanceState {
    config: Option<NativeAcceptanceConfig>,
    normal_settings: Mutex<Option<AppSettings>>,
    user_settings_snapshot: Mutex<Option<CapturedSettingsSnapshot>>,
}

impl Default for NativeAcceptanceState {
    fn default() -> Self {
        Self {
            config: None,
            normal_settings: Mutex::new(None),
            user_settings_snapshot: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone)]
struct CapturedSettingsSnapshot {
    path: String,
    before: SettingsFileSnapshot,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFileSnapshot {
    pub exists: bool,
    pub byte_length: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsIsolationEvidence {
    pub mode: String,
    pub path: String,
    pub before: SettingsFileSnapshot,
    pub after: SettingsFileSnapshot,
    pub unchanged: bool,
}

impl NativeAcceptanceState {
    pub fn from_env() -> Result<Self, String> {
        let enabled = env::var("ILLAMA_ACCEPTANCE_MODE").ok().as_deref() == Some("1");
        if enabled {
            eprintln!("{}", NativeAcceptanceMarker::StateEnabled.text());
        }
        match Self::from_lookup(|key| env::var(key).ok()) {
            Ok(state) => Ok(state),
            Err(config_error) => {
                match write_startup_failure_report_from_lookup(
                    |key| env::var(key).ok(),
                    &config_error,
                ) {
                    Ok(_) => Err(config_error),
                    Err(report_error) => Err(format!(
                        "{config_error}; unable to write native acceptance startup failure: {report_error}"
                    )),
                }
            }
        }
    }

    pub fn from_lookup(mut lookup: impl FnMut(&str) -> Option<String>) -> Result<Self, String> {
        if lookup("ILLAMA_ACCEPTANCE_MODE").as_deref() != Some("1") {
            return Ok(Self::default());
        }

        let surface = lookup("ILLAMA_ACCEPTANCE_SURFACE")
            .filter(|value| matches!(value.as_str(), "deep-runner" | "normal-app"))
            .ok_or_else(|| {
                "ILLAMA_ACCEPTANCE_SURFACE must be deep-runner or normal-app".to_string()
            })?;
        let run_nonce = lookup("ILLAMA_ACCEPTANCE_RUN_NONCE")
            .filter(|value| value.len() >= 8 && value.len() <= 128)
            .ok_or_else(|| "ILLAMA_ACCEPTANCE_RUN_NONCE is required".to_string())?;

        let binary_path = required_path(&mut lookup, "ILLAMA_ACCEPTANCE_BINARY", PathKind::File)?;
        let model_path = required_path(&mut lookup, "ILLAMA_ACCEPTANCE_MODEL", PathKind::File)?;
        let model_directory = required_path(
            &mut lookup,
            "ILLAMA_ACCEPTANCE_MODEL_DIRECTORY",
            PathKind::Directory,
        )?;
        let report_path = required_path(&mut lookup, "ILLAMA_ACCEPTANCE_REPORT", PathKind::Report)?;
        ensure_model_belongs_to_directory(&model_path, &model_directory)?;
        let occupied_port = required_port(&mut lookup, "ILLAMA_ACCEPTANCE_OCCUPIED_PORT")?;
        let preferred_port = required_port(&mut lookup, "ILLAMA_ACCEPTANCE_PREFERRED_PORT")?;
        if occupied_port == preferred_port {
            return Err(
                "ILLAMA_ACCEPTANCE_OCCUPIED_PORT and ILLAMA_ACCEPTANCE_PREFERRED_PORT must differ"
                    .to_string(),
            );
        }
        let startup_timeout_ms = optional_timeout(
            &mut lookup,
            "ILLAMA_ACCEPTANCE_STARTUP_TIMEOUT_MS",
            DEFAULT_STARTUP_TIMEOUT_MS,
        )?;
        let fixture_control = lookup("ILLAMA_ACCEPTANCE_FIXTURE_CONTROL").as_deref() == Some("1");
        let external_client = optional_path(
            &mut lookup,
            "ILLAMA_ACCEPTANCE_EXTERNAL_CLIENT",
            PathKind::File,
        )?;
        let viewport_width =
            required_dimension(&mut lookup, "ILLAMA_ACCEPTANCE_VIEWPORT_WIDTH", 1000, 3840)?;
        let viewport_height =
            required_dimension(&mut lookup, "ILLAMA_ACCEPTANCE_VIEWPORT_HEIGHT", 680, 2160)?;

        let config = NativeAcceptanceConfig {
            surface,
            run_nonce,
            binary_path,
            model_path,
            model_directory,
            report_path,
            occupied_port,
            preferred_port,
            startup_timeout_ms,
            chat_timeout_ms: CHAT_TIMEOUT_MS,
            cancellation_timeout_ms: CANCELLATION_TIMEOUT_MS,
            fixture_control,
            external_client,
            viewport_width,
            viewport_height,
        };
        let normal_settings =
            (config.surface == "normal-app").then(|| normal_acceptance_settings(&config));
        Ok(Self {
            config: Some(config),
            normal_settings: Mutex::new(normal_settings),
            user_settings_snapshot: Mutex::new(None),
        })
    }

    pub fn config(&self) -> Option<&NativeAcceptanceConfig> {
        self.config.as_ref()
    }

    pub fn external_client_invocation(
        &self,
        host: &str,
        port: u16,
    ) -> Result<ExternalClientInvocation, String> {
        let config = self
            .config
            .as_ref()
            .filter(|config| config.surface == "deep-runner")
            .ok_or_else(|| "deep native acceptance mode is disabled".to_string())?;
        let script = config
            .external_client
            .as_ref()
            .ok_or_else(|| "native acceptance has no configured external client".to_string())?;
        if host != "127.0.0.1" || port < 1024 {
            return Err("external client must target the active loopback service".to_string());
        }
        let node = discover_node_executable()?;
        let report = env::var("ILLAMA_EXTERNAL_CLIENT_REPORT")
            .map_err(|_| "ILLAMA_EXTERNAL_CLIENT_REPORT is required".to_string())?;
        let report_path = PathBuf::from(validate_path(
            "ILLAMA_EXTERNAL_CLIENT_REPORT",
            report.trim(),
            PathKind::Report,
        )?);
        let mut args = vec![
            script.clone(),
            "--endpoint".to_string(),
            format!("{}://{host}:{port}", "http"),
        ];
        for (key, flag) in EXTERNAL_CLIENT_METADATA {
            let value = env::var(key)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| format!("{key} is required"))?;
            args.push(flag.to_string());
            args.push(if key == "ILLAMA_EXTERNAL_CLIENT_REPORT" {
                report_path.to_string_lossy().to_string()
            } else {
                value
            });
        }
        Ok(ExternalClientInvocation {
            program: node,
            args,
            report_path,
        })
    }

    pub fn marker(&self, marker: NativeAcceptanceMarker) -> Option<&'static str> {
        self.config.as_ref().map(|_| marker.text())
    }

    pub fn emit_marker(&self, marker: NativeAcceptanceMarker) {
        if let Some(text) = self.marker(marker) {
            eprintln!("{text}");
        }
    }

    pub fn is_normal_app(&self) -> bool {
        self.config
            .as_ref()
            .is_some_and(|config| config.surface == "normal-app")
    }

    pub fn normal_settings_envelope(&self) -> Result<Option<SettingsEnvelope>, String> {
        if !self.is_normal_app() {
            return Ok(None);
        }
        let settings = self
            .normal_settings
            .lock()
            .map_err(|_| "normal acceptance settings lock is poisoned".to_string())?
            .clone()
            .ok_or_else(|| "normal acceptance settings are unavailable".to_string())?;
        Ok(Some(SettingsEnvelope {
            settings,
            warnings: Vec::new(),
        }))
    }

    pub fn patch_normal_settings(&self, patch: Value) -> Result<Option<SettingsEnvelope>, String> {
        if !self.is_normal_app() {
            return Ok(None);
        }
        let mut guard = self
            .normal_settings
            .lock()
            .map_err(|_| "normal acceptance settings lock is poisoned".to_string())?;
        let current = guard
            .as_ref()
            .ok_or_else(|| "normal acceptance settings are unavailable".to_string())?;
        let settings =
            patch_settings_in_memory(current, patch).map_err(|error| error.to_string())?;
        *guard = Some(settings.clone());
        Ok(Some(SettingsEnvelope {
            settings,
            warnings: Vec::new(),
        }))
    }

    pub fn normal_tray_enabled(&self) -> Result<Option<bool>, String> {
        Ok(self
            .normal_settings_envelope()?
            .map(|envelope| envelope.settings.ui.show_in_menu_bar))
    }

    pub fn set_normal_tray_enabled(&self, enabled: bool) -> Result<Option<bool>, String> {
        if !self.is_normal_app() {
            return Ok(None);
        }
        let mut guard = self
            .normal_settings
            .lock()
            .map_err(|_| "normal acceptance settings lock is poisoned".to_string())?;
        let settings = guard
            .as_mut()
            .ok_or_else(|| "normal acceptance settings are unavailable".to_string())?;
        settings.ui.show_in_menu_bar = enabled;
        Ok(Some(enabled))
    }

    pub fn capture_user_settings(&self, path: &Path) -> Result<(), String> {
        if !self.is_normal_app() {
            return Ok(());
        }
        let snapshot = CapturedSettingsSnapshot {
            path: path.to_string_lossy().to_string(),
            before: settings_file_snapshot(path)?,
        };
        *self
            .user_settings_snapshot
            .lock()
            .map_err(|_| "settings isolation lock is poisoned".to_string())? = Some(snapshot);
        Ok(())
    }

    pub fn settings_isolation_evidence(&self) -> Result<SettingsIsolationEvidence, String> {
        let captured = self
            .user_settings_snapshot
            .lock()
            .map_err(|_| "settings isolation lock is poisoned".to_string())?
            .clone()
            .ok_or_else(|| "user settings were not captured during Tauri setup".to_string())?;
        let after = settings_file_snapshot(Path::new(&captured.path))?;
        Ok(SettingsIsolationEvidence {
            mode: "in-memory".to_string(),
            path: captured.path,
            unchanged: captured.before == after,
            before: captured.before,
            after,
        })
    }

    pub fn write_report(&self, report: &Value) -> Result<(), String> {
        let config = self
            .config
            .as_ref()
            .ok_or_else(|| "native acceptance mode is disabled".to_string())?;
        validate_report(report, config)?;
        atomic_write_json(Path::new(&config.report_path), report)
    }

    pub fn validate_finish(&self, report: &Value, exit_code: i32) -> Result<(), String> {
        let config = self
            .config
            .as_ref()
            .ok_or_else(|| "native acceptance mode is disabled".to_string())?;
        validate_report(report, config)?;
        let status = report
            .get("status")
            .and_then(Value::as_str)
            .expect("validated status");
        match (status, exit_code) {
            ("success", 0) | ("failure", 1) => Ok(()),
            ("success" | "failure", 0 | 1) => {
                Err("native acceptance status does not match exitCode".to_string())
            }
            _ => Err("native acceptance exitCode must be 0 or 1".to_string()),
        }
    }
}

fn discover_node_executable() -> Result<PathBuf, String> {
    let executable_name = if cfg!(windows) { "node.exe" } else { "node" };
    let path = env::var_os("PATH").unwrap_or_default();
    for directory in env::split_paths(&path).filter(|directory| directory.is_absolute()) {
        let candidate = directory.join(executable_name);
        if candidate.is_file() {
            return fs::canonicalize(&candidate)
                .map_err(|error| format!("unable to resolve node executable: {error}"));
        }
    }
    Err("unable to discover the node executable required by external-client acceptance".to_string())
}

fn normal_acceptance_settings(config: &NativeAcceptanceConfig) -> AppSettings {
    let mut settings = default_settings();
    settings.model_directories = vec![config.model_directory.clone()];
    settings.llama_server_path = Some(config.binary_path.clone());
    settings.launch_draft.selected_model_path = None;
    settings.launch_draft.auto_port = false;
    settings.launch_draft.port = config.occupied_port;
    settings.ui.show_in_menu_bar = false;
    settings.ui.log_panel_open = false;
    settings.ui.advanced_open = false;
    settings
}

fn settings_file_snapshot(path: &Path) -> Result<SettingsFileSnapshot, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let digest = Sha256::digest(&bytes);
            let sha256 = digest
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            Ok(SettingsFileSnapshot {
                exists: true,
                byte_length: bytes.len() as u64,
                sha256: Some(sha256),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(SettingsFileSnapshot {
            exists: false,
            byte_length: 0,
            sha256: None,
        }),
        Err(error) => Err(format!("unable to snapshot user settings: {error}")),
    }
}

pub fn write_startup_failure_report_from_lookup(
    mut lookup: impl FnMut(&str) -> Option<String>,
    config_error: &str,
) -> Result<Option<String>, String> {
    if lookup("ILLAMA_ACCEPTANCE_MODE").as_deref() != Some("1") {
        return Ok(None);
    }
    let surface = lookup("ILLAMA_ACCEPTANCE_SURFACE")
        .filter(|value| matches!(value.as_str(), "deep-runner" | "normal-app"))
        .unwrap_or_else(|| "deep-runner".to_string());
    let run_nonce = lookup("ILLAMA_ACCEPTANCE_RUN_NONCE")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "startup-config-unavailable".to_string());
    let kind = if surface == "normal-app" {
        "normal-app-keyboard"
    } else {
        "native-tauri"
    };
    let report_path = required_path(&mut lookup, "ILLAMA_ACCEPTANCE_REPORT", PathKind::Report)?;
    let report = json!({
        "schemaVersion": 1,
        "kind": kind,
        "surface": surface,
        "runNonce": run_nonce,
        "status": "failure",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "steps": [{
            "name": "acceptance-config",
            "status": "failure",
            "transport": "tauri-ipc",
            "detail": config_error,
        }],
        "scan": null,
        "commandSpec": null,
        "activeLaunch": null,
        "modelId": null,
        "chat": null,
        "cancellation": null,
        "recovery": null,
        "stop": null,
        "startedPid": null,
        "healthTransition": {
            "exercised": false,
            "healthyStatus": "healthy",
            "degradedStatus": null,
            "recoveredStatus": null,
        },
        "connection": null,
        "trustedInputs": [],
        "layout": null,
        "settingsIsolation": null,
        "error": config_error,
    });
    atomic_write_json(Path::new(&report_path), &report)?;
    Ok(Some(report_path))
}

enum PathKind {
    File,
    Directory,
    Report,
}

fn required_path(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &str,
    kind: PathKind,
) -> Result<String, String> {
    let value = lookup(key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required when ILLAMA_ACCEPTANCE_MODE=1"))?;
    validate_path(key, value.trim(), kind)
}

fn optional_path(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &str,
    kind: PathKind,
) -> Result<Option<String>, String> {
    lookup(key)
        .filter(|value| !value.trim().is_empty())
        .map(|value| validate_path(key, value.trim(), kind))
        .transpose()
}

fn validate_path(key: &str, value: &str, kind: PathKind) -> Result<String, String> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err(format!("{key} must be an absolute path"));
    }
    let resolved = match kind {
        PathKind::File if !path.is_file() => {
            return Err(format!("{key} must name an existing file"))
        }
        PathKind::Directory if !path.is_dir() => {
            return Err(format!("{key} must name an existing directory"))
        }
        PathKind::Report => {
            let parent = path
                .parent()
                .ok_or_else(|| format!("{key} must have a parent directory"))?;
            if !parent.is_dir() {
                return Err(format!("{key} parent directory must exist"));
            }
            if path.file_name().is_none() || path.is_dir() {
                return Err(format!("{key} must name a report file"));
            }
            let parent = fs::canonicalize(parent)
                .map_err(|error| format!("{key} parent directory cannot be resolved: {error}"))?;
            parent.join(path.file_name().expect("validated report file name"))
        }
        _ => {
            fs::canonicalize(path).map_err(|error| format!("{key} cannot be resolved: {error}"))?
        }
    };
    Ok(resolved.to_string_lossy().to_string())
}

fn ensure_model_belongs_to_directory(model: &str, directory: &str) -> Result<(), String> {
    let model = fs::canonicalize(model)
        .map_err(|error| format!("ILLAMA_ACCEPTANCE_MODEL cannot be resolved: {error}"))?;
    let directory = fs::canonicalize(directory).map_err(|error| {
        format!("ILLAMA_ACCEPTANCE_MODEL_DIRECTORY cannot be resolved: {error}")
    })?;
    if !model.starts_with(directory) {
        return Err(
            "ILLAMA_ACCEPTANCE_MODEL must be inside ILLAMA_ACCEPTANCE_MODEL_DIRECTORY".to_string(),
        );
    }
    Ok(())
}

fn required_port(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &str,
) -> Result<u16, String> {
    let value =
        lookup(key).ok_or_else(|| format!("{key} is required when ILLAMA_ACCEPTANCE_MODE=1"))?;
    let port = value
        .parse::<u16>()
        .map_err(|_| format!("{key} must be a valid port"))?;
    if port < 1024 {
        return Err(format!("{key} must be between 1024 and 65535"));
    }
    Ok(port)
}

fn required_dimension(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &str,
    minimum: u16,
    maximum: u16,
) -> Result<u16, String> {
    let value = lookup(key).ok_or_else(|| format!("{key} is required"))?;
    let dimension = value
        .parse::<u16>()
        .map_err(|_| format!("{key} must be an integer"))?;
    if !(minimum..=maximum).contains(&dimension) {
        return Err(format!("{key} must be between {minimum} and {maximum}"));
    }
    Ok(dimension)
}

fn optional_timeout(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    key: &str,
    minimum: u64,
) -> Result<u64, String> {
    let Some(value) = lookup(key).filter(|value| !value.trim().is_empty()) else {
        return Ok(minimum);
    };
    let parsed = value
        .parse::<u64>()
        .map_err(|_| format!("{key} must be a positive integer"))?;
    Ok(parsed.max(minimum))
}

fn validate_report(report: &Value, config: &NativeAcceptanceConfig) -> Result<(), String> {
    let object = report
        .as_object()
        .ok_or_else(|| "native acceptance report must be an object".to_string())?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("native acceptance report schemaVersion must be 1".to_string());
    }
    let expected_kind = match config.surface.as_str() {
        "deep-runner" => "native-tauri",
        "normal-app" => "normal-app-keyboard",
        _ => return Err("native acceptance config has an unsupported surface".to_string()),
    };
    if object.get("kind").and_then(Value::as_str) != Some(expected_kind) {
        return Err(format!(
            "native acceptance report kind must be {expected_kind}"
        ));
    }
    if object.get("surface").and_then(Value::as_str) != Some(config.surface.as_str()) {
        return Err(
            "native acceptance report surface does not match the configured surface".into(),
        );
    }
    if object.get("runNonce").and_then(Value::as_str) != Some(config.run_nonce.as_str()) {
        return Err("native acceptance report runNonce does not match this launch".into());
    }
    if !matches!(
        object.get("status").and_then(Value::as_str),
        Some("success" | "failure")
    ) {
        return Err("native acceptance report status must be success or failure".to_string());
    }
    if object.get("appVersion").and_then(Value::as_str) != Some(env!("CARGO_PKG_VERSION")) {
        return Err("native acceptance report appVersion does not match the packaged app".into());
    }
    let steps = object
        .get("steps")
        .and_then(Value::as_array)
        .filter(|steps| !steps.is_empty())
        .ok_or_else(|| "native acceptance report steps must be a non-empty array".to_string())?;
    let mut names = std::collections::HashSet::new();
    for step in steps {
        let step = step
            .as_object()
            .ok_or_else(|| "native acceptance report contains a non-object step".to_string())?;
        let name = nonempty_string(step.get("name"), "step.name")?;
        if !names.insert(name) {
            return Err(format!("native acceptance step {name} must be unique"));
        }
        if !matches!(
            step.get("status").and_then(Value::as_str),
            Some("success" | "failure")
        ) {
            return Err(format!(
                "native acceptance step {name} has an invalid status"
            ));
        }
        if !matches!(
            step.get("transport").and_then(Value::as_str),
            Some("tauri-ipc" | "webview-http" | "trusted-os-input" | "dom-layout")
        ) {
            return Err(format!(
                "native acceptance step {name} has an invalid transport"
            ));
        }
        if step.get("detail").is_some_and(|detail| !detail.is_string()) {
            return Err(format!(
                "native acceptance step {name} has an invalid detail"
            ));
        }
    }
    for field in required_report_fields(config.surface.as_str()) {
        if !object.contains_key(*field) {
            return Err(format!("native acceptance report is missing {field}"));
        }
    }
    match object.get("status").and_then(Value::as_str) {
        Some("success") if config.surface == "deep-runner" => {
            validate_deep_success_report(object, steps, config)
        }
        Some("success") => validate_normal_success_report(object, steps, config),
        Some("failure") => validate_failure_report(object, steps, config),
        _ => unreachable!("status validated above"),
    }
}

fn required_report_fields(surface: &str) -> &'static [&'static str] {
    if surface == "normal-app" {
        &[
            "scan",
            "activeLaunch",
            "modelId",
            "connection",
            "chat",
            "cancellation",
            "recovery",
            "stop",
            "startedPid",
            "trustedInputs",
            "layout",
            "settingsIsolation",
        ]
    } else {
        &[
            "scan",
            "commandSpec",
            "activeLaunch",
            "modelId",
            "chat",
            "cancellation",
            "recovery",
            "stop",
            "startedPid",
            "healthTransition",
        ]
    }
}

fn validate_deep_success_report(
    object: &serde_json::Map<String, Value>,
    steps: &[Value],
    config: &NativeAcceptanceConfig,
) -> Result<(), String> {
    let mut expected = vec![
        ("tauri-runtime", "tauri-ipc"),
        ("scan-model-directory", "tauri-ipc"),
        ("probe-llama-server", "tauri-ipc"),
        ("build-command-spec", "tauri-ipc"),
        ("occupied-port-recovery", "tauri-ipc"),
        ("start-llama", "tauri-ipc"),
        ("healthy-runtime-snapshot", "tauri-ipc"),
        ("models", "tauri-ipc"),
    ];
    if config.fixture_control {
        expected.extend([
            ("health-downgrade", "tauri-ipc"),
            ("health-recovery", "tauri-ipc"),
        ]);
    }
    if config.external_client.is_some() {
        expected.push(("external-client-curl", "tauri-ipc"));
    }
    expected.extend([
        ("non-stream-chat", "webview-http"),
        ("stream-cancellation", "webview-http"),
        ("stop-llama", "tauri-ipc"),
        ("port-closed", "tauri-ipc"),
    ]);
    validate_exact_success_steps(steps, &expected)?;

    validate_scan(object.get("scan"), config)?;
    let spec = required_object(object.get("commandSpec"), "commandSpec")?;
    if spec.get("executable").and_then(Value::as_str) != Some(config.binary_path.as_str()) {
        return Err("commandSpec.executable does not match the configured binary".into());
    }
    let args = nonempty_string_array(spec.get("args"), "commandSpec.args")?;
    let capabilities = required_object(spec.get("capabilities"), "commandSpec.capabilities")?;
    if capabilities.get("binaryPath").and_then(Value::as_str) != Some(config.binary_path.as_str())
        || nonempty_string_array(
            capabilities.get("supportedFlags"),
            "commandSpec.capabilities.supportedFlags",
        )?
        .is_empty()
        || !matches!(
            capabilities.get("status").and_then(Value::as_str),
            Some("compatible" | "limited")
        )
    {
        return Err("commandSpec.capabilities is incomplete".into());
    }
    validate_string_array(
        capabilities.get("warnings"),
        "commandSpec.capabilities.warnings",
    )?;
    validate_string_array(spec.get("warnings"), "commandSpec.warnings")?;

    let active = validate_active_launch(object.get("activeLaunch"), config)?;
    let active_args = nonempty_string_array(active.get("commandArgs"), "activeLaunch.commandArgs")?;
    if args != active_args {
        return Err("activeLaunch.commandArgs does not exactly match commandSpec.args".into());
    }
    validate_common_success_evidence(object, config)?;

    match (&config.external_client, object.get("externalClient")) {
        (Some(expected), Some(value)) => {
            let external = required_object(Some(value), "externalClient")?;
            if external.get("path").and_then(Value::as_str) != Some(expected.as_str())
                || external.get("status").and_then(Value::as_str) != Some("executed")
            {
                return Err("deep externalClient evidence is mismatched".into());
            }
        }
        (None, Some(_)) => return Err("deep report contains an unconfigured externalClient".into()),
        (Some(_), None) => return Err("deep report is missing externalClient evidence".into()),
        (None, None) => {}
    }

    let chat = required_object(object.get("chat"), "chat")?;
    let content = chat
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reasoning_content = chat
        .get("reasoningContent")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if content.trim().is_empty() && reasoning_content.trim().is_empty() {
        return Err("chat must contain content or reasoningContent".into());
    }
    if chat
        .get("finishReason")
        .is_none_or(|value| !(value.is_null() || value.is_string()))
    {
        return Err("chat.finishReason must be string or null".into());
    }
    let cancellation = required_object(object.get("cancellation"), "cancellation")?;
    for field in [
        "abortControllerAborted",
        "abortErrorObserved",
        "streamStarted",
    ] {
        if cancellation.get(field).and_then(Value::as_bool) != Some(true) {
            return Err(format!("cancellation.{field} must be true"));
        }
    }
    validate_recovery(object.get("recovery"))?;
    validate_stopped(object.get("stop"))?;

    let health = required_object(object.get("healthTransition"), "healthTransition")?;
    if health.get("healthyStatus").and_then(Value::as_str) != Some("healthy")
        || health.get("exercised").and_then(Value::as_bool) != Some(config.fixture_control)
    {
        return Err("healthTransition is inconsistent with fixture control".into());
    }
    if config.fixture_control
        && (health.get("degradedStatus").and_then(Value::as_str) != Some("starting")
            || health.get("recoveredStatus").and_then(Value::as_str) != Some("healthy"))
    {
        return Err("healthTransition did not prove Healthy -> Starting -> Healthy".into());
    }
    Ok(())
}

fn validate_normal_success_report(
    object: &serde_json::Map<String, Value>,
    steps: &[Value],
    config: &NativeAcceptanceConfig,
) -> Result<(), String> {
    let expected = [
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
    validate_exact_success_steps(steps, &expected)?;
    validate_normal_scan(object.get("scan"), config)?;
    let active = validate_active_launch(object.get("activeLaunch"), config)?;
    nonempty_string_array(active.get("commandArgs"), "activeLaunch.commandArgs")?;
    validate_common_success_evidence(object, config)?;

    let connection = required_object(object.get("connection"), "connection")?;
    if connection.get("checked").and_then(Value::as_bool) != Some(true)
        || connection.get("ok").and_then(Value::as_bool) != Some(true)
    {
        return Err("normal connection evidence must be checked and successful".into());
    }
    let models = nonempty_string_array(connection.get("models"), "connection.models")?;
    if !models
        .iter()
        .any(|model| Some(model.as_str()) == object.get("modelId").and_then(Value::as_str))
    {
        return Err("normal connection models do not contain modelId".into());
    }
    let chat = required_object(object.get("chat"), "chat")?;
    nonempty_string(chat.get("prompt"), "chat.prompt")?;
    nonempty_string(chat.get("contentObserved"), "chat.contentObserved")?;
    if chat.get("streamStarted").and_then(Value::as_bool) != Some(true) {
        return Err("normal chat did not prove a real stream start".into());
    }
    let cancellation = required_object(object.get("cancellation"), "cancellation")?;
    for field in [
        "cancelControlActivated",
        "cancelledUiObserved",
        "serverDisconnectObserved",
    ] {
        if cancellation.get(field).and_then(Value::as_bool) != Some(true) {
            return Err(format!("normal cancellation.{field} must be true"));
        }
    }
    let recovery = required_object(object.get("recovery"), "recovery")?;
    validate_recovery(object.get("recovery"))?;
    if recovery.get("visible").and_then(Value::as_bool) != Some(true) {
        return Err("normal changePort recovery was not visibly rendered".into());
    }
    validate_stopped(object.get("stop"))?;
    validate_trusted_inputs(object.get("trustedInputs"))?;
    validate_layout(object.get("layout"), config)?;
    validate_settings_isolation(object.get("settingsIsolation"))?;
    match (&config.external_client, object.get("externalClient")) {
        (Some(expected), Some(value)) => {
            let external = required_object(Some(value), "externalClient")?;
            if external.get("path").and_then(Value::as_str) != Some(expected.as_str())
                || external.get("status").and_then(Value::as_str) != Some("configured")
            {
                return Err("normal externalClient evidence is mismatched".into());
            }
        }
        (None, Some(_)) => {
            return Err("normal report contains an unconfigured externalClient".into())
        }
        (Some(_), None) => return Err("normal report is missing externalClient evidence".into()),
        (None, None) => {}
    }
    Ok(())
}

fn validate_failure_report(
    object: &serde_json::Map<String, Value>,
    steps: &[Value],
    config: &NativeAcceptanceConfig,
) -> Result<(), String> {
    nonempty_string(object.get("error"), "error")?;
    let config_failure = steps.len() == 1
        && steps[0].get("name").and_then(Value::as_str) == Some("acceptance-config")
        && steps[0].get("status").and_then(Value::as_str) == Some("failure")
        && steps[0].get("transport").and_then(Value::as_str) == Some("tauri-ipc");
    let runner_failure = steps.iter().any(|step| {
        step.get("name").and_then(Value::as_str) == Some("acceptance-failure")
            && step.get("status").and_then(Value::as_str) == Some("failure")
    });
    if !config_failure && !runner_failure {
        return Err("failure report must contain one explicit acceptance failure step".into());
    }
    if object
        .get("startedPid")
        .is_some_and(|pid| !pid.is_null() && pid.as_u64().is_none_or(|pid| pid <= 1))
    {
        return Err("failure report startedPid must be null or a real PID > 1".into());
    }
    if object.get("scan").is_some_and(|value| !value.is_null()) {
        if config.surface == "normal-app" {
            validate_normal_scan(object.get("scan"), config)?;
        } else {
            validate_scan(object.get("scan"), config)?;
        }
    }
    if object
        .get("activeLaunch")
        .is_some_and(|value| !value.is_null())
    {
        validate_active_launch(object.get("activeLaunch"), config)?;
    }
    for field in ["commandSpec", "chat", "cancellation", "recovery", "stop"] {
        if object
            .get(field)
            .is_some_and(|value| value.as_object().is_some_and(|map| map.is_empty()))
        {
            return Err(format!(
                "failure report {field} cannot be an arbitrary empty object"
            ));
        }
    }
    Ok(())
}

fn validate_exact_success_steps(steps: &[Value], expected: &[(&str, &str)]) -> Result<(), String> {
    if steps.len() != expected.len() {
        return Err("success report steps must equal the exact expected sequence".into());
    }
    for (index, (expected_name, expected_transport)) in expected.iter().enumerate() {
        let step = steps[index]
            .as_object()
            .expect("steps validated as objects");
        if step.get("name").and_then(Value::as_str) != Some(*expected_name)
            || step.get("status").and_then(Value::as_str) != Some("success")
            || step.get("transport").and_then(Value::as_str) != Some(*expected_transport)
        {
            return Err(format!(
                "success report step {index} must be {expected_name} via {expected_transport}"
            ));
        }
    }
    Ok(())
}

fn validate_scan(value: Option<&Value>, config: &NativeAcceptanceConfig) -> Result<(), String> {
    let scan = required_object(value, "scan")?;
    nonempty_string(scan.get("requestId"), "scan.requestId")?;
    nonempty_string(scan.get("directory"), "scan.directory")?;
    positive_u64(scan.get("filesScanned"), "scan.filesScanned")?;
    positive_u64(scan.get("modelsFound"), "scan.modelsFound")?;
    let model = required_object(scan.get("configuredModel"), "scan.configuredModel")?;
    if model.get("path").and_then(Value::as_str) != Some(config.model_path.as_str())
        || model.get("available").and_then(Value::as_bool) != Some(true)
        || !matches!(
            model.get("metadataStatus").and_then(Value::as_str),
            Some("ready" | "limited")
        )
    {
        return Err("scan.configuredModel is not the configured available GGUF".into());
    }
    if !scan
        .get("rejectedInvalidModels")
        .is_some_and(Value::is_array)
    {
        return Err("scan.rejectedInvalidModels must be an array".into());
    }
    Ok(())
}

fn validate_normal_scan(
    value: Option<&Value>,
    config: &NativeAcceptanceConfig,
) -> Result<(), String> {
    let scan = required_object(value, "scan")?;
    if scan.get("directory").and_then(Value::as_str) != Some(config.model_directory.as_str()) {
        return Err("normal scan.directory does not match the configured directory".into());
    }
    positive_u64(scan.get("filesScanned"), "scan.filesScanned")?;
    positive_u64(scan.get("modelsFound"), "scan.modelsFound")?;
    let model = required_object(scan.get("configuredModel"), "scan.configuredModel")?;
    if model.get("path").and_then(Value::as_str) != Some(config.model_path.as_str())
        || model.get("available").and_then(Value::as_bool) != Some(true)
        || !matches!(
            model.get("metadataStatus").and_then(Value::as_str),
            Some("ready" | "limited")
        )
    {
        return Err("normal scan did not expose the configured available GGUF".into());
    }
    Ok(())
}

fn validate_trusted_inputs(value: Option<&Value>) -> Result<(), String> {
    let inputs = value
        .and_then(Value::as_array)
        .filter(|inputs| !inputs.is_empty())
        .ok_or_else(|| "trustedInputs must be a non-empty array".to_string())?;
    let mut last_sequence = 0;
    let mut activations = Vec::new();
    for input in inputs {
        let input = required_object(Some(input), "trustedInputs[]")?;
        let sequence = input
            .get("sequence")
            .and_then(Value::as_u64)
            .filter(|sequence| *sequence > last_sequence)
            .ok_or_else(|| {
                "trustedInputs sequences must be positive, unique, and ordered".to_string()
            })?;
        last_sequence = sequence;
        if input.get("eventType").and_then(Value::as_str) != Some("keydown")
            || input.get("isTrusted").and_then(Value::as_bool) != Some(true)
        {
            return Err("every trustedInputs entry must be an isTrusted=true keydown".into());
        }
        let key = nonempty_string(input.get("key"), "trustedInputs[].key")?;
        let target = nonempty_string(input.get("target"), "trustedInputs[].target")?;
        if key != "Tab" {
            activations.push((target.to_string(), key.to_string()));
        }
    }
    let required = [
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
    let mut cursor = 0;
    for (target, key) in activations {
        if cursor < required.len()
            && target == required[cursor]
            && matches!(key.as_str(), "Enter" | " ")
        {
            cursor += 1;
        }
    }
    if cursor != required.len() {
        return Err(
            "trustedInputs do not prove the required external keyboard activation order".into(),
        );
    }
    Ok(())
}

fn validate_layout(value: Option<&Value>, config: &NativeAcceptanceConfig) -> Result<(), String> {
    let layout = required_object(value, "layout")?;
    if layout.get("requestedWidth").and_then(Value::as_u64)
        != Some(u64::from(config.viewport_width))
        || layout.get("requestedHeight").and_then(Value::as_u64)
            != Some(u64::from(config.viewport_height))
        || layout.get("overflowX").and_then(Value::as_bool) != Some(false)
        || layout.get("overflowY").and_then(Value::as_bool) != Some(false)
    {
        return Err("layout does not match the requested no-overflow viewport".into());
    }
    let viewport_width = positive_u64(layout.get("viewportWidth"), "layout.viewportWidth")?;
    let viewport_height = positive_u64(layout.get("viewportHeight"), "layout.viewportHeight")?;
    if viewport_width + 160 < u64::from(config.viewport_width)
        || viewport_height + 160 < u64::from(config.viewport_height)
    {
        return Err("layout viewport is materially smaller than requested".into());
    }
    positive_u64(
        layout.get("documentScrollWidth"),
        "layout.documentScrollWidth",
    )?;
    positive_u64(
        layout.get("documentScrollHeight"),
        "layout.documentScrollHeight",
    )?;
    let targets = layout
        .get("targets")
        .and_then(Value::as_array)
        .ok_or_else(|| "layout.targets must be an array".to_string())?;
    let required = [
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
    if targets.len() != required.len() {
        return Err(
            "layout.targets must contain each required keyboard target exactly once".into(),
        );
    }
    for expected in required {
        let matches = targets
            .iter()
            .filter(|target| target.get("target").and_then(Value::as_str) == Some(expected))
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(format!("layout target {expected} must appear exactly once"));
        }
        let target = matches[0];
        for field in ["focusObserved", "enabled", "visible", "withinViewport"] {
            if target.get(field).and_then(Value::as_bool) != Some(true) {
                return Err(format!("layout target {expected}.{field} must be true"));
            }
        }
    }
    Ok(())
}

fn validate_settings_isolation(value: Option<&Value>) -> Result<(), String> {
    let isolation = required_object(value, "settingsIsolation")?;
    if isolation.get("mode").and_then(Value::as_str) != Some("in-memory")
        || isolation.get("unchanged").and_then(Value::as_bool) != Some(true)
        || isolation.get("before") != isolation.get("after")
    {
        return Err("settingsIsolation must prove unchanged user settings bytes/hash".into());
    }
    nonempty_string(isolation.get("path"), "settingsIsolation.path")?;
    for field in ["before", "after"] {
        let snapshot =
            required_object(isolation.get(field), &format!("settingsIsolation.{field}"))?;
        let exists = snapshot
            .get("exists")
            .and_then(Value::as_bool)
            .ok_or_else(|| format!("settingsIsolation.{field}.exists must be boolean"))?;
        let bytes = snapshot
            .get("byteLength")
            .and_then(Value::as_u64)
            .ok_or_else(|| format!("settingsIsolation.{field}.byteLength must be an integer"))?;
        if exists {
            let hash = nonempty_string(
                snapshot.get("sha256"),
                &format!("settingsIsolation.{field}.sha256"),
            )?;
            if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("settingsIsolation sha256 must be 64 hexadecimal characters".into());
            }
        } else if bytes != 0 || !snapshot.get("sha256").is_some_and(Value::is_null) {
            return Err("missing settings snapshot must have zero bytes and null sha256".into());
        }
    }
    Ok(())
}

fn validate_active_launch<'a>(
    value: Option<&'a Value>,
    config: &NativeAcceptanceConfig,
) -> Result<&'a serde_json::Map<String, Value>, String> {
    let active = required_object(value, "activeLaunch")?;
    if active.get("binaryPath").and_then(Value::as_str) != Some(config.binary_path.as_str())
        || active.get("modelPath").and_then(Value::as_str) != Some(config.model_path.as_str())
        || active.get("host").and_then(Value::as_str) != Some("127.0.0.1")
        || active
            .get("port")
            .and_then(Value::as_u64)
            .is_none_or(|port| !(1024..=65_535).contains(&port))
        || active
            .get("parameters")
            .and_then(Value::as_object)
            .is_none_or(serde_json::Map::is_empty)
        || active
            .get("startedAt")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    {
        return Err("activeLaunch evidence is incomplete or mismatched".into());
    }
    Ok(active)
}

fn validate_common_success_evidence(
    object: &serde_json::Map<String, Value>,
    config: &NativeAcceptanceConfig,
) -> Result<(), String> {
    let pid = object
        .get("startedPid")
        .and_then(Value::as_u64)
        .ok_or_else(|| "startedPid must be a real PID".to_string())?;
    if pid <= 1 {
        return Err("startedPid must be greater than PID 1".into());
    }
    let model_id = nonempty_string(object.get("modelId"), "modelId")?;
    let active = validate_active_launch(object.get("activeLaunch"), config)?;
    if active.get("modelId").and_then(Value::as_str) != Some(model_id) {
        return Err("activeLaunch.modelId does not match modelId".into());
    }
    Ok(())
}

fn validate_recovery(value: Option<&Value>) -> Result<(), String> {
    let recovery = required_object(value, "recovery")?;
    if recovery.get("code").and_then(Value::as_str) != Some("port_unavailable")
        || recovery.get("recoveryAction").and_then(Value::as_str) != Some("changePort")
        || recovery.get("exercised").and_then(Value::as_bool) != Some(true)
        || recovery
            .get("message")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    {
        return Err("recovery evidence must prove visible structured changePort recovery".into());
    }
    Ok(())
}

fn validate_stopped(value: Option<&Value>) -> Result<(), String> {
    let stop = required_object(value, "stop")?;
    if !stop.get("pid").is_some_and(Value::is_null)
        || !stop.get("activeLaunch").is_some_and(Value::is_null)
        || stop.get("portReachable").and_then(Value::as_bool) != Some(false)
    {
        return Err("stop evidence retained a PID, active launch, or reachable port".into());
    }
    Ok(())
}

fn required_object<'a>(
    value: Option<&'a Value>,
    field: &str,
) -> Result<&'a serde_json::Map<String, Value>, String> {
    value
        .and_then(Value::as_object)
        .filter(|object| !object.is_empty())
        .ok_or_else(|| format!("{field} must be a non-empty object"))
}

fn nonempty_string<'a>(value: Option<&'a Value>, field: &str) -> Result<&'a str, String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{field} must be a non-empty string"))
}

fn positive_u64(value: Option<&Value>, field: &str) -> Result<u64, String> {
    value
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{field} must be a positive integer"))
}

fn nonempty_string_array(value: Option<&Value>, field: &str) -> Result<Vec<String>, String> {
    let values = validate_string_array(value, field)?;
    if values.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    Ok(values)
}

fn validate_string_array(value: Option<&Value>, field: &str) -> Result<Vec<String>, String> {
    let array = value
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{field} must be an array"))?;
    array
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("{field} must contain only strings"))
        })
        .collect()
}

fn atomic_write_json(path: &Path, report: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "configured report path has no parent".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "configured report path has no valid file name".to_string())?;
    let sequence = REPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        sequence
    ));
    let bytes = serde_json::to_vec_pretty(report)
        .map_err(|error| format!("unable to serialize native acceptance report: {error}"))?;

    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("unable to create native acceptance report: {error}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("unable to persist native acceptance report: {error}"))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("unable to publish native acceptance report: {error}"))?;
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| {
                format!("unable to sync native acceptance report directory: {error}")
            })?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
