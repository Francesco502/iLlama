import { completeChatCompletion, streamChatCompletion } from "../api/chat";
import { buildLoopbackHttpUrl } from "../api/loopbackUrl";
import {
  buildCommandSpec,
  checkHealth,
  findAvailablePort,
  finishNativeAcceptance,
  isTauriRuntime,
  markNativeAcceptanceRunnerStarted,
  normalizeCommandError,
  probeLlamaServer,
  runNativeAcceptanceExternalClient,
  runtimeSnapshot,
  scanModelDirectory,
  startLlama,
  stopLlama,
  type ActiveLaunchSnapshot,
  type CommandSpec,
  type HealthStatus,
  type ModelScanResult,
  type NativeAcceptanceConfig,
  type RuntimeSnapshot,
  type ServerCapabilities,
} from "../api/tauri";
import type { LaunchConfig, ModelEntry, SamplingParameters } from "../types/domain";

declare const __APP_VERSION__: string;

export interface NativeAcceptanceStep {
  name: string;
  status: "success" | "failure";
  transport: "tauri-ipc" | "webview-http";
  detail?: string;
}

export interface NativeAcceptanceReport {
  schemaVersion: 1;
  kind: "native-tauri";
  surface: "deep-runner";
  runNonce: string;
  status: "success" | "failure";
  appVersion: string;
  steps: NativeAcceptanceStep[];
  scan: {
    requestId: string;
    directory: string;
    filesScanned: number;
    modelsFound: number;
    configuredModel: ModelEntry;
    rejectedInvalidModels: Array<Pick<ModelEntry, "path" | "metadataStatus" | "available">>;
  } | null;
  commandSpec: CommandSpec | null;
  activeLaunch: ActiveLaunchSnapshot | null;
  modelId: string | null;
  chat: { content: string; reasoningContent: string; finishReason: string | null } | null;
  cancellation: {
    abortControllerAborted: boolean;
    abortErrorObserved: boolean;
    streamStarted: boolean;
  } | null;
  recovery: {
    code: string;
    message: string;
    recoveryAction: string;
    exercised: boolean;
  } | null;
  stop: {
    pid: null;
    activeLaunch: null;
    portReachable: boolean;
  } | null;
  startedPid: number | null;
  healthTransition: {
    exercised: boolean;
    healthyStatus: RuntimeSnapshot["status"];
    degradedStatus: RuntimeSnapshot["status"] | null;
    recoveredStatus: RuntimeSnapshot["status"] | null;
  };
  externalClient?: { path: string; status: "configured" | "executed" };
  error?: string;
}

export interface NativeAcceptanceDependencies {
  isTauriRuntime: () => boolean;
  markRunnerStarted: typeof markNativeAcceptanceRunnerStarted;
  runExternalClient: typeof runNativeAcceptanceExternalClient;
  scanModelDirectory: typeof scanModelDirectory;
  probeLlamaServer: typeof probeLlamaServer;
  buildCommandSpec: typeof buildCommandSpec;
  startLlama: typeof startLlama;
  findAvailablePort: typeof findAvailablePort;
  runtimeSnapshot: typeof runtimeSnapshot;
  completeChatCompletion: typeof completeChatCompletion;
  streamChatCompletion: typeof streamChatCompletion;
  stopLlama: typeof stopLlama;
  checkHealth: typeof checkHealth;
  setFixtureHealth: (host: string, port: number, healthy: boolean) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  now: () => number;
  finish: (report: NativeAcceptanceReport, exitCode: 0 | 1) => Promise<void>;
}

const defaultDependencies: NativeAcceptanceDependencies = {
  isTauriRuntime,
  markRunnerStarted: markNativeAcceptanceRunnerStarted,
  runExternalClient: runNativeAcceptanceExternalClient,
  scanModelDirectory,
  probeLlamaServer,
  buildCommandSpec,
  startLlama,
  findAvailablePort,
  runtimeSnapshot,
  completeChatCompletion,
  streamChatCompletion,
  stopLlama,
  checkHealth,
  setFixtureHealth: async (host, port, healthy) => {
    const response = await fetch(buildLoopbackHttpUrl(host, port, "/__illama_acceptance/health"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ healthy }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`fixture health control failed with HTTP ${response.status}`);
    }
  },
  wait: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  now: () => performance.now(),
  finish: finishNativeAcceptance,
};

