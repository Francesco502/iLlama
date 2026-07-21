export type RuntimeStatus =
  | "idle"
  | "scanning"
  | "starting"
  | "healthy"
  | "failed"
  | "stopping"
  | "stopped";

export type AutoNumber = "auto";
export type GpuLayerSetting = "auto" | "all" | number;
export type FlashAttentionSetting = "auto" | "on" | "off";

export interface ModelDirectory {
  path: string;
  status: "ready" | "missing" | "scanning";
  progress?: {
    filesScanned: number;
    modelsFound: number;
  };
  lastError?: string;
}

export interface ModelEntry {
  path: string;
  fileName: string;
  directory: string;
  sizeBytes: number;
  modifiedAt: string;
  architecture?: string;
  quantization?: string;
  contextLength?: number;
  parameterCount?: string;
  metadataStatus: "ready" | "limited" | "invalid";
  metadataError?: string;
  available: boolean;
  mmprojCandidates: string[];
}

export interface StartupParameters {
  ctxSize: number;
  threads: AutoNumber | number;
  threadsBatch: AutoNumber | number;
  gpuLayers: GpuLayerSetting;
  batchSize: number;
  ubatchSize: number;
  flashAttention: FlashAttentionSetting;
  mmap: boolean;
  mlock: boolean;
  metrics: boolean;
  idleSleepSeconds: number;
  mmprojPath: string | null;
  mmprojOffload: boolean;
}

/** Substrings for matching Prometheus metric names; leave arrays empty to use built-in defaults. */
export interface PrometheusHintsConfig {
  kvSubstrings: string[];
  promptSubstrings: string[];
  generationAnyOf: string[];
  generationRequired: string[];
}

export function emptyPrometheusHintsConfig(): PrometheusHintsConfig {
  return {
    kvSubstrings: [],
    promptSubstrings: [],
    generationAnyOf: [],
    generationRequired: [],
  };
}

export interface SamplingParameters {
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  repeatLastN: number;
  seed: number | null;
  maxTokens: number;
  stop: string[];
}

export interface ParameterProfile {
  id: "max-capability" | "custom";
  name: string;
  description: string;
  parameters: StartupParameters;
  sampling: SamplingParameters;
}

export interface LaunchConfig {
  binaryPath: string | null;
  modelPath: string | null;
  host: "127.0.0.1";
  port: number;
  parameters: StartupParameters;
  prometheusHints: PrometheusHintsConfig;
}

export interface DraftLaunchConfig extends LaunchConfig {
  autoPort: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

export interface RuntimeMetrics {
  cpuPercent: number | null;
  memoryBytes: number | null;
  tokensPerSecond: number | null;
  promptTokensPerSecond: number | null;
  kvCacheUsageRatio: number | null;
}
