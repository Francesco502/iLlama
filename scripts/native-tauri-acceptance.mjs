#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMinimalGgufFixture } from "./lib/gguf-fixture.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const EXPECTED_APP_VERSION = JSON.parse(
  await readFile(join(PROJECT_ROOT, "package.json"), "utf8"),
).version;
const DEFAULT_STARTUP_TIMEOUT_MS = 180_000;
const FIXED_CHAT_TIMEOUT_MS = 120_000;
const FIXED_CANCELLATION_TIMEOUT_MS = 120_000;
const BOOTSTRAP_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const NORMAL_FOCUS_TRANSITION_TIMEOUT_MS = 250;
const NORMAL_ACTIVATION_FALLBACK_TIMEOUT_MS = 5_000;
const RUNNER_STARTED_MARKER = "[native-acceptance] runner-started";
const NORMAL_MARKER_PREFIX = "[normal-acceptance] ";
const NORMAL_CHAT_PROMPT = "slow cancellation acceptance";
const INPUT_SOURCE_HELPER_SOURCE = `
import Carbon
import Foundation

enum InputSourceFailure: Error {
    case missingProperty(String)
    case noASCIISource
    case selectionFailed(OSStatus)
    case confirmationTimedOut(String)
}

func stringProperty(_ source: TISInputSource, _ key: CFString) throws -> String {
    guard let raw = TISGetInputSourceProperty(source, key) else {
        throw InputSourceFailure.missingProperty(key as String)
    }
    return Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue() as String
}

func boolProperty(_ source: TISInputSource, _ key: CFString) -> Bool {
    guard let raw = TISGetInputSourceProperty(source, key) else { return false }
    return Unmanaged<CFBoolean>.fromOpaque(raw).takeUnretainedValue() == kCFBooleanTrue
}

func currentSource() -> TISInputSource {
    TISCopyCurrentKeyboardInputSource().takeRetainedValue()
}

func sourceID(_ source: TISInputSource) throws -> String {
    try stringProperty(source, kTISPropertyInputSourceID)
}

func waitForSource(_ id: String) throws {
    for _ in 0..<100 {
        if try sourceID(currentSource()) == id { return }
        Thread.sleep(forTimeInterval: 0.02)
    }
    throw InputSourceFailure.confirmationTimedOut(id)
}

func enabledSources() -> [TISInputSource] {
    let filter = [kTISPropertyInputSourceIsEnabled!: true] as CFDictionary
    return TISCreateInputSourceList(filter, false).takeRetainedValue() as! [TISInputSource]
}

func select(_ source: TISInputSource) throws {
    let status = TISSelectInputSource(source)
    if status != noErr { throw InputSourceFailure.selectionFailed(status) }
    try waitForSource(sourceID(source))
}

func source(withID id: String) throws -> TISInputSource {
    guard let source = enabledSources().first(where: { (try? sourceID($0)) == id }) else {
        throw InputSourceFailure.missingProperty(id)
    }
    return source
}

do {
    guard CommandLine.arguments.count == 3 else { exit(64) }
    let operation = CommandLine.arguments[1]
    let snapshotPath = CommandLine.arguments[2]
    if operation == "enter" {
        let original = currentSource()
        let originalID = try sourceID(original)
        try Data(originalID.utf8).write(
            to: URL(fileURLWithPath: snapshotPath),
            options: .atomic
        )
        if boolProperty(original, kTISPropertyInputSourceIsASCIICapable) {
            try waitForSource(originalID)
        } else {
            guard let ascii = enabledSources().first(where: {
                boolProperty($0, kTISPropertyInputSourceIsASCIICapable)
            }) else { throw InputSourceFailure.noASCIISource }
            try select(ascii)
        }
    } else if operation == "restore" {
        let data = try Data(contentsOf: URL(fileURLWithPath: snapshotPath))
        guard let originalID = String(data: data, encoding: .utf8) else { exit(65) }
        try select(source(withID: originalID))
    } else {
        exit(64)
    }
} catch {
    FileHandle.standardError.write(Data(String(describing: error).utf8))
    exit(1)
}
`;
const REQUIRED_NATIVE_STEPS = [
  ["tauri-runtime", "tauri-ipc"],
  ["scan-model-directory", "tauri-ipc"],
  ["probe-llama-server", "tauri-ipc"],
  ["build-command-spec", "tauri-ipc"],
  ["occupied-port-recovery", "tauri-ipc"],
  ["start-llama", "tauri-ipc"],
  ["healthy-runtime-snapshot", "tauri-ipc"],
  ["models", "tauri-ipc"],
  ["non-stream-chat", "webview-http"],
  ["stream-cancellation", "webview-http"],
  ["stop-llama", "tauri-ipc"],
  ["port-closed", "tauri-ipc"],
];
const REQUIRED_FIXTURE_HEALTH_STEPS = [
  ["health-downgrade", "tauri-ipc"],
  ["health-recovery", "tauri-ipc"],
];
const REQUIRED_NORMAL_STEPS = [
  ["normal-app-mounted", "tauri-ipc"],
  ["settings-isolated", "tauri-ipc"],
  ["scan-model-directory", "tauri-ipc"],
  ["keyboard-select-model", "trusted-os-input"],
  ["occupied-port-visible-recovery", "trusted-os-input"],
  ["keyboard-change-port", "trusted-os-input"],
  ["keyboard-start-llama", "trusted-os-input"],
  ["healthy-runtime-snapshot", "tauri-ipc"],
  ["keyboard-connection-check", "trusted-os-input"],
  ["models", "webview-http"],
  ["keyboard-open-test", "trusted-os-input"],
  ["keyboard-send-stream", "trusted-os-input"],
  ["stream-started", "webview-http"],
  ["keyboard-cancel-stream", "trusted-os-input"],
  ["server-disconnect", "webview-http"],
  ["keyboard-stop-llama", "trusted-os-input"],
  ["port-closed", "tauri-ipc"],
  ["layout-no-overflow", "dom-layout"],
];

export async function ensureAppBundle({ projectRoot = PROJECT_ROOT } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("native Tauri acceptance currently requires macOS");
  }
  await runProcess(
    "npm",
    ["run", "tauri:build", "--", "--debug", "--bundles", "app"],
    { cwd: projectRoot, timeoutMs: 15 * 60_000 },
  );
  const app = join(projectRoot, "src-tauri", "target", "debug", "bundle", "macos", "iLlama.app");
  if (!(await isDirectory(app))) throw new Error(`Tauri build did not produce ${app}`);
  return app;
}