export async function runNativeAcceptance(
  config: NativeAcceptanceConfig,
  dependencies: NativeAcceptanceDependencies = defaultDependencies,
): Promise<NativeAcceptanceReport> {
  const report = emptyReport(config);
  let childMayBeRunning = false;

  try {
    if (!dependencies.isTauriRuntime()) {
      throw new Error("native acceptance requires the real Tauri runtime");
    }
    await dependencies.markRunnerStarted();
    addStep(report, "tauri-runtime", "tauri-ipc");

    const scan = await dependencies.scanModelDirectory(
      config.modelDirectory,
      `native-acceptance-${Date.now()}`,
    );
    report.scan = validateScan(scan, config.modelPath);
    addStep(report, "scan-model-directory", "tauri-ipc");

    const capabilities = await dependencies.probeLlamaServer(config.binaryPath);
    validateCapabilities(capabilities, config.binaryPath);
    addStep(report, "probe-llama-server", "tauri-ipc");

    let launch = buildLaunchConfig(config, config.preferredPort);
    let commandSpec = await dependencies.buildCommandSpec(launch, capabilities);
    validateCommandSpec(commandSpec, launch);
    report.commandSpec = commandSpec;
    addStep(report, "build-command-spec", "tauri-ipc");

    try {
      const unexpected = await dependencies.startLlama(buildLaunchConfig(config, config.occupiedPort));
      childMayBeRunning = unexpected.pid !== null;
      throw new Error("occupied-port negative control unexpectedly started llama-server");
    } catch (error) {
      const normalized = normalizeCommandError(error);
      if (normalized.recoveryAction !== "changePort" || normalized.code !== "port_unavailable") {
        const failure = new Error(
          `occupied port did not return structured changePort recovery: ${normalized.message}`,
        ) as Error & { cause?: unknown };
        failure.cause = error;
        throw failure;
      }
      report.recovery = { ...normalized, exercised: true };
    }
    addStep(report, "occupied-port-recovery", "tauri-ipc");

    const resolvedPort = await dependencies.findAvailablePort("127.0.0.1", config.preferredPort);
    launch = buildLaunchConfig(config, resolvedPort);
    if (resolvedPort !== config.preferredPort) {
      commandSpec = await dependencies.buildCommandSpec(launch, capabilities);
      validateCommandSpec(commandSpec, launch);
      report.commandSpec = commandSpec;
    }

    const started = await dependencies.startLlama(launch);
    childMayBeRunning = started.pid !== null;
    validateProcessSnapshot(started, "start");
    report.startedPid = started.pid;
    addStep(report, "start-llama", "tauri-ipc");

    const healthy = await pollHealthySnapshot(dependencies, config.startupTimeoutMs);
    validateProcessSnapshot(healthy, "healthy snapshot");
    const activeLaunch = healthy.activeLaunch;
    if (!activeLaunch) throw new Error("healthy snapshot is missing activeLaunch");
    if (!arraysEqual(activeLaunch.commandArgs, commandSpec.args)) {
      throw new Error("activeLaunch.commandArgs does not exactly match the capability-filtered CommandSpec");
    }
    validateParameterSources(activeLaunch);
    if (!activeLaunch.modelId) throw new Error("/v1/models did not produce a model ID");
    report.activeLaunch = activeLaunch;
    report.modelId = activeLaunch.modelId;
    addStep(report, "healthy-runtime-snapshot", "tauri-ipc");
    addStep(report, "models", "tauri-ipc");

    report.healthTransition.healthyStatus = healthy.status;
    if (config.fixtureControl) {
      await dependencies.setFixtureHealth(activeLaunch.host, activeLaunch.port, false);
      const degraded = await dependencies.runtimeSnapshot();
      if (degraded.status !== "starting" || degraded.pid !== report.startedPid) {
        throw new Error("fixture health downgrade did not produce Healthy -> Starting");
      }
      report.healthTransition.degradedStatus = degraded.status;
      addStep(report, "health-downgrade", "tauri-ipc");

      await dependencies.setFixtureHealth(activeLaunch.host, activeLaunch.port, true);
      const recovered = await pollHealthySnapshot(dependencies, config.startupTimeoutMs);
      if (recovered.pid !== report.startedPid) {
        throw new Error("fixture health recovery changed the llama-server child PID");
      }
      report.healthTransition.exercised = true;
      report.healthTransition.recoveredStatus = recovered.status;
      addStep(report, "health-recovery", "tauri-ipc");
    }

    if (config.externalClient) {
      await dependencies.runExternalClient();
      report.externalClient = { path: config.externalClient, status: "executed" };
      addStep(report, "external-client-curl", "tauri-ipc");
    }

    const chat = await completeChatWithTimeout(
      dependencies,
      activeLaunch,
      acceptanceSampling(),
      config.chatTimeoutMs,
    );
    if (!chat.content.trim() && !chat.reasoningContent.trim()) {
      throw new Error("non-stream chat returned no content or reasoning output");
    }
    report.chat = {
      content: chat.content,
      reasoningContent: chat.reasoningContent,
      finishReason: chat.finishReason ?? null,
    };
    addStep(report, "non-stream-chat", "webview-http");

    report.cancellation = await proveAbortControllerCancellation(
      dependencies,
      activeLaunch,
      acceptanceSampling(),
      config.cancellationTimeoutMs,
    );
    addStep(report, "stream-cancellation", "webview-http");

    const stopped = await dependencies.stopLlama();
    validateStoppedSnapshot(stopped);
    const healthAfterStop = await dependencies.checkHealth(activeLaunch.host, activeLaunch.port);
    if (healthAfterStop.healthy) throw new Error("llama-server port remained reachable after stop");
    childMayBeRunning = false;
    report.stop = { pid: null, activeLaunch: null, portReachable: false };
    addStep(report, "stop-llama", "tauri-ipc");
    addStep(report, "port-closed", "tauri-ipc");

    report.status = "success";
  } catch (error) {
    report.status = "failure";
    report.error = error instanceof Error ? error.message : String(error);
    report.steps.push({
      name: "acceptance-failure",
      status: "failure",
      transport: "tauri-ipc",
      detail: report.error,
    });
    if (childMayBeRunning) {
      try {
        await dependencies.stopLlama();
        addStep(report, "failure-cleanup-stop", "tauri-ipc");
      } catch (stopError) {
        report.steps.push({
          name: "failure-cleanup-stop",
          status: "failure",
          transport: "tauri-ipc",
          detail: stopError instanceof Error ? stopError.message : String(stopError),
        });
      }
    }
  }

  const exitCode = report.status === "success" ? 0 : 1;
  await dependencies.finish(report, exitCode);
  return report;
}

