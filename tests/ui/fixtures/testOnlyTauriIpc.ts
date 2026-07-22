import type { Page } from "@playwright/test";

const binaryPath = "/test-only/llama-server";
const modelDirectory = "/test-only/models";
const modelPath = `${modelDirectory}/keyboard-fixture.gguf`;

const startupParameters = {
  ctxSize: 4096,
  threads: "auto",
  threadsBatch: "auto",
  gpuLayers: "auto",
  batchSize: 512,
  ubatchSize: 128,
  flashAttention: "auto",
  mmap: true,
  mlock: false,
  metrics: true,
  idleSleepSeconds: 0,
  mmprojPath: null,
  mmprojOffload: true,
};

const prometheusHints = {
  kvSubstrings: [],
  promptSubstrings: [],
  generationAnyOf: [],
  generationRequired: [],
};

const sampling = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.1,
  repeatLastN: 64,
  seed: null,
  maxTokens: 1024,
  stop: [],
};

const model = {
  path: modelPath,
  fileName: "keyboard-fixture.gguf",
  directory: modelDirectory,
  sizeBytes: 1024,
  modifiedAt: "2026-07-22T00:00:00.000Z",
  architecture: "llama",
  quantization: "Q4_K_M",
  contextLength: 4096,
  parameterCount: "test-only",
  metadataStatus: "ready",
  available: true,
  mmprojCandidates: [],
};

const settings = {
  schemaVersion: 3,
  modelDirectories: [modelDirectory],
  llamaServerPath: binaryPath,
  launchDraft: {
    profileId: "custom",
    parameterPresetSourceId: "model-family:auto",
    selectedModelPath: modelPath,
    autoPort: false,
    port: 8080,
    parameters: startupParameters,
    prometheusHints,
  },
  sampling,
  ui: {
    showInMenuBar: false,
    logPanelOpen: false,
    logPanelHeight: 180,
    advancedOpen: false,
  },
};

const idleMetrics = {
  cpuPercent: null,
  memoryBytes: null,
  tokensPerSecond: null,
  promptTokensPerSecond: null,
  kvCacheUsageRatio: null,
};

const idleSnapshot = {
  status: "idle",
  pid: null,
  startedAt: null,
  activeModelPath: null,
  activeLaunch: null,
  lastError: null,
  metrics: idleMetrics,
  logs: [],
};

/**
 * Installs a browser-only Tauri IPC double before application code loads.
 * It proves React keyboard/UI semantics only; it never starts or observes a native process.
 */
