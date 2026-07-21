import type { AppSettings } from "../api/tauri";
import type {
  ModelDirectory,
  ModelEntry,
  ParameterProfile,
  PrometheusHintsConfig,
  SamplingParameters,
  StartupParameters,
} from "../types/domain";
import type { ParameterPresetSourceId } from "../lib/parameterPresets";

interface SettingsSnapshotInput {
  directories: ModelDirectory[];
  binaryPath: string | null;
  profileId: ParameterProfile["id"];
  parameterPresetSourceId: ParameterPresetSourceId;
  selectedModelPath: string | null;
  autoPort: boolean;
  port: number;
  startupParameters: StartupParameters;
  sampling: SamplingParameters;
  prometheusHints: PrometheusHintsConfig;
  ui: AppSettings["ui"];
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
  const selectableModels = models.filter(isSelectableModel);
  if (preferredPath && selectableModels.some((model) => model.path === preferredPath)) {
    return preferredPath;
  }
  return selectableModels[0]?.path ?? null;
}

function isSelectableModel(model: ModelEntry): boolean {
  return model.available && model.metadataStatus !== "invalid";
}

export function getModelLaunchAssessment(model: ModelEntry | null): {
  allowed: boolean;
  error?: string;
  warning?: string;
} {
  if (!model) return { allowed: false, error: "请先选择 GGUF 模型。" };
  if (model.metadataStatus === "invalid") {
    return { allowed: false, error: model.metadataError ?? "无效 GGUF 文件。" };
  }
  if (!model.available) return { allowed: false, error: "模型文件当前不可用。" };
  if (model.metadataStatus === "limited") {
    return { allowed: true, warning: model.metadataError ?? "模型元数据读取不完整。" };
  }
  return { allowed: true };
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
  autoPort,
  port,
  startupParameters,
  sampling,
  prometheusHints,
  ui,
}: SettingsSnapshotInput): AppSettings {
  return {
    schemaVersion: 3,
    modelDirectories: directories
      .filter((directory) => directory.status === "ready")
      .map((directory) => directory.path),
    llamaServerPath: binaryPath,
    launchDraft: {
      profileId: profileId === "max-capability" ? "auto" : "custom",
      parameterPresetSourceId,
      selectedModelPath,
      autoPort,
      port,
      parameters: startupParameters,
      prometheusHints,
    },
    sampling,
    ui,
  };
}

export async function resolveLaunchPort(
  autoPort: boolean,
  preferredPort: number,
  findPort: (host: string, preferred: number) => Promise<number>,
): Promise<number> {
  return autoPort ? findPort("127.0.0.1", preferredPort) : preferredPort;
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