function emptyReport(config: NativeAcceptanceConfig): NativeAcceptanceReport {
  return {
    schemaVersion: 1,
    kind: "native-tauri",
    surface: "deep-runner",
    runNonce: config.runNonce,
    status: "failure",
    appVersion: __APP_VERSION__,
    steps: [],
    scan: null,
    commandSpec: null,
    activeLaunch: null,
    modelId: null,
    chat: null,
    cancellation: null,
    recovery: null,
    stop: null,
    startedPid: null,
    healthTransition: {
      exercised: false,
      healthyStatus: "healthy",
      degradedStatus: null,
      recoveredStatus: null,
    },
    ...(config.externalClient
      ? { externalClient: { path: config.externalClient, status: "configured" as const } }
      : {}),
  };
}

function addStep(
  report: NativeAcceptanceReport,
  name: string,
  transport: NativeAcceptanceStep["transport"],
): void {
  report.steps.push({ name, status: "success", transport });
}

function validateScan(scan: ModelScanResult, configuredPath: string): NonNullable<NativeAcceptanceReport["scan"]> {
  const configuredModel = scan.models.find((model) => model.path === configuredPath);
  if (
    !configuredModel ||
    !configuredModel.available ||
    !["ready", "limited"].includes(configuredModel.metadataStatus)
  ) {
    throw new Error("configured GGUF must be classified ready or limited by the production scanner");
  }
  const rejectedInvalidModels = scan.models
    .filter((model) => model.metadataStatus === "invalid")
    .map(({ path, metadataStatus, available }) => ({ path, metadataStatus, available }));
  if (rejectedInvalidModels.some((model) => model.available)) {
    throw new Error("production scanner exposed an invalid GGUF as available");
  }
  return {
    requestId: scan.requestId,
    directory: scan.directory,
    filesScanned: scan.filesScanned,
    modelsFound: scan.modelsFound,
    configuredModel,
    rejectedInvalidModels,
  };
}

function validateCapabilities(capabilities: ServerCapabilities, binaryPath: string): void {
  if (capabilities.binaryPath !== binaryPath || capabilities.status === "invalid") {
    const details = capabilities.warnings.length > 0
      ? capabilities.warnings.join(" ")
      : `probe status: ${capabilities.status}`;
    throw new Error(
      `llama-server capability probe did not accept the configured executable: ${details}`,
    );
  }
  for (const flag of ["--model", "--host", "--port"]) {
    if (!capabilities.supportedFlags.includes(flag)) {
      throw new Error(`llama-server capability probe is missing ${flag}`);
    }
  }
}

function validateCommandSpec(spec: CommandSpec, launch: LaunchConfig): void {
  if (spec.executable !== launch.binaryPath) {
    throw new Error("CommandSpec executable does not match the configured binary");
  }
  for (const [flag, value] of [
    ["--model", launch.modelPath],
    ["--host", launch.host],
    ["--port", String(launch.port)],
  ] as const) {
    const index = spec.args.indexOf(flag);
    if (index < 0 || spec.args[index + 1] !== value) {
      throw new Error(`CommandSpec does not contain the exact ${flag} core value`);
    }
  }
}

function validateProcessSnapshot(snapshot: RuntimeSnapshot, source: string): void {
  if (snapshot.pid === null) throw new Error(`${source} did not return a child PID`);
  if (snapshot.pid === 1) throw new Error(`${source} returned forbidden simulated PID 1`);
  if (!snapshot.activeLaunch) throw new Error(`${source} did not return activeLaunch`);
}