export async function installTestOnlyTauriIpcFixture(page: Page): Promise<void> {
  await page.addInitScript(
    ({ fixtureBinaryPath, fixtureModel, fixtureSettings, initialSnapshot }) => {
      const calls: string[] = [];
      const callbacks = new Map<number, (data: unknown) => unknown>();
      const eventListeners = new Map<string, number[]>();
      let callbackId = 0;
      let trayEnabled = false;
      let snapshot: unknown = initialSnapshot;

      function transformCallback(callback: (data: unknown) => unknown, once = false): number {
        callbackId += 1;
        const id = callbackId;
        callbacks.set(id, (data) => {
          if (once) callbacks.delete(id);
          return callback?.(data);
        });
        return id;
      }

      function unregisterCallback(id: number): void {
        callbacks.delete(id);
      }

      function runCallback(id: number, data: unknown): void {
        callbacks.get(id)?.(data);
      }

      function runningSnapshot(config: Record<string, unknown>) {
        const parameters = config.parameters as Record<string, unknown>;
        const applied = (value: unknown) => ({ source: "argument", value });
        const startedAt = new Date().toISOString();
        return {
          status: "healthy",
          pid: 4242,
          startedAt,
          activeModelPath: fixtureModel.path,
          activeLaunch: {
            binaryPath: fixtureBinaryPath,
            modelPath: fixtureModel.path,
            host: "127.0.0.1",
            port: 8080,
            parameters: {
              ctxSize: applied(parameters.ctxSize),
              threads: applied(parameters.threads),
              threadsBatch: applied(parameters.threadsBatch),
              gpuLayers: applied(parameters.gpuLayers),
              batchSize: applied(parameters.batchSize),
              ubatchSize: applied(parameters.ubatchSize),
              flashAttention: applied(parameters.flashAttention),
              mmap: applied(parameters.mmap),
              mlock: applied(parameters.mlock),
              metrics: applied(parameters.metrics),
              idleSleepSeconds: applied(parameters.idleSleepSeconds),
              mmprojPath: applied(parameters.mmprojPath),
              mmprojOffload: applied(parameters.mmprojOffload),
            },
            commandArgs: ["--model", fixtureModel.path, "--host", "127.0.0.1", "--port", "8080"],
            prometheusHints: config.prometheusHints,
            startedAt,
            modelId: "test-only-model",
            serverCapabilities: {
              binaryPath: fixtureBinaryPath,
              versionText: "test-only IPC fixture",
              supportedFlags: [],
              status: "compatible",
              warnings: [],
            },
          },
          lastError: null,
          metrics: initialSnapshot.metrics,
          logs: [],
        };
      }

      async function invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
        calls.push(command);
        switch (command) {
          case "native_acceptance_config_command":
            return null;
          case "plugin:event|listen": {
            const event = String(args.event);
            const handler = Number(args.handler);
            eventListeners.set(event, [...(eventListeners.get(event) ?? []), handler]);
            return handler;
          }
          case "plugin:event|unlisten": {
            const event = String(args.event);
            const eventId = Number(args.eventId);
            eventListeners.set(
              event,
              (eventListeners.get(event) ?? []).filter((id) => id !== eventId),
            );
            unregisterCallback(eventId);
            return null;
          }
          case "load_settings_command":
            return { settings: fixtureSettings, warnings: [] };
          case "resolve_llama_server_path_command":
            return fixtureBinaryPath;
          case "scan_model_directory_command":
            return {
              requestId: args.requestId,
              directory: fixtureModel.directory,
              models: [fixtureModel],
              filesScanned: 1,
              modelsFound: 1,
            };
          case "probe_llama_server_command":
            return {
              binaryPath: fixtureBinaryPath,
              versionText: "test-only IPC fixture",
              supportedFlags: [],
              status: "compatible",
              warnings: [],
            };
          case "build_command_spec_command":
            return {
              executable: fixtureBinaryPath,
              args: ["--model", fixtureModel.path, "--port", "8080"],
              warnings: [],
              capabilities: args.capabilities,
            };
          case "validate_launch_config_command":
            return { valid: true, errors: [], warnings: [] };
          case "build_command_args_command":
            return ["--model", fixtureModel.path, "--port", "8080"];
          case "find_available_port_command":
            return Number(args.preferred ?? 8080);
          case "start_llama_command":
            snapshot = runningSnapshot(args.config as Record<string, unknown>);
            return snapshot;
          case "runtime_snapshot_command":
            return snapshot;
          case "check_health_command":
            return { healthy: true, message: "test-only IPC health fixture" };
          case "stop_llama_command":
            snapshot = { ...initialSnapshot, status: "stopped" };
            return snapshot;
          case "patch_settings_command":
            return { settings: fixtureSettings, warnings: [] };
          case "get_tray_enabled_command":
            return trayEnabled;
          case "set_tray_enabled_command":
            trayEnabled = Boolean(args.enabled);
            return trayEnabled;
          default:
            throw new Error(`Unexpected test-only IPC command: ${command}`);
        }
      }

      Object.defineProperty(window, "__ILLAMA_TEST_ONLY_IPC__", {
        configurable: true,
        value: { calls, kind: "browser-test-only" },
      });
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {
          callbacks,
          invoke,
          runCallback,
          transformCallback,
          unregisterCallback,
        },
      });
      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        configurable: true,
        value: { unregisterListener: (_event: string, id: number) => unregisterCallback(id) },
      });
    },
    {
      fixtureBinaryPath: binaryPath,
      fixtureModel: model,
      fixtureSettings: settings,
      initialSnapshot: idleSnapshot,
    },
  );
}
