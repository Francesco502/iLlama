import type { AppSettings } from "../api/tauri";
import type {
  ModelDirectory,
  ModelEntry,
  ParameterProfile,
  PrometheusHintsConfig,
  StartupParameters,
} from "../types/domain";
import type { ParameterPresetSourceId } from "../lib/parameterPresets";

interface SettingsSnapshotInput {
  directories: ModelDirectory[];
  binaryPath: string | null;
  profileId: ParameterProfile["id"];
  parameterPresetSourceId: ParameterPresetSourceId;
  selectedModelPath: string | null;
  port: number;
  startupParameters: StartupParameters;
  prometheusHints: PrometheusHintsConfig;
}

export function mergeScannedModels(
  currentModels: ModelEntry[],
  directoryPath: string,
  scannedModels: ModelEntry[],
): ModelEntry[] {
  return [...removeDirectoryModels(currentModels, directoryPath), ...scannedModels];
}

export function removeDirectoryModels(models: ModelEntry[], directoryPath: string): ModelEntry[] {
  return models.filter((model) => !isPathInsideDirectory(model.path, directoryPath));
}

export function pickSelectedModelPath(
  models: ModelEntry[],
  preferredPath: string | null,
): string | null {
  if (preferredPath && models.some((model) => model.path === preferredPath)) {
    return preferredPath;
  }
  return models[0]?.path ?? null;
}

export function reconcileMmprojPathForModel(
  currentMmprojPath: string | null,
  selectedModel: ModelEntry | null,
): string | null {
  const candidates = selectedModel?.mmprojCandidates ?? [];
  if (currentMmprojPath && candidates.includes(currentMmprojPath)) {
    return currentMmprojPath;
  }
  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }
  return null;
}

export function buildSettingsSnapshot({
  directories,
  binaryPath,
  profileId,
  parameterPresetSourceId,
  selectedModelPath,
  port,
  startupParameters,
  prometheusHints,
}: SettingsSnapshotInput): AppSettings {
  return {
    schemaVersion: 2,
    modelDirectories: directories
      .filter((directory) => directory.status === "ready")
      .map((directory) => directory.path),
    llamaServerPath: binaryPath,
    defaultPresetId: profileId,
    parameterPresetSourceId,
    lastSelectedModelPath: selectedModelPath,
    autoPort: true,
    defaultPort: port,
    idleSleepSeconds: startupParameters.idleSleepSeconds,
    prometheusHints,
  };
}

function isPathInsideDirectory(path: string, directoryPath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedDirectory = normalizePath(directoryPath);
  return (
    normalizedPath === normalizedDirectory ||
    normalizedPath.startsWith(`${normalizedDirectory}/`)
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