async function pollHealthySnapshot(
  dependencies: NativeAcceptanceDependencies,
  timeoutMs: number,
): Promise<RuntimeSnapshot> {
  const pollIntervalMs = 250;
  const deadline = dependencies.now() + timeoutMs;
  while (true) {
    const snapshot = await dependencies.runtimeSnapshot();
    const currentTime = dependencies.now();
    if (currentTime > deadline) break;
    if (snapshot.status === "healthy") return snapshot;
    if (snapshot.status === "failed" || snapshot.pid === null) {
      throw new Error(snapshot.lastError ?? "llama-server failed before reaching healthy state");
    }
    const remaining = deadline - currentTime;
    if (remaining <= 0) break;
    await dependencies.wait(Math.min(pollIntervalMs, remaining));
  }
  throw new Error(`llama-server did not become healthy within ${timeoutMs}ms`);
}

function validateParameterSources(active: ActiveLaunchSnapshot): void {
  const values = Object.values(active.parameters);
  if (!values.some((value) => value.source === "argument")) {
    throw new Error("activeLaunch.parameters did not record any explicit arguments");
  }
  if (!values.some((value) => value.source === "serverDefault")) {
    throw new Error("capability filtering did not preserve any serverDefault parameters");
  }
  if (values.some((value) => value.source === "serverDefault" && value.value !== null)) {
    throw new Error("serverDefault parameters must not invent effective values");
  }
}

async function proveAbortControllerCancellation(
  dependencies: NativeAcceptanceDependencies,
  active: ActiveLaunchSnapshot,
  sampling: SamplingParameters,
  timeoutMs: number,
): Promise<NonNullable<NativeAcceptanceReport["cancellation"]>> {
  const controller = new AbortController();
  let streamStarted = false;
  let abortErrorObserved = false;
  const fallbackAbort = window.setTimeout(
    () => controller.abort(new DOMException("Cancellation fixture timed out", "AbortError")),
    timeoutMs,
  );
  try {
    await dependencies.streamChatCompletion({
      host: active.host,
      port: active.port,
      modelId: active.modelId ?? "",
      messages: [{ role: "user", content: "slow cancellation acceptance" }],
      sampling,
      signal: controller.signal,
      onToken: () => {
        streamStarted = true;
        controller.abort(new DOMException("Native acceptance cancellation", "AbortError"));
      },
    });
  } catch (error) {
    abortErrorObserved = isAbortError(error);
  } finally {
    window.clearTimeout(fallbackAbort);
  }
  if (!controller.signal.aborted || !abortErrorObserved || !streamStarted) {
    throw new Error("stream cancellation did not prove AbortController propagation");
  }
  return {
    abortControllerAborted: controller.signal.aborted,
    abortErrorObserved,
    streamStarted,
  };
}

async function completeChatWithTimeout(
  dependencies: NativeAcceptanceDependencies,
  active: ActiveLaunchSnapshot,
  sampling: SamplingParameters,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new DOMException("Native acceptance chat timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    return await dependencies.completeChatCompletion({
      host: active.host,
      port: active.port,
      modelId: active.modelId ?? "",
      messages: [{ role: "user", content: "Reply with OK." }],
      sampling,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function validateStoppedSnapshot(snapshot: RuntimeSnapshot): void {
  if (snapshot.pid !== null || snapshot.activeLaunch !== null) {
    throw new Error("stop_llama_command left pid or activeLaunch populated");
  }
}

function buildLaunchConfig(config: NativeAcceptanceConfig, port: number): LaunchConfig {
  return {
    binaryPath: config.binaryPath,
    modelPath: config.modelPath,
    host: "127.0.0.1",
    port,
    parameters: {
      ctxSize: 2048,
      threads: "auto",
      threadsBatch: "auto",
      // Exercise the same backend auto-selection used by the normal app. The
      // selected llama.cpp build owns Metal/CUDA/Vulkan backend discovery.
      gpuLayers: "auto",
      batchSize: 256,
      ubatchSize: 64,
      flashAttention: "auto",
      mmap: true,
      mlock: false,
      metrics: false,
      idleSleepSeconds: 0,
      mmprojPath: null,
      mmprojOffload: true,
    },
    prometheusHints: {
      kvSubstrings: [],
      promptSubstrings: [],
      generationAnyOf: [],
      generationRequired: [],
    },
  };
}

function acceptanceSampling(): SamplingParameters {
  return {
    temperature: 0,
    topP: 1,
    topK: 1,
    minP: 0,
    repeatPenalty: 1,
    repeatLastN: 0,
    seed: 1,
    maxTokens: 8,
    stop: [],
  };
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export type { HealthStatus, NativeAcceptanceConfig };
