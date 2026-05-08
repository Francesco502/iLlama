import { invoke } from "@tauri-apps/api/core";
import type {
  LaunchConfig,
  LogEntry,
  ModelEntry,
  RuntimeMetrics,
  RuntimeStatus,
  ValidationResult,
} from "../types/domain";

export interface AppSettings {
  schemaVersion: number;
  modelDirectories: string[];
  llamaServerPath: string | null;
  defaultPresetId: string;
  lastSelectedModelPath: string | null;
  autoPort: boolean;
  defaultPort: number;
  idleSleepSeconds: number;
  saveChatHistory: boolean;
}

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  pid: number | null;
  startedAt: string | null;
  activeModelPath: string | null;
  lastError: string | null;
  metrics: RuntimeMetrics;
  logs: LogEntry[];
}

export interface HealthStatus {
  healthy: boolean;
  message: string;
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function loadSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("load_settings_command");
}

export async function resolveLlamaServerPath(requestedPath?: string | null): Promise<string | null> {
  return invoke<string | null>("resolve_llama_server_path_command", { requestedPath });
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await invoke("save_settings_command", { settings });
}

export async function scanModelDirectory(path: string): Promise<ModelEntry[]> {
  return invoke<ModelEntry[]>("scan_model_directory_command", { path });
}

export async function validateLaunchConfig(config: LaunchConfig): Promise<ValidationResult> {
  return invoke<ValidationResult>("validate_launch_config_command", { config });
}

export async function buildCommandArgs(config: LaunchConfig): Promise<string[]> {
  return invoke<string[]>("build_command_args_command", { config });
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

export async function confirmHealth(): Promise<void> {
  await invoke("confirm_health_command");
}

export async function checkHealth(host: string, port: number): Promise<HealthStatus> {
  return invoke<HealthStatus>("check_health_command", { host, port });
}

export async function findAvailablePort(host: string, preferred: number): Promise<number> {
  return invoke<number>("find_available_port_command", { host, preferred });
}