export async function runNativeTauriAcceptance(options = {}) {
  if (process.platform !== "darwin") {
    throw new Error("native Tauri acceptance currently requires macOS");
  }
  const projectRoot = resolve(options.projectRoot ?? PROJECT_ROOT);
  const appPath = resolve(options.app ?? (await ensureAppBundle({ projectRoot })));
  const binaryPath = requireAbsoluteExistingFile(options.binary, "--binary");
  const modelPath = requireAbsoluteExistingFile(options.model, "--model");
  const reportPath = resolve(options.report);
  await mkdir(dirname(reportPath), { recursive: true });
  if (!(await isDirectory(appPath)) || !appPath.endsWith(".app")) {
    throw new Error(`--app must name an existing .app bundle: ${appPath}`);
  }
  const appExecutable = await resolveAppExecutable(appPath);
  const startupTimeoutMs = Math.max(
    DEFAULT_STARTUP_TIMEOUT_MS,
    positiveInteger(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS),
  );
  const fixtureControl = options.fixtureControl === true;
  const surface = options.surface ?? "deep-runner";
  const runNonce = options.runNonce ?? randomUUID();
  const viewportWidth = positiveInteger(options.viewportWidth, 1180);
  const viewportHeight = positiveInteger(options.viewportHeight, 760);
  if (!["deep-runner", "normal-app"].includes(surface)) {
    throw new Error(`unsupported native acceptance surface: ${surface}`);
  }
  const previousReport = await fileStamp(reportPath);
  const userSettingsPath = join(
    homedir(),
    "Library",
    "Application Support",
    "com.illama.mac",
    "settings.json",
  );
  const userSettingsBefore = surface === "normal-app"
    ? await settingsFileEvidence(userSettingsPath)
    : null;
  if (surface === "normal-app") assertTrustedKeyboardEnvironment();
  const occupied = await listenOnEphemeralPort();
  const occupiedPort = occupied.address().port;
  const preferredPort = await reserveFreePort();
  const environment = {
    ...process.env,
    ILLAMA_ACCEPTANCE_MODE: "1",
    ILLAMA_ACCEPTANCE_SURFACE: surface,
    ILLAMA_ACCEPTANCE_RUN_NONCE: runNonce,
    ILLAMA_ACCEPTANCE_VIEWPORT_WIDTH: String(viewportWidth),
    ILLAMA_ACCEPTANCE_VIEWPORT_HEIGHT: String(viewportHeight),
    ILLAMA_ACCEPTANCE_BINARY: binaryPath,
    ILLAMA_ACCEPTANCE_MODEL: modelPath,
    ILLAMA_ACCEPTANCE_MODEL_DIRECTORY: dirname(modelPath),
    ILLAMA_ACCEPTANCE_REPORT: reportPath,
    ILLAMA_ACCEPTANCE_OCCUPIED_PORT: String(occupiedPort),
    ILLAMA_ACCEPTANCE_PREFERRED_PORT: String(preferredPort),
    ILLAMA_ACCEPTANCE_STARTUP_TIMEOUT_MS: String(startupTimeoutMs),
    ILLAMA_ACCEPTANCE_FIXTURE_CONTROL: fixtureControl ? "1" : "0",
    ...(fixtureControl
      ? { FAKE_LLAMA_ACCEPTANCE_CONTROL: "1", FAKE_LLAMA_MODEL_ID: "fixture-model" }
      : {}),
    ...(options.externalClient
      ? { ILLAMA_ACCEPTANCE_EXTERNAL_CLIENT: resolve(options.externalClient) }
      : {}),
  };
  const totalTimeoutMs =
    startupTimeoutMs + FIXED_CHAT_TIMEOUT_MS + FIXED_CANCELLATION_TIMEOUT_MS + 60_000;
  let child = null;
  let childTree = null;
  let launchServicesApp = null;
  let restoreLaunchEnvironment = async () => {};
  const output = { stdout: "", stderr: "" };
  const bootstrapDeadline = Date.now() + BOOTSTRAP_TIMEOUT_MS;

  try {
    if (options.launchViaOpen) {
      launchServicesApp = {
        executablePath: appExecutable,
        baselinePids: listExactExecutablePids(appExecutable),
        pid: null,
      };
      restoreLaunchEnvironment = await installLaunchServicesEnvironment(environment);
      child = spawn("/usr/bin/open", ["-n", "-W", appPath], {
        cwd: projectRoot,
        detached: true,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      childTree = createOwnedProcessTreeTracker({
        rootPid: child.pid,
        rootExecutablePath: "/usr/bin/open",
        processGroupId: child.pid,
      });
    } else {
      child = spawn(appExecutable, [], {
        cwd: projectRoot,
        detached: true,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      childTree = createOwnedProcessTreeTracker({
        rootPid: child.pid,
        rootExecutablePath: appExecutable,
        processGroupId: child.pid,
      });
    }
    child.stdout?.on("data", (chunk) => {
      output.stdout = appendBounded(output.stdout, chunk.toString());
    });
    child.stderr?.on("data", (chunk) => {
      output.stderr = appendBounded(output.stderr, chunk.toString());
    });
    if (launchServicesApp) {
      launchServicesApp = await identifyNewLaunchServicesApp({
        ...launchServicesApp,
        launcher: child,
        timeoutMs: Math.max(1, bootstrapDeadline - Date.now()),
      });
      launchServicesApp.processTree = createOwnedProcessTreeTracker({
        rootPid: launchServicesApp.pid,
        rootExecutablePath: launchServicesApp.executablePath,
      });
    }

    const acceptanceDeadline = Date.now() + totalTimeoutMs;
    const bootstrap = await waitForBootstrapEvidence({
      reportPath,
      previousReport,
      child,
      output,
      timeoutMs: Math.max(1, bootstrapDeadline - Date.now()),
    });
    if (surface === "normal-app" && !bootstrap.report) {
      const appPid = launchServicesApp?.pid ?? child.pid;
      await driveNormalAppWithTrustedKeyboard({
        appPid,
        child,
        output,
        runNonce,
        timeoutMs: Math.max(1, acceptanceDeadline - Date.now()),
      });
    }
    const report = bootstrap.report ?? await waitForFreshReport(
      reportPath,
      previousReport,
      Math.max(1, acceptanceDeadline - Date.now()),
      child,
      output,
    );
    const reportExpected = {
      binaryPath,
      modelPath,
      fixtureControl,
      appVersion: EXPECTED_APP_VERSION,
      surface,
      runNonce,
      viewportWidth,
      viewportHeight,
      externalClient: options.externalClient ? resolve(options.externalClient) : null,
    };
    if (surface === "normal-app") validateNormalAppKeyboardReport(report, reportExpected);
    else validateNativeAcceptanceReport(report, reportExpected);

    const exit = await waitForChildExit(child, 10_000);
    if (!exit.exited) {
      throw new Error("iLlama app did not exit after finish_native_acceptance_command");
    }
    if (exit.signal !== null) {
      throw new Error(`iLlama app exited via signal ${exit.signal}\n${output.stderr.slice(-2_000)}`);
    }
    if (exit.code !== 0) {
      throw new Error(`iLlama app exited with ${exit.code}\n${output.stderr.slice(-2_000)}`);
    }

    if (isProcessAlive(report.startedPid)) {
      throw new Error(`residual llama-server child is still alive (PID ${report.startedPid})`);
    }
    if (await canConnect("127.0.0.1", report.activeLaunch.port, 500)) {
      throw new Error(`residual llama-server port is still reachable (${report.activeLaunch.port})`);
    }

    if (surface === "normal-app") {
      const userSettingsAfter = await settingsFileEvidence(userSettingsPath);
      assertSettingsEvidenceMatches({
        report: report.settingsIsolation,
        expectedPath: userSettingsPath,
        before: userSettingsBefore,
        after: userSettingsAfter,
      });
    }

    return {
      appPath,
      reportPath,
      report,
      stdout: output.stdout,
      stderr: output.stderr,
      artifacts: {
        appExecutable,
        appExecutableSha256: await sha256FilePath(appExecutable),
        binaryPath,
        binarySha256: await sha256FilePath(binaryPath),
        modelPath,
        modelSha256: await sha256FilePath(modelPath),
      },
    };
  } finally {
    await cleanupAcceptanceResources({
      occupied,
      restoreLaunchEnvironment,
      launchServicesApp,
      child,
      childTree,
    });
  }
}

export function validateNativeAcceptanceReport(report, expected) {
  if (!report || typeof report !== "object") throw new Error("native acceptance report must be an object");
  if (report.schemaVersion !== 1) throw new Error("native acceptance schemaVersion must be 1");
  if (report.kind !== "native-tauri") throw new Error("report kind must be native-tauri, not browser preview");
  if (report.surface !== expected.surface) {
    throw new Error(`native acceptance surface must be ${expected.surface}`);
  }
  if (report.runNonce !== expected.runNonce) {
    throw new Error("native acceptance runNonce does not match this launch");
  }
  if (report.status !== "success") throw new Error(`native acceptance status is ${report.status}`);
  if (report.appVersion !== expected.appVersion) {
    throw new Error(`native acceptance appVersion must be ${expected.appVersion}`);
  }
  if (!Number.isInteger(report.startedPid) || report.startedPid <= 0) {
    throw new Error("native acceptance did not record a real child PID");
  }
  if (report.startedPid === 1) throw new Error("native acceptance reported forbidden PID 1");

  requireOrderedUniqueSteps(
    report.steps,
    requiredNativeSteps(expected.fixtureControl, Boolean(expected.externalClient)),
  );
  if (expected.fixtureControl) {
    if (
      report.healthTransition?.exercised !== true ||
      report.healthTransition?.healthyStatus !== "healthy" ||
      report.healthTransition?.degradedStatus !== "starting" ||
      report.healthTransition?.recoveredStatus !== "healthy"
    ) {
      throw new Error("fixture health transition was not exercised as Healthy -> Starting -> Healthy");
    }
    const invalidModels = report.scan?.rejectedInvalidModels;
    if (
      !Array.isArray(invalidModels) ||
      invalidModels.length === 0 ||
      invalidModels.some((model) => model?.metadataStatus !== "invalid" || model.available !== false)
    ) {
      throw new Error("fixture report did not prove an invalid GGUF was classified unavailable");
    }
  }

  const scanned = report.scan?.configuredModel;
  if (scanned?.path !== expected.modelPath) throw new Error("report model does not match configured model");
  if (!scanned.available || !["ready", "limited"].includes(scanned.metadataStatus)) {
    throw new Error("configured model was not accepted by the production GGUF scanner");
  }
  if (
    typeof report.scan?.requestId !== "string" || !report.scan.requestId ||
    typeof report.scan?.directory !== "string" || !report.scan.directory ||
    !Number.isInteger(report.scan?.filesScanned) || report.scan.filesScanned < 1 ||
    !Number.isInteger(report.scan?.modelsFound) || report.scan.modelsFound < 1 ||
    !Array.isArray(report.scan?.rejectedInvalidModels)
  ) {
    throw new Error("scan evidence is incomplete");
  }
  if (report.commandSpec?.executable !== expected.binaryPath) {
    throw new Error("CommandSpec binary does not match configured binary");
  }
  if (
    !Array.isArray(report.commandSpec?.args) || report.commandSpec.args.length === 0 ||
    !Array.isArray(report.commandSpec?.warnings) ||
    report.commandSpec?.capabilities?.binaryPath !== expected.binaryPath ||
    !Array.isArray(report.commandSpec?.capabilities?.supportedFlags) ||
    !["compatible", "limited"].includes(report.commandSpec?.capabilities?.status)
  ) {
    throw new Error("commandSpec evidence is incomplete");
  }
  if (report.activeLaunch?.binaryPath !== expected.binaryPath) {
    throw new Error("activeLaunch binary does not match configured binary");
  }
  if (report.activeLaunch?.modelPath !== expected.modelPath) {
    throw new Error("activeLaunch model does not match configured model");
  }
  if (
    report.activeLaunch?.host !== "127.0.0.1" ||
    typeof report.activeLaunch?.startedAt !== "string" || !report.activeLaunch.startedAt ||
    typeof report.activeLaunch?.parameters !== "object" || report.activeLaunch.parameters === null ||
    Object.keys(report.activeLaunch.parameters).length === 0
  ) {
    throw new Error("activeLaunch evidence is incomplete");
  }
  if (!sameArray(report.commandSpec?.args, report.activeLaunch?.commandArgs)) {
    throw new Error("activeLaunch.commandArgs does not exactly match CommandSpec args");
  }
  const activePort = report.activeLaunch?.port;
  if (!Number.isInteger(activePort) || activePort < 1024 || activePort > 65_535) {
    throw new Error("activeLaunch.port must be an integer between 1024 and 65535");
  }
  requireArg(report.activeLaunch.commandArgs, "--model", expected.modelPath);
  requireArg(report.activeLaunch.commandArgs, "--host", "127.0.0.1");
  requireArg(report.activeLaunch.commandArgs, "--port", String(activePort));
  if (typeof report.modelId !== "string" || !report.modelId) throw new Error("model ID is missing");
  const chatContent = typeof report.chat?.content === "string"
    ? report.chat.content.trim()
    : "";
  const reasoningContent = typeof report.chat?.reasoningContent === "string"
    ? report.chat.reasoningContent.trim()
    : "";
  if (!chatContent && !reasoningContent) {
    throw new Error("non-stream chat evidence is missing");
  }
  if (report.chat?.finishReason !== null && typeof report.chat?.finishReason !== "string") {
    throw new Error("chat finishReason is invalid");
  }
  if (
    report.cancellation?.abortControllerAborted !== true ||
    report.cancellation?.abortErrorObserved !== true ||
    report.cancellation?.streamStarted !== true
  ) {
    throw new Error("AbortController cancellation evidence is incomplete");
  }
  if (
    report.recovery?.code !== "port_unavailable" ||
    typeof report.recovery?.message !== "string" || !report.recovery.message ||
    report.recovery?.recoveryAction !== "changePort" || report.recovery?.exercised !== true
  ) {
    throw new Error("structured changePort recovery evidence is missing");
  }
  if (report.stop?.pid !== null || report.stop?.activeLaunch !== null) {
    throw new Error("stop report retained a child PID or activeLaunch");
  }
  if (report.stop?.portReachable !== false) throw new Error("stopped child port remains reachable");
  if (
    report.healthTransition?.healthyStatus !== "healthy" ||
    typeof report.healthTransition?.exercised !== "boolean"
  ) {
    throw new Error("healthTransition evidence is incomplete");
  }
  if (expected.externalClient) {
    if (
      report.externalClient?.path !== expected.externalClient ||
      report.externalClient?.status !== "executed"
    ) throw new Error("native externalClient was not executed through Tauri IPC");
  } else if (report.externalClient !== undefined) {
    throw new Error("native report contains an unconfigured externalClient");
  }
  return report;
}

export function validateNormalAppKeyboardReport(report, expected) {
  if (!report || typeof report !== "object") throw new Error("normal App report must be an object");
  if (report.schemaVersion !== 1) throw new Error("normal App schemaVersion must be 1");
  if (report.kind !== "normal-app-keyboard") {
    throw new Error("normal App report kind must be normal-app-keyboard, not browser preview");
  }
  if (report.surface !== "normal-app" || report.surface !== expected.surface) {
    throw new Error("normal App report surface is invalid");
  }
  if (report.runNonce !== expected.runNonce) throw new Error("normal App runNonce is stale or mismatched");
  if (report.appVersion !== expected.appVersion) throw new Error("normal App appVersion is mismatched");
  if (report.status !== "success") throw new Error(`normal App status is ${report.status}`);
  requireOrderedUniqueSteps(report.steps, REQUIRED_NORMAL_STEPS);
  if (!Number.isInteger(report.startedPid) || report.startedPid <= 1) {
    throw new Error("normal App did not record a real PID > 1");
  }
  const model = report.scan?.configuredModel;
  if (
    report.scan?.directory !== dirname(expected.modelPath) ||
    !Number.isInteger(report.scan?.filesScanned) || report.scan.filesScanned < 1 ||
    !Number.isInteger(report.scan?.modelsFound) || report.scan.modelsFound < 1 ||
    model?.path !== expected.modelPath || model?.available !== true ||
    !["ready", "limited"].includes(model?.metadataStatus)
  ) {
    throw new Error("normal App scan evidence is incomplete or mismatched");
  }
  if (
    report.activeLaunch?.binaryPath !== expected.binaryPath ||
    report.activeLaunch?.modelPath !== expected.modelPath ||
    report.activeLaunch?.host !== "127.0.0.1" ||
    !Number.isInteger(report.activeLaunch?.port) || report.activeLaunch.port < 1024 ||
    !Array.isArray(report.activeLaunch?.commandArgs) || report.activeLaunch.commandArgs.length === 0 ||
    report.activeLaunch?.modelId !== report.modelId ||
    typeof report.modelId !== "string" || !report.modelId
  ) {
    throw new Error("normal App activeLaunch/model evidence is incomplete");
  }
  if (
    report.connection?.checked !== true || report.connection?.ok !== true ||
    !Array.isArray(report.connection?.models) || !report.connection.models.includes(report.modelId)
  ) {
    throw new Error("normal App real connection/models evidence is incomplete");
  }
  if (
    typeof report.chat?.prompt !== "string" || !report.chat.prompt ||
    report.chat?.streamStarted !== true ||
    typeof report.chat?.contentObserved !== "string" || !report.chat.contentObserved
  ) {
    throw new Error("normal App stream chat evidence is incomplete");
  }
  if (
    report.cancellation?.cancelControlActivated !== true ||
    report.cancellation?.cancelledUiObserved !== true ||
    report.cancellation?.serverDisconnectObserved !== true
  ) {
    throw new Error("normal App cancellation/server disconnect evidence is incomplete");
  }
  if (
    report.recovery?.code !== "port_unavailable" ||
    report.recovery?.recoveryAction !== "changePort" ||
    report.recovery?.exercised !== true || report.recovery?.visible !== true ||
    typeof report.recovery?.message !== "string" || !report.recovery.message
  ) {
    throw new Error("normal App visible occupied-port recovery evidence is incomplete");
  }
  if (
    report.stop?.pid !== null || report.stop?.activeLaunch !== null ||
    report.stop?.portReachable !== false
  ) {
    throw new Error("normal App stop evidence retained a PID, active launch, or reachable port");
  }
  validateTrustedInputEvidence(report.trustedInputs);
  validateNormalLayoutEvidence(report.layout, expected);
  validateSettingsIsolationEvidence(report.settingsIsolation);
  if (expected.externalClient) {
    if (
      report.externalClient?.path !== expected.externalClient ||
      report.externalClient?.status !== "configured"
    ) throw new Error("normal App externalClient evidence is mismatched");
  } else if (report.externalClient !== undefined) {
    throw new Error("normal App report contains an unconfigured externalClient");
  }
  return report;
}

function validateTrustedInputEvidence(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("normal App trustedInputs are missing");
  }
  let previous = 0;
  const activations = [];
  for (const input of inputs) {
    if (
      !Number.isInteger(input?.sequence) || input.sequence <= previous ||
      input?.eventType !== "keydown" || input?.isTrusted !== true ||
      typeof input?.target !== "string" || !input.target ||
      typeof input?.key !== "string" || !input.key
    ) {
      throw new Error("every normal App input must be an ordered event.isTrusted=true keydown");
    }
    previous = input.sequence;
    if (input.key !== "Tab") activations.push(input);
  }
  const required = [
    "model-option", "start", "change-port", "start", "connection-check",
    "open-test", "chat-input", "cancel-stream", "tab-run", "stop",
  ];
  let cursor = 0;
  for (const input of activations) {
    if (
      cursor < required.length && input.target === required[cursor] &&
      ["Enter", " "].includes(input.key)
    ) cursor += 1;
  }
  if (cursor !== required.length) {
    throw new Error("normal App trusted inputs do not match the required activation order");
  }
}

function validateNormalLayoutEvidence(layout, expected) {
  if (
    !layout || layout.requestedWidth !== expected.viewportWidth ||
    layout.requestedHeight !== expected.viewportHeight ||
    layout.overflowX !== false || layout.overflowY !== false ||
    !Number.isInteger(layout.viewportWidth) || layout.viewportWidth < expected.viewportWidth - 160 ||
    !Number.isInteger(layout.viewportHeight) || layout.viewportHeight < expected.viewportHeight - 160 ||
    !Array.isArray(layout.targets)
  ) {
    throw new Error("normal App viewport/layout evidence is incomplete");
  }
  const required = [
    "model-option", "start", "change-port", "connection-check", "open-test",
    "chat-input", "cancel-stream", "tab-run", "stop",
  ];
  for (const target of required) {
    const matches = layout.targets.filter((item) => item?.target === target);
    if (
      matches.length !== 1 || matches[0].focusObserved !== true ||
      matches[0].enabled !== true || matches[0].visible !== true ||
      matches[0].withinViewport !== true
    ) throw new Error(`normal App layout target ${target} is not interactive and in bounds`);
  }
  if (layout.targets.length !== required.length) {
    throw new Error("normal App layout targets must be exact and unique");
  }
}

function validateSettingsIsolationEvidence(evidence) {
  if (
    !evidence || evidence.mode !== "in-memory" || evidence.unchanged !== true ||
    typeof evidence.path !== "string" || !evidence.path ||
    JSON.stringify(evidence.before) !== JSON.stringify(evidence.after)
  ) {
    throw new Error("normal App settings isolation bytes/hash changed");
  }
  for (const snapshot of [evidence.before, evidence.after]) {
    if (
      !snapshot || typeof snapshot.exists !== "boolean" ||
      !Number.isInteger(snapshot.byteLength) || snapshot.byteLength < 0
    ) throw new Error("normal App settings snapshot is invalid");
    if (snapshot.exists) {
      if (typeof snapshot.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(snapshot.sha256)) {
        throw new Error("normal App settings snapshot sha256 is invalid");
      }
    } else if (snapshot.byteLength !== 0 || snapshot.sha256 !== null) {
      throw new Error("normal App absent settings snapshot is inconsistent");
    }
  }
}

async function createDeterministicFixtures() {
  const directory = await mkdtemp(join(tmpdir(), "illama-native-acceptance-"));
  const binary = join(directory, "fake-llama-server");
  const model = join(directory, "fixture.gguf");
  const invalidModel = join(directory, "invalid-header.gguf");
  const report = join(directory, "native-report.json");
  await copyFile(join(PROJECT_ROOT, "scripts", "fake-llama-server.mjs"), binary);
  await chmod(binary, 0o755);
  await writeMinimalGgufFixture(model);
  const invalid = Buffer.alloc(8);
  invalid.write("GGUF", 0, "ascii");
  invalid.writeUInt32LE(3, 4);
  await writeFile(invalidModel, invalid);
  return { directory, binary, model, report };
}

async function main(argv) {
  const options = parseArguments(argv);
  if (!options.binary && !options.model) {
    const fixtures = await createDeterministicFixtures();
    options.binary = fixtures.binary;
    options.model = fixtures.model;
    options.report ??= fixtures.report;
    options.fixtureControl = true;
  } else if (!options.binary || !options.model) {
    throw new Error("--binary and --model must be supplied together");
  }
  options.report ??= join(
    tmpdir(),
    `illama-native-report-${process.pid}-${Date.now()}.json`,
  );
  if (options.surface) {
    if (options.surface === "normal-app") {
      options.viewportWidth ??= 1000;
      options.viewportHeight ??= 680;
    }
    const result = await runNativeTauriAcceptance(options);
    console.log(JSON.stringify(runSummary(result, options), null, 2));
    return;
  }

  const app = options.app ?? await ensureAppBundle({ projectRoot: options.projectRoot });
  const runs = [
    {
      surface: "deep-runner",
      viewportWidth: 1180,
      viewportHeight: 760,
      report: options.report,
    },
    {
      surface: "normal-app",
      viewportWidth: 1000,
      viewportHeight: 680,
      report: suffixedReportPath(options.report, "normal-1000x680"),
    },
    {
      surface: "normal-app",
      viewportWidth: 1280,
      viewportHeight: 720,
      report: suffixedReportPath(options.report, "normal-1280x720"),
    },
  ];
  const results = [];
  for (const run of runs) {
    const result = await runNativeTauriAcceptance({ ...options, ...run, app });
    results.push(runSummary(result, { ...options, ...run }));
  }
  console.log(JSON.stringify({
    status: "success",
    app: resolve(app),
    buildCount: options.app ? 0 : 1,
    runs: results,
  }, null, 2));
}

function parseArguments(argv) {
  const options = { launchViaOpen: false, fixtureControl: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--launch-via-open") {
      options.launchViaOpen = true;
      continue;
    }
    const key = {
      "--app": "app",
      "--binary": "binary",
      "--model": "model",
      "--report": "report",
      "--external-client": "externalClient",
      "--startup-timeout-ms": "startupTimeoutMs",
      "--surface": "surface",
      "--viewport-width": "viewportWidth",
      "--viewport-height": "viewportHeight",
    }[value];
    if (!key || !argv[index + 1]) throw new Error(`unknown or incomplete argument: ${value}`);
    options[key] = argv[++index];
  }
  return options;
}

function suffixedReportPath(path, suffix) {
  return path.endsWith(".json")
    ? `${path.slice(0, -5)}.${suffix}.json`
    : `${path}.${suffix}.json`;
}

function runSummary(result, options) {
  return {
    status: result.report.status,
    surface: result.report.surface,
    runNonce: result.report.runNonce,
    viewport: options.surface === "normal-app"
      ? `${options.viewportWidth}x${options.viewportHeight}`
      : null,
    app: result.appPath,
    report: result.reportPath,
    appVersion: result.report.appVersion,
    modelId: result.report.modelId,
    pid: result.report.startedPid,
    fixtureControl: options.fixtureControl === true,
    artifacts: result.artifacts,
  };
}

async function resolveAppExecutable(appPath) {
  const directory = join(appPath, "Contents", "MacOS");
  const entries = await readdir(directory, { withFileTypes: true });
  const executable = entries.find((entry) => entry.isFile() && !entry.name.startsWith("."));
  if (!executable) throw new Error(`app bundle has no executable in ${directory}`);
  return join(directory, executable.name);
}

export function resolveAbsoluteInput(value, flag) {
  if (typeof value !== "string" || !value) throw new Error(`${flag} is required`);
  if (!isAbsolute(value)) throw new Error(`${flag} must be absolute`);
  return resolve(value);
}

function requireAbsoluteExistingFile(value, flag) {
  const path = resolveAbsoluteInput(value, flag);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${flag} must name an existing file: ${path}`);
  }
  return realpathSync(path);
}

function requiredNativeSteps(fixtureControl, externalClient) {
  const steps = [
    ...REQUIRED_NATIVE_STEPS.slice(0, 8),
    ...(fixtureControl ? REQUIRED_FIXTURE_HEALTH_STEPS : []),
    ...(externalClient ? [["external-client-curl", "tauri-ipc"]] : []),
    ...REQUIRED_NATIVE_STEPS.slice(8),
  ];
  return steps;
}

function requireOrderedUniqueSteps(steps, required) {
  if (!Array.isArray(steps)) throw new Error("native acceptance steps are missing");
  const names = steps.map((step) => step?.name);
  if (steps.length !== required.length) {
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate) throw new Error(`required native step ${duplicate} must appear exactly once`);
    const missing = required.find(([name]) => !names.includes(name));
    if (missing) throw new Error(`required native step ${missing[0]} must appear exactly once`);
    throw new Error("native steps must equal the exact expected sequence");
  }
  for (let index = 0; index < required.length; index += 1) {
    const [name, transport] = required[index];
    const step = steps[index];
    const matches = names.filter((candidate) => candidate === name);
    if (matches.length !== 1) throw new Error(`required native step ${name} must appear exactly once`);
    if (step?.name !== name) {
      throw new Error(`required native steps are out of order at ${name}`);
    }
    if (step.status !== "success" || step.transport !== transport) {
      throw new Error(`missing successful ${transport} step: ${name}`);
    }
  }
}

function requireArg(args, flag, expected) {
  const actual = argValue(args, flag);
  if (actual !== expected) throw new Error(`exact ${flag} argument mismatch`);
}

function argValue(args, flag) {
  if (!Array.isArray(args)) return undefined;
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function waitForBootstrapEvidence({
  reportPath,
  previousReport,
  child,
  output,
  timeoutMs = BOOTSTRAP_TIMEOUT_MS,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const report = await readFreshReport(reportPath, previousReport);
    if (report) return { report };
    if (childHasExited(child)) {
      throw new Error(
        `iLlama app exited before WebView IPC bootstrap (${childExitDescription(child)})${bootstrapDiagnostics(output)}`,
      );
    }
    if (output.stderr.includes(RUNNER_STARTED_MARKER)) return { report: null };
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  throw new Error(
    `native acceptance bootstrap timed out after ${timeoutMs}ms waiting for runner-started marker or report: ${reportPath}${bootstrapDiagnostics(output)}`,
  );
}

async function readFreshReport(path, previous) {
  const current = await fileStamp(path);
  if (!current || (previous && current.mtimeMs <= previous.mtimeMs && current.sha256 === previous.sha256)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function bootstrapDiagnostics(output) {
  const stderr = String(output?.stderr ?? "");
  const markers = stderr
    .split(/\r?\n/)
    .filter((line) => line.includes("[native-acceptance]"))
    .slice(-12)
    .join("\n");
  const stderrTail = stderr.slice(-4_000);
  return `\nbackend markers:\n${markers || "(none)"}\nstderr tail:\n${stderrTail || "(empty)"}`;
}

async function waitForFreshReport(path, previous, timeoutMs, child, output) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const current = await fileStamp(path);
    if (current && (!previous || current.mtimeMs > previous.mtimeMs || current.sha256 !== previous.sha256)) {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch {
        // Atomic rename should make this rare; retry if the filesystem metadata raced visibility.
      }
    }
    if (childHasExited(child)) {
      throw new Error(
        `iLlama app exited before writing a fresh report (${childExitDescription(child)})\n${output.stderr.slice(-2_000)}`,
      );
    }
    await delay(100);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for native Tauri report: ${path}`);
}

async function fileStamp(path) {
  try {
    const metadata = await stat(path);
    const bytes = await readFile(path);
    return { mtimeMs: metadata.mtimeMs, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function sha256FilePath(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function settingsFileEvidence(path) {
  try {
    const bytes = await readFile(path);
    return {
      exists: true,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, byteLength: 0, sha256: null };
    throw error;
  }
}

function assertSettingsEvidenceMatches({ report, expectedPath, before, after }) {
  if (report?.path !== expectedPath) {
    throw new Error(`normal App settings evidence path mismatch: ${report?.path ?? "missing"}`);
  }
  if (
    report.mode !== "in-memory" || report.unchanged !== true ||
    !sameJson(report.before, before) || !sameJson(report.after, after) || !sameJson(before, after)
  ) {
    throw new Error("normal App changed user settings bytes/hash outside its in-memory acceptance store");
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertTrustedKeyboardEnvironment(execute = executeAppleScript) {
  const result = execute(['tell application "System Events" to get UI elements enabled']);
  if (result.status !== 0 || result.stdout.trim() !== "true") {
    const diagnostic = String(result.stderr || result.error?.message || result.stdout || "disabled").trim();
    throw new Error(
      `normal-app keyboard environment/setup failure: macOS Accessibility permission for System Events is required (${diagnostic})`,
    );
  }
}

export async function activateNormalTargetWithTrustedKeyboard({
  appPid,
  target,
  expectedMilestone = null,
  child,
  output,
  runNonce,
  deadline,
  afterSequence = 0,
  fallbackDelayMs = NORMAL_ACTIVATION_FALLBACK_TIMEOUT_MS,
  primaryKey = "Enter",
  refocusTarget = null,
  execute = executeAppleScript,
}) {
  const pressAndObserve = async (keyCode, key, sequence, observationDeadline = deadline) => {
    runAppleScriptForProcess(appPid, [`key code ${keyCode}`], execute);
    return waitForNormalMarker({
      child,
      output,
      runNonce,
      deadline: observationDeadline,
      afterSequence: sequence,
      predicate: (candidate) =>
        candidate.kind === "input" && candidate.target === target && candidate.key === key &&
        candidate.isTrusted === true,
      description: `trusted ${key === " " ? "Space" : key} activation for ${target}`,
    });
  };

  const primary = primaryKey === " "
    ? await pressAndObserve(49, " ", afterSequence)
    : await pressAndObserve(36, "Enter", afterSequence);
  if (!expectedMilestone) {
    return { sequence: primary.sequence, activationKey: primaryKey, milestone: null };
  }

  const milestonePredicate = (marker) =>
    marker.kind === "milestone" && marker.name === expectedMilestone;
  const primaryMilestone = await waitForNormalMarker({
    child,
    output,
    runNonce,
    deadline: primaryKey === " " ? deadline : Math.min(deadline, Date.now() + fallbackDelayMs),
    afterSequence: primary.sequence,
    predicate: milestonePredicate,
    description: `normal App milestone ${expectedMilestone} after ${primaryKey === " " ? "Space" : "Enter"}`,
    allowTimeout: primaryKey !== " ",
  });
  if (primaryMilestone) {
    return { sequence: primary.sequence, activationKey: primaryKey, milestone: primaryMilestone };
  }

  if (refocusTarget) await refocusTarget(target);
  const space = await pressAndObserve(
    49,
    " ",
    primary.sequence,
    Math.min(deadline, Date.now() + fallbackDelayMs),
  );
  const spaceMilestone = await waitForNormalMarker({
    child,
    output,
    runNonce,
    deadline,
    afterSequence: space.sequence,
    predicate: milestonePredicate,
    description: `normal App milestone ${expectedMilestone} after Space`,
  });
  return { sequence: space.sequence, activationKey: " ", milestone: spaceMilestone };
}

export async function driveNormalAppWithTrustedKeyboard({
  appPid,
  child,
  output,
  runNonce,
  timeoutMs,
  execute = executeAppleScript,
}) {
  if (!Number.isInteger(appPid) || appPid <= 1) {
    throw new Error("normal-app keyboard environment/setup failure: unresolved packaged App PID");
  }
  const deadline = Date.now() + timeoutMs;
  await waitForNormalMarker({
    child,
    output,
    runNonce,
    deadline,
    predicate: (marker) => marker.kind === "ready" && marker.name === "normal-app-keyboard",
    description: "normal App trusted-input observer readiness",
  });
  runAppleScriptForProcess(appPid, [
    "set frontmost of targetProcess to true",
  ], execute);
  await delay(200);

  let focusSequence = 0;
  let inputSequence = 0;
  const focusTarget = async (target, direction = "forward") => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      runAppleScriptForProcess(appPid, [
        direction === "backward"
          ? "key code 48 using {shift down}"
          : "key code 48",
      ], execute);
      const marker = await waitForNormalMarker({
        child,
        output,
        runNonce,
        deadline: Math.min(deadline, Date.now() + NORMAL_FOCUS_TRANSITION_TIMEOUT_MS),
        afterSequence: focusSequence,
        predicate: (candidate) => candidate.kind === "focus",
        description: `focus transition toward ${target}`,
        allowTimeout: true,
      });
      if (!marker) continue;
      focusSequence = marker.sequence;
      await delay(30);
      const laterFocus = normalAcceptanceMarkers(output.stderr, runNonce)
        .filter((candidate) => candidate.kind === "focus" && candidate.sequence > focusSequence)
        .at(-1);
      if (laterFocus) focusSequence = laterFocus.sequence;
      const current = laterFocus ?? marker;
      if (current.target === target) return;
    }
    throw new Error(
      `trusted keyboard could not focus normal App target ${target}${bootstrapDiagnostics(output)}`,
    );
  };
  const activate = async (target, expectedMilestone = null, primaryKey = "Enter") => {
    const result = await activateNormalTargetWithTrustedKeyboard({
      appPid,
      target,
      expectedMilestone,
      child,
      output,
      runNonce,
      deadline,
      afterSequence: inputSequence,
      primaryKey,
      refocusTarget: focusTarget,
      execute,
    });
    inputSequence = result.sequence;
    return result;
  };
  const milestone = (name) => waitForNormalMarker({
    child,
    output,
    runNonce,
    deadline,
    predicate: (marker) => marker.kind === "milestone" && marker.name === name,
    description: `normal App milestone ${name}`,
  });

  await milestone("scan-model-directory");
  await focusTarget("model-option");
  await activate("model-option");
  await milestone("keyboard-select-model");

  await focusTarget("start", "backward");
  await activate("start");
  await milestone("occupied-port-visible-recovery");

  await focusTarget("change-port");
  await activate("change-port");
  await milestone("keyboard-change-port");

  await focusTarget("start");
  await activate("start");
  await milestone("healthy-runtime-snapshot");

  await focusTarget("connection-check");
  await activate("connection-check");
  await milestone("models");

  await focusTarget("open-test");
  await activate("open-test");
  await milestone("keyboard-open-test");

  await focusTarget("chat-input");
  await runVerifiedTrustedTextEntryForProcess(appPid, NORMAL_CHAT_PROMPT, execute);
  await delay(100);
  await activate("chat-input");
  await milestone("stream-started");

  await focusTarget("cancel-stream");
  await activate("cancel-stream");
  await milestone("server-disconnect");

  await focusTarget("tab-run");
  await activate("tab-run");
  await focusTarget("stop");
  await activate("stop", "keyboard-stop-llama", " ");
  await milestone("port-closed");
  await milestone("layout-no-overflow");
}

function executeAppleScript(lines) {
  const args = lines.flatMap((line) => ["-e", line]);
  return spawnSync("/usr/bin/osascript", args, { encoding: "utf8" });
}

function runAppleScriptForProcess(pid, actions, execute) {
  const result = execute([
    'tell application "System Events"',
    `set targetProcess to first application process whose unix id is ${pid}`,
    ...actions,
    "end tell",
  ]);
  if (result.status !== 0 || result.error) {
    const diagnostic = String(result.stderr || result.error?.message || `exit ${result.status}`).trim();
    throw new Error(`normal-app keyboard environment/setup failure: trusted OS input failed (${diagnostic})`);
  }
}

export async function runVerifiedTrustedTextEntryForProcess(
  pid,
  text,
  execute = executeAppleScript,
) {
  const scope = await createInputSourceScope();
  let inputError = null;
  let restoreError = null;
  try {
    const result = execute([
    `set promptText to ${JSON.stringify(text)}`,
    "set expectedPrefix to \"\"",
    'tell application "System Events"',
    `set targetProcess to first application process whose unix id is ${pid}`,
    "tell targetProcess",
    "repeat with characterToType in characters of promptText",
    "set expectedPrefix to expectedPrefix & (characterToType as text)",
    "set characterConfirmed to false",
    'set currentValue to "<unavailable>"',
    "repeat 3 times",
    'if (characterToType as text) is " " then',
    "key code 49",
    "else",
    "keystroke (characterToType as text)",
    "end if",
    "repeat 20 times",
    "try",
    'set focusedElement to value of attribute "AXFocusedUIElement"',
    'set currentValue to value of attribute "AXValue" of focusedElement',
    "if currentValue is expectedPrefix then",
    "set characterConfirmed to true",
    "exit repeat",
    "end if",
    "end try",
    "delay 0.05",
    "end repeat",
    "if characterConfirmed then exit repeat",
    "end repeat",
    'if characterConfirmed is false then error "trusted character did not reach the focused WebView input; expected prefix " & expectedPrefix & "; observed " & currentValue',
    "end repeat",
    "end tell",
    "end tell",
    ]);
    if (result.status !== 0 || result.error) {
      const diagnostic = String(
        result.stderr || result.error?.message || `exit ${result.status}`,
      ).trim();
      throw new Error(`verified trusted text entry failed (${diagnostic})`);
    }
  } catch (error) {
    inputError = error;
  } finally {
    try {
      runInputSourceHelper(scope, "restore");
    } catch (error) {
      restoreError = error;
    }
    try {
      await rm(scope.directory, { recursive: true, force: true });
    } catch (error) {
      restoreError ??= error;
    }
  }
  if (inputError || restoreError) {
    const detail = [inputError, restoreError]
      .filter(Boolean)
      .map((error) => error instanceof Error ? error.message : String(error))
      .join("; ");
    throw new Error(
      `normal-app keyboard environment/setup failure: verified trusted text entry failed (${detail})`,
    );
  }
}

async function createInputSourceScope() {
  const directory = await mkdtemp(join(tmpdir(), "illama-input-source-"));
  const source = join(directory, "InputSourceHelper.swift");
  const executable = join(directory, "input-source-helper");
  const snapshot = join(directory, "original-source-id");
  try {
    await writeFile(source, INPUT_SOURCE_HELPER_SOURCE, "utf8");
    const compiled = spawnSync(
      "/usr/bin/xcrun",
      ["swiftc", "-O", "-o", executable, source],
      { encoding: "utf8" },
    );
    if (compiled.status !== 0 || compiled.error) {
      const diagnostic = String(
        compiled.stderr || compiled.error?.message || `exit ${compiled.status}`,
      ).trim();
      throw new Error(`input source helper compilation failed (${diagnostic})`);
    }
    const scope = { directory, executable, snapshot };
    runInputSourceHelper(scope, "enter");
    return scope;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function runInputSourceHelper(scope, operation) {
  const result = spawnSync(
    scope.executable,
    [operation, scope.snapshot],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || result.error) {
    const diagnostic = String(
      result.stderr || result.error?.message || `exit ${result.status}`,
    ).trim();
    const label = operation === "restore" ? "input source restore failed" : "input source setup failed";
    throw new Error(`${label} (${diagnostic})`);
  }
}

async function waitForNormalMarker({
  child,
  output,
  runNonce,
  deadline,
  afterSequence = 0,
  predicate,
  description,
  allowTimeout = false,
}) {
  while (Date.now() <= deadline) {
    const marker = normalAcceptanceMarkers(output.stderr, runNonce)
      .find((candidate) => candidate.sequence > afterSequence && predicate(candidate));
    if (marker) return marker;
    if (childHasExited(child)) {
      throw new Error(
        `packaged App exited while waiting for ${description} (${childExitDescription(child)})${bootstrapDiagnostics(output)}`,
      );
    }
    await delay(Math.min(20, Math.max(1, deadline - Date.now())));
  }
  if (childHasExited(child)) {
    throw new Error(
      `packaged App exited while waiting for ${description} (${childExitDescription(child)})${bootstrapDiagnostics(output)}`,
    );
  }
  if (allowTimeout) return null;
  throw new Error(`timed out waiting for ${description}${bootstrapDiagnostics(output)}`);
}

function normalAcceptanceMarkers(stderr, runNonce) {
  return String(stderr)
    .split(/\r?\n/)
    .filter((line) => line.startsWith(NORMAL_MARKER_PREFIX))
    .flatMap((line) => {
      try {
        const marker = JSON.parse(line.slice(NORMAL_MARKER_PREFIX.length));
        return marker?.runNonce === runNonce && Number.isInteger(marker?.sequence)
          ? [marker]
          : [];
      } catch {
        return [];
      }
    });
}

async function listenOnEphemeralPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unable to allocate occupied port");
  return { server, address: () => address };
}

async function reserveFreePort() {
  const holder = await listenOnEphemeralPort();
  const port = holder.address().port;
  await closeServer(holder);
  return port;
}

async function closeServer(holder) {
  if (!holder?.server.listening) return;
  await new Promise((resolveClose, reject) => holder.server.close((error) => error ? reject(error) : resolveClose()));
}

async function canConnect(host, port, timeoutMs) {
  return new Promise((resolveConnect) => {
    const socket = createConnection({ host, port });
    const finish = (reachable) => {
      socket.destroy();
      resolveConnect(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) {
    return { exited: true, code: child.exitCode ?? null, signal: child.signalCode ?? null };
  }
  return new Promise((resolveExit) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener?.("exit", onExit);
      resolveExit(result);
    };
    const onExit = (code, signal) => finish({ exited: true, code, signal });
    const timer = setTimeout(
      () => finish({ exited: false, code: null, signal: null }),
      timeoutMs,
    );
    child.once("exit", onExit);
    if (childHasExited(child)) {
      finish({ exited: true, code: child.exitCode ?? null, signal: child.signalCode ?? null });
    }
  });
}

function childHasExited(child) {
  return Boolean(child) && (child.exitCode != null || child.signalCode != null);
}

function childExitDescription(child) {
  return child.signalCode != null ? `signal ${child.signalCode}` : `code ${child.exitCode}`;
}

export async function installLaunchServicesEnvironment(environment, execute = executeLaunchctl) {
  const keys = launchServicesEnvironmentKeys(environment);
  const previous = new Map();
  const changed = [];
  const domain = `gui/${process.getuid()}`;
  const printed = invokeLaunchctl(execute, ["print", domain]);
  if (printed.status !== 0 || printed.error) {
    throw new Error(launchctlFailure("print", domain, printed));
  }
  const presentKeys = parseLaunchctlEnvironmentKeys(printed.stdout);
  for (const key of keys) {
    const result = invokeLaunchctl(execute, ["getenv", key]);
    if (result.status === null || result.error || (presentKeys.has(key) && result.status !== 0)) {
      const installFailure = launchctlFailure("getenv", key, result);
      const rollbackFailures = restoreLaunchServicesKeys(changed, previous, execute);
      throw new Error([installFailure, ...rollbackFailures].join("\n"));
    }
    previous.set(
      key,
      presentKeys.has(key) ? launchctlEnvironmentValue(result.stdout) : null,
    );
    const set = invokeLaunchctl(execute, ["setenv", key, environment[key]]);
    if (set.status !== 0) {
      const installFailure = launchctlFailure("setenv", key, set);
      const rollbackFailures = restoreLaunchServicesKeys(changed, previous, execute);
      throw new Error([installFailure, ...rollbackFailures].join("\n"));
    }
    changed.push(key);
  }
  return async () => {
    const failures = restoreLaunchServicesKeys(keys, previous, execute);
    if (failures.length > 0) {
      throw new Error(`launchctl environment restoration failed:\n${failures.join("\n")}`);
    }
  };
}

export function parseLaunchctlEnvironmentKeys(output) {
  const keys = new Set();
  let inEnvironment = false;
  for (const line of String(output).split(/\r?\n/)) {
    if (!inEnvironment) {
      if (/^\s*environment\s*=\s*\{\s*$/.test(line)) inEnvironment = true;
      continue;
    }
    if (/^\s*\}\s*$/.test(line)) break;
    const match = line.match(/^\s*([^\s=]+)\s+=>/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function executeLaunchctl(args) {
  return spawnSync("/bin/launchctl", args, { encoding: "utf8" });
}

function invokeLaunchctl(execute, args) {
  try {
    return execute(args);
  } catch (error) {
    return { status: null, stdout: "", stderr: "", error };
  }
}

function launchctlEnvironmentValue(stdout) {
  return String(stdout).replace(/\r?\n$/, "");
}

function restoreLaunchServicesKeys(keys, previous, execute) {
  const failures = [];
  for (const key of [...keys].reverse()) {
    const old = previous.get(key);
    const operation = old === null ? "unsetenv" : "setenv";
    const args = old === null ? [operation, key] : [operation, key, old];
    const result = invokeLaunchctl(execute, args);
    if (result.status !== 0) failures.push(launchctlFailure(operation, key, result));
  }
  return failures;
}

function launchctlFailure(operation, key, result) {
  const diagnostic = String(result.stderr || result.error?.message || `exit ${result.status}`);
  return `launchctl ${operation} failed for ${key}: ${diagnostic.trim()}`;
}

export function launchServicesEnvironmentKeys(environment) {
  return Object.keys(environment).filter(
    (key) => key.startsWith("ILLAMA_ACCEPTANCE_") || key.startsWith("FAKE_LLAMA_"),
  );
}

export async function runProcess(command, args, {
  cwd,
  timeoutMs,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
}) {
  const isolateProcessGroup = process.platform !== "win32";
  const child = spawn(command, args, {
    cwd,
    detached: isolateProcessGroup,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk.toString()); });
  child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk.toString()); });
  const exit = await waitForChildExit(child, timeoutMs);
  if (!exit.exited) {
    let reapFailure = null;
    try {
      await terminateAndReapChild(child, {
        terminationGraceMs,
        killGraceMs,
        processGroup: isolateProcessGroup,
      });
    } catch (error) {
      reapFailure = error instanceof Error ? error.message : String(error);
    }
    throw new Error(
      `${command} timed out after ${timeoutMs}ms` +
      (reapFailure ? `; ${reapFailure}` : "") +
      processDiagnostics(stdout, stderr),
    );
  }
  if (exit.signal !== null) {
    throw new Error(`${command} exited via signal ${exit.signal}${processDiagnostics(stdout, stderr)}`);
  }
  if (exit.code !== 0) {
    throw new Error(`${command} exited with ${exit.code}${processDiagnostics(stdout, stderr)}`);
  }
  return { stdout, stderr };
}

async function terminateAndReapChild(child, {
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  processGroup = false,
} = {}) {
  const processGroupId = processGroup ? validatedProcessGroupId(child) : null;
  if (
    childHasExited(child) &&
    (processGroupId === null || !isProcessGroupAlive(processGroupId))
  ) {
    return { exited: true, code: child.exitCode, signal: child.signalCode };
  }

  signalTerminationTarget(child, "SIGTERM", processGroupId);
  const terminated = await waitForTerminationTarget(child, processGroupId, terminationGraceMs);
  if (terminated.exited) return terminated;

  signalTerminationTarget(child, "SIGKILL", processGroupId);
  const killed = await waitForTerminationTarget(child, processGroupId, killGraceMs);
  if (!killed.exited) {
    const target = processGroupId === null ? "child" : `process group ${processGroupId}`;
    throw new Error(`${target} could not be reaped within ${killGraceMs}ms after SIGKILL`);
  }
  return killed;
}

function validatedProcessGroupId(child) {
  if (!Number.isInteger(child.pid) || child.pid <= 1) {
    throw new Error("refusing to signal an unresolved process group");
  }
  return child.pid;
}

function signalTerminationTarget(child, signal, processGroupId) {
  if (processGroupId === null) return child.kill(signal);
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForTerminationTarget(child, processGroupId, timeoutMs) {
  if (processGroupId === null) return waitForChildExit(child, timeoutMs);
  const [childExit, groupExited] = await Promise.all([
    waitForChildExit(child, timeoutMs),
    waitForProcessGroupExit(processGroupId, timeoutMs),
  ]);
  return { ...childExit, exited: childExit.exited && groupExited };
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!isProcessGroupAlive(processGroupId)) return true;
    await delay(Math.min(20, Math.max(1, deadline - Date.now())));
  }
  return !isProcessGroupAlive(processGroupId);
}

function isProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function processDiagnostics(stdout, stderr) {
  return `\nstdout tail:\n${stdout.slice(-4_000) || "(empty)"}` +
    `\nstderr tail:\n${stderr.slice(-4_000) || "(empty)"}`;
}

export async function cleanupAcceptanceResources({
  occupied,
  restoreLaunchEnvironment,
  launchServicesApp = null,
  child,
  childTree = null,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
}) {
  const failures = [];
  try {
    await closeServer(occupied);
  } catch (error) {
    failures.push(`occupied-port cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await restoreLaunchEnvironment();
  } catch (error) {
    failures.push(`LaunchServices restore failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (launchServicesApp) {
    try {
      await cleanupTrackedLaunchServicesApp(launchServicesApp, {
        terminationGraceMs,
        killGraceMs,
      });
    } catch (error) {
      failures.push(`LaunchServices app cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (childTree) {
    try {
      await cleanupOwnedProcessTree(childTree, { terminationGraceMs, killGraceMs });
    } catch (error) {
      failures.push(`launcher cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (child && child.exitCode === null && child.signalCode === null) {
    try {
      await terminateAndReapChild(child, { terminationGraceMs, killGraceMs });
    } catch (error) {
      failures.push(`launcher cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (launchServicesApp?.pid === null) {
    try {
      await cleanupTrackedLaunchServicesApp(launchServicesApp, {
        terminationGraceMs,
        killGraceMs,
        waitForCandidateMs: terminationGraceMs,
      });
    } catch (error) {
      failures.push(`late LaunchServices app cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`native acceptance cleanup failed:\n${failures.join("\n")}`);
  }
}

export function parseProcessTable(output) {
  const processes = [];
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    if (pid <= 0 || ppid < 0 || !match[3]) continue;
    processes.push({ pid, ppid, comm: match[3] });
  }
  return processes;
}

export function listProcessTable(execute = executePs) {
  const result = execute(["-ww", "-axo", "pid=,ppid=,comm="]);
  if (result.status !== 0) {
    throw new Error(
      `unable to enumerate process ownership: ${String(result.stderr || result.error?.message || result.status)}`,
    );
  }
  return parseProcessTable(result.stdout);
}

export function createOwnedProcessTreeTracker({
  rootPid,
  rootExecutablePath,
  processGroupId = null,
  listProcesses = listProcessTable,
  pollIntervalMs = 20,
}) {
  if (!Number.isInteger(rootPid) || rootPid <= 1) {
    throw new Error("refusing to track an unresolved process-tree root");
  }
  if (typeof rootExecutablePath !== "string" || !rootExecutablePath.startsWith("/")) {
    throw new Error("owned process-tree root executable must be an absolute path");
  }
  if (processGroupId !== null && processGroupId !== rootPid) {
    throw new Error("owned process-group ID must exactly match its isolated root PID");
  }
  const tracker = {
    rootPid,
    rootExecutablePath,
    processGroupId,
    listProcesses,
    owned: new Map([[rootPid, { pid: rootPid, ppid: null, comm: rootExecutablePath }]]),
    observationFailures: [],
    timer: null,
    observe: null,
    stop: null,
  };
  tracker.observe = () => {
    try {
      return observeOwnedProcessTree(tracker);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!tracker.observationFailures.includes(message)) tracker.observationFailures.push(message);
      return null;
    }
  };
  tracker.stop = () => {
    if (tracker.timer !== null) clearInterval(tracker.timer);
    tracker.timer = null;
  };
  tracker.observe();
  tracker.timer = setInterval(tracker.observe, Math.max(1, pollIntervalMs));
  tracker.timer.unref?.();
  return tracker;
}

function observeOwnedProcessTree(tracker) {
  const processes = tracker.listProcesses();
  const current = new Map(processes.map((entry) => [entry.pid, entry]));
  const currentOwned = new Set();
  for (const [pid, identity] of tracker.owned) {
    if (current.get(pid)?.comm === identity.comm) currentOwned.add(pid);
  }

  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const entry of processes) {
      if (entry.pid <= 1 || tracker.owned.has(entry.pid) || !currentOwned.has(entry.ppid)) continue;
      tracker.owned.set(entry.pid, { ...entry });
      currentOwned.add(entry.pid);
      discovered = true;
    }
  }
  return [...currentOwned]
    .map((pid) => current.get(pid))
    .filter(Boolean);
}

export async function cleanupOwnedProcessTree(tracker, {
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  signalProcess = process.kill.bind(process),
} = {}) {
  tracker.stop();
  const failures = [...tracker.observationFailures]
    .map((message) => `process-tree observation failed: ${message}`);
  const term = await signalAndWaitForOwnedTree(
    tracker,
    "SIGTERM",
    terminationGraceMs,
    signalProcess,
    failures,
  );
  if (!term.exited) {
    const killed = await signalAndWaitForOwnedTree(
      tracker,
      "SIGKILL",
      killGraceMs,
      signalProcess,
      failures,
    );
    if (!killed.exited) {
      failures.push(
        `owned process tree could not be reaped within ${killGraceMs}ms after SIGKILL: ${killed.remaining.map((entry) => entry.pid).join(", ") || "unresolved"}`,
      );
    }
  }
  failures.push(
    ...tracker.observationFailures.map((message) => `process-tree observation failed: ${message}`),
  );
  if (failures.length > 0) {
    throw new Error([...new Set(failures)].join("\n"));
  }
}

async function signalAndWaitForOwnedTree(
  tracker,
  signal,
  timeoutMs,
  signalProcess,
  failures,
) {
  const signalled = new Set();
  let groupSignalled = false;
  const deadline = Date.now() + timeoutMs;
  let remaining = [];
  while (Date.now() <= deadline) {
    if (!groupSignalled && tracker.processGroupId !== null) {
      groupSignalled = true;
      try {
        signalProcess(-tracker.processGroupId, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") {
          failures.push(
            `${signal} failed for isolated process group ${tracker.processGroupId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    const observed = tracker.observe();
    if (observed !== null) {
      remaining = orderOwnedProcessesForTermination(observed, tracker.owned);
      for (const entry of remaining) {
        if (signalled.has(entry.pid)) continue;
        signalled.add(entry.pid);
        try {
          signalProcess(entry.pid, signal);
        } catch (error) {
          if (error?.code !== "ESRCH") {
            failures.push(
              `${signal} failed for exact owned PID ${entry.pid} (${entry.comm}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      if (
        remaining.length === 0 &&
        (tracker.processGroupId === null || !isProcessGroupAlive(tracker.processGroupId))
      ) {
        return { exited: true, remaining };
      }
    }
    await delay(Math.min(20, Math.max(1, deadline - Date.now())));
  }
  const observed = tracker.observe();
  if (observed !== null) remaining = orderOwnedProcessesForTermination(observed, tracker.owned);
  const groupExited = tracker.processGroupId === null || !isProcessGroupAlive(tracker.processGroupId);
  return { exited: remaining.length === 0 && groupExited, remaining };
}

function orderOwnedProcessesForTermination(processes, owned) {
  const depth = (entry) => {
    let result = 0;
    let cursor = owned.get(entry.pid);
    const seen = new Set();
    while (cursor?.ppid && owned.has(cursor.ppid) && !seen.has(cursor.ppid)) {
      seen.add(cursor.ppid);
      result += 1;
      cursor = owned.get(cursor.ppid);
    }
    return result;
  };
  return [...processes].sort((left, right) => depth(right) - depth(left));
}

export function parseExactExecutablePids(output, executablePath) {
  const pids = new Set();
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (match?.[2] === executablePath) pids.add(Number.parseInt(match[1], 10));
  }
  return pids;
}

export function listExactExecutablePids(executablePath, execute = executePs) {
  return new Set(
    listProcessTable(execute)
      .filter((entry) => entry.comm === executablePath)
      .map((entry) => entry.pid),
  );
}

function executePs(args) {
  return spawnSync("/bin/ps", args, { encoding: "utf8" });
}

export async function identifyNewLaunchServicesApp({
  executablePath,
  baselinePids,
  launcher,
  timeoutMs,
  listExactPids = listExactExecutablePids,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const candidates = [...listExactPids(executablePath)]
      .filter((pid) => !baselinePids.has(pid));
    if (candidates.length === 1) {
      return { executablePath, baselinePids, pid: candidates[0] };
    }
    if (candidates.length > 1) {
      throw new Error(
        `ambiguous new LaunchServices app PIDs ${candidates.join(", ")}; refusing to select an instance`,
      );
    }
    if (childHasExited(launcher)) {
      throw new Error(
        `LaunchServices launcher exited before the app PID was identified (${childExitDescription(launcher)})`,
      );
    }
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`timed out after ${timeoutMs}ms identifying the new exact-path LaunchServices app`);
}

export async function cleanupTrackedLaunchServicesApp(tracker, {
  listExactPids = listExactExecutablePids,
  terminatePid = null,
  createTreeTracker = createOwnedProcessTreeTracker,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  waitForCandidateMs = 0,
} = {}) {
  let target = tracker.pid;
  if (target === null) {
    const deadline = Date.now() + waitForCandidateMs;
    do {
      const candidates = [...listExactPids(tracker.executablePath)]
        .filter((pid) => !tracker.baselinePids.has(pid));
      if (candidates.length > 1) {
        throw new Error(
          `ambiguous new exact-path app PIDs ${candidates.join(", ")}; refusing to signal any instance`,
        );
      }
      if (candidates.length === 1) {
        [target] = candidates;
        tracker.pid = target;
        break;
      }
      if (Date.now() >= deadline) return;
      await delay(Math.min(20, Math.max(1, deadline - Date.now())));
    } while (Date.now() <= deadline);
    if (target === null) return;
  }
  if (tracker.baselinePids.has(target)) {
    throw new Error(`refusing to signal pre-launch baseline app PID ${target}`);
  }
  if (tracker.processTree) {
    await cleanupOwnedProcessTree(tracker.processTree, {
      terminationGraceMs,
      killGraceMs,
    });
    return;
  }
  const currentPids = listExactPids(tracker.executablePath);
  if (!currentPids.has(target)) return;
  if (terminatePid) {
    await terminatePid(target, { terminationGraceMs, killGraceMs });
    return;
  }
  tracker.processTree = createTreeTracker({
    rootPid: target,
    rootExecutablePath: tracker.executablePath,
  });
  await cleanupOwnedProcessTree(tracker.processTree, {
    terminationGraceMs,
    killGraceMs,
  });
}

function appendBounded(current, addition) {
  return `${current}${addition}`.slice(-200_000);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
