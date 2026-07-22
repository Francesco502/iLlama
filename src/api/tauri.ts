import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LaunchConfig,
  LogEntry,
  ModelEntry,
  PrometheusHintsConfig,
  RuntimeMetrics,
  RuntimeStatus,
  SamplingParameters,
  StartupParameters,
  ValidationResult,
} from "../types/domain";

export interface AppSettings {
  schemaVersion: 3;
  modelDirectories: string[];
  llamaServerPath: string | null;
  launchDraft: {
    profileId: "auto" | "custom";
    parameterPresetSourceId: string;
    selectedModelPath: string | null;
    autoPort: boolean;
    port: number;
    parameters: StartupParameters;
    prometheusHints: PrometheusHintsConfig;
  };
  sampling: SamplingParameters;
  ui: {
    showInMenuBar: boolean;
    logPanelOpen: boolean;
    logPanelHeight: number;
    advancedOpen: boolean;
  };
}

export interface SettingsWarning {
  code: string;
  message: string;
  recoveryAction: string;
  recoveryTarget: string | null;
}

export interface CommandError {
  code: string;
  message: string;
  recoveryAction: string;
}

export function normalizeCommandError(error: unknown): CommandError {
  if (error && typeof error === "object") {
    const value = error as Partial<CommandError>;
    if (typeof value.message === "string") {
      return {
        code: typeof value.code === "string" ? value.code : "command_failed",
        message: value.message,
        recoveryAction:
          typeof value.recoveryAction === "string" ? value.recoveryAction : "viewLogs",
      };
    }
  }
  return {
    code: "command_failed",
    message: error instanceof Error ? error.message : String(error),
    recoveryAction: "viewLogs",
  };
}

export interface SettingsEnvelope {
  settings: AppSettings;
  warnings: SettingsWarning[];
}

export interface ActiveLaunchSnapshot {
  binaryPath: string;
  modelPath: string;
  host: "127.0.0.1";
  port: number;
  parameters: ResolvedStartupParameters;
  /** Exact argv accepted by capability filtering; authoritative for what was applied. */
  commandArgs: string[];
  prometheusHints: PrometheusHintsConfig;
  startedAt: string;
  modelId: string | null;
  serverCapabilities: ServerCapabilities | null;
}

export type AppliedParameter<T> =
  | { source: "argument"; value: T }
  | { source: "serverDefault"; value: null };

export interface ResolvedStartupParameters {
  ctxSize: AppliedParameter<StartupParameters["ctxSize"]>;
  threads: AppliedParameter<StartupParameters["threads"]>;
  threadsBatch: AppliedParameter<StartupParameters["threadsBatch"]>;
  gpuLayers: AppliedParameter<StartupParameters["gpuLayers"]>;
  batchSize: AppliedParameter<StartupParameters["batchSize"]>;
  ubatchSize: AppliedParameter<StartupParameters["ubatchSize"]>;
  flashAttention: AppliedParameter<StartupParameters["flashAttention"]>;
  mmap: AppliedParameter<StartupParameters["mmap"]>;
  mlock: AppliedParameter<StartupParameters["mlock"]>;
  metrics: AppliedParameter<StartupParameters["metrics"]>;
  idleSleepSeconds: AppliedParameter<StartupParameters["idleSleepSeconds"]>;
  mmprojPath: AppliedParameter<string>;
  mmprojOffload: AppliedParameter<StartupParameters["mmprojOffload"]>;
}

export interface ServerCapabilities {
  binaryPath: string;
  versionText: string | null;
  supportedFlags: string[];
  status: "compatible" | "limited" | "invalid";
  warnings: string[];
}

export interface CommandSpec {
  executable: string;
  args: string[];
  warnings: string[];
  capabilities: ServerCapabilities;
}

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  pid: number | null;
  startedAt: string | null;
  activeModelPath: string | null;
  activeLaunch: ActiveLaunchSnapshot | null;
  lastError: string | null;
  metrics: RuntimeMetrics;
  logs: LogEntry[];
}

export interface HealthStatus {
  healthy: boolean;
  message: string;
}

export interface ModelScanProgress {
  requestId: string;
  directory: string;
  /** Regular files visited by the non-hidden directory walk, including non-GGUF/mmproj files. */
  filesScanned: number;
  /** Available non-mmproj GGUF models; invalid candidates are excluded. */
  modelsFound: number;
}

export interface ModelScanResult {
  requestId: string;
  directory: string;
  models: ModelEntry[];
  filesScanned: number;
  modelsFound: number;
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function loadSettings(): Promise<SettingsEnvelope> {
  return invoke<SettingsEnvelope>("load_settings_command");
}

export async function resolveLlamaServerPath(requestedPath?: string | null): Promise<string | null> {
  return invoke<string | null>("resolve_llama_server_path_command", { requestedPath });
}

export type AppSettingsPatch = Omit<Partial<AppSettings>, "ui"> & {
  ui?: Partial<AppSettings["ui"]>;
};

export async function patchSettings(patch: AppSettingsPatch): Promise<SettingsEnvelope> {
  return invoke<SettingsEnvelope>("patch_settings_command", { patch });
}

export async function revealSettingsBackup(path: string): Promise<void> {
  return invoke<void>("reveal_settings_backup_command", { path });
}

export async function scanModelDirectory(
  path: string,
  requestId: string,
  onProgress?: (progress: ModelScanProgress) => void,
): Promise<ModelScanResult> {
  const unlisten = onProgress
    ? await listen<ModelScanProgress>("model-scan-progress", (event) => {
        if (event.payload.requestId === requestId) onProgress(event.payload);
      })
    : undefined;
  try {
    return await invoke<ModelScanResult>("scan_model_directory_command", { path, requestId });
  } finally {
    unlisten?.();
  }
}

export async function validateLaunchConfig(config: LaunchConfig): Promise<ValidationResult> {
  return invoke<ValidationResult>("validate_launch_config_command", { config });
}

export async function buildCommandArgs(config: LaunchConfig): Promise<string[]> {
  return invoke<string[]>("build_command_args_command", { config });
}

export async function probeLlamaServer(path: string): Promise<ServerCapabilities> {
  return invoke<ServerCapabilities>("probe_llama_server_command", { path });
}

export async function buildCommandSpec(
  config: LaunchConfig,
  capabilities?: ServerCapabilities,
): Promise<CommandSpec> {
  return invoke<CommandSpec>("build_command_spec_command", { config, capabilities });
}

export async function startLlama(config: LaunchConfig): Promise<RuntimeSnapshot> {
  return invoke<RuntimeSnapshot>("start_llama_command", { config });
}

export async function stopLlama(): Promise<RuntimeSnapshot> {
  return invoke<RuntimeSnapshot>("stop_llama_command");
}

export async function runtimeSnapshot(): Promise<RuntimeSnapshot> {
  return invoke<RuntimeSnapshot>("runtime_snapshot_command");
}

export async function checkHealth(host: string, port: number): Promise<HealthStatus> {
  return invoke<HealthStatus>("check_health_command", { host, port });
}

export async function findAvailablePort(host: string, preferred: number): Promise<number> {
  return invoke<number>("find_available_port_command", { host, preferred });
}

export async function setTrayEnabled(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("set_tray_enabled_command", { enabled });
}

export async function getTrayEnabled(): Promise<boolean> {
  return invoke<boolean>("get_tray_enabled_command");
}
