import type {
  GpuLayerSetting,
  LaunchConfig,
  ParameterProfile,
  SamplingParameters,
  StartupParameters,
  ValidationResult,
} from "../types/domain";
import type { CommandSpec } from "../api/tauri";

export interface CapabilityFilteredPreview {
  args: string[];
  warnings: string[];
}

export async function buildCapabilityFilteredPreview(
  config: LaunchConfig,
  buildSpec: (config: LaunchConfig) => Promise<CommandSpec>,
): Promise<CapabilityFilteredPreview> {
  const spec = await buildSpec(config);
  return {
    args: [spec.executable, ...spec.args],
    warnings: spec.warnings,
  };
}

export const defaultSampling: SamplingParameters = {
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

export const DEFAULT_CUSTOM_CONTEXT_SIZE = 8192;
export const FALLBACK_MAX_CONTEXT_SIZE = 32768;

const customParameters: StartupParameters = {
  ctxSize: DEFAULT_CUSTOM_CONTEXT_SIZE,
  threads: "auto",
  threadsBatch: "auto",
  gpuLayers: "auto",
  batchSize: 1024,
  ubatchSize: 256,
  flashAttention: "auto",
  mmap: true,
  mlock: false,
  metrics: true,
  idleSleepSeconds: 0,
  mmprojPath: null,
  mmprojOffload: true,
};

export const builtInProfiles: ParameterProfile[] = [
  {
    id: "max-capability",
    name: "自动配置",
    description: "按模型元数据设置上下文，并为提示词和历史保留充足空间。",
    parameters: {
      ...customParameters,
      ctxSize: FALLBACK_MAX_CONTEXT_SIZE,
      gpuLayers: "all",
      batchSize: 2048,
      ubatchSize: 512,
    },
    sampling: {
      ...defaultSampling,
      maxTokens: calculateMaxOutputTokens(FALLBACK_MAX_CONTEXT_SIZE),
    },
  },
  {
    id: "custom",
    name: "自定义",
    description: "手动调整上下文长度、输出长度和高级启动参数。",
    parameters: customParameters,
    sampling: defaultSampling,
  },
];

export function getProfileById(id: string): ParameterProfile {
  return builtInProfiles.find((profile) => profile.id === id) ?? builtInProfiles[1];
}

export function resolveModelContextLimit(modelContextLength: number | null | undefined): number {
  if (!Number.isFinite(modelContextLength) || !modelContextLength || modelContextLength <= 0) {
    return FALLBACK_MAX_CONTEXT_SIZE;
  }
  return Math.max(1, Math.floor(modelContextLength));
}

export function calculateMaxOutputTokens(ctxSize: number): number {
  const safeCtx = Number.isFinite(ctxSize) && ctxSize > 0 ? Math.floor(ctxSize) : FALLBACK_MAX_CONTEXT_SIZE;
  const recommended = Math.floor(safeCtx * 0.25);
  return clampToStep(recommended, 256, Math.min(2048, Math.max(256, safeCtx - 1)), 64);
}

export function buildMaxCapabilityStartupParameters(
  modelContextLength: number | null | undefined,
  current: StartupParameters,
): StartupParameters {
  const ctxSize = resolveModelContextLimit(modelContextLength);
  const batch = batchForContext(ctxSize);
  return {
    ...current,
    ctxSize,
    gpuLayers: "all",
    batchSize: batch.batchSize,
    ubatchSize: batch.ubatchSize,
    flashAttention: current.flashAttention === "off" ? "auto" : current.flashAttention,
    mmap: true,
    metrics: true,
  };
}

export function buildMaxCapabilitySampling(
  ctxSize: number,
  current: SamplingParameters,
): SamplingParameters {
  return {
    ...current,
    maxTokens: calculateMaxOutputTokens(ctxSize),
  };
}

function batchForContext(ctxSize: number): Pick<StartupParameters, "batchSize" | "ubatchSize"> {
  if (ctxSize >= 32768) {
    return { batchSize: 2048, ubatchSize: 512 };
  }
  if (ctxSize >= 8192) {
    return { batchSize: 1024, ubatchSize: 256 };
  }
  return { batchSize: 512, ubatchSize: 128 };
}

function clampToStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, Math.floor(value)));
  return Math.max(min, Math.floor(clamped / step) * step);
}

export function validateLaunchConfig(config: LaunchConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.binaryPath) {
    errors.push("未找到 llama-server，请选择可执行文件。");
  }

  if (!config.modelPath) {
    errors.push("请选择 GGUF 模型文件。");
  } else if (!config.modelPath.toLowerCase().endsWith(".gguf")) {
    errors.push("模型文件必须是 .gguf 格式。");
  }

  if (config.host !== "127.0.0.1") {
    errors.push("v1 仅允许绑定到 127.0.0.1。");
  }

  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    errors.push("端口必须在 1024 到 65535 之间。");
  }

  const { parameters } = config;
  if (!Number.isInteger(parameters.ctxSize) || parameters.ctxSize <= 0) {
    errors.push("上下文长度必须是正整数。");
  } else if (parameters.ctxSize > 32768) {
    warnings.push("较大的上下文长度会显著增加内存或显存占用。");
  }

  validateThreadSetting(parameters.threads, "线程数", errors);
  validateThreadSetting(parameters.threadsBatch, "Batch 线程数", errors);
  validateGpuLayers(parameters.gpuLayers, errors);

  if (!Number.isInteger(parameters.batchSize) || parameters.batchSize <= 0) {
    errors.push("Batch size 必须是正整数。");
  }

  if (!Number.isInteger(parameters.ubatchSize) || parameters.ubatchSize <= 0) {
    errors.push("Micro-batch 必须是正整数。");
  }

  if (parameters.ubatchSize > parameters.batchSize) {
    errors.push("Micro-batch 不能大于 batch size。");
  }

  if (parameters.mlock) {
    warnings.push("mlock 会锁定内存，低内存设备可能变慢或不稳定。");
  }

  if (parameters.idleSleepSeconds < 0) {
    errors.push("空闲休眠秒数不能小于 0。");
  }

  if (parameters.mmprojPath && !parameters.mmprojPath.toLowerCase().endsWith(".gguf")) {
    errors.push("mmproj 文件必须是 .gguf 格式。");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function buildCommandPreview(config: LaunchConfig): string[] {
  const args = [
    config.binaryPath?.trim() || "llama-server",
    "--model",
    config.modelPath ?? "",
    "--host",
    config.host,
    "--port",
    String(config.port),
    "--ctx-size",
    String(config.parameters.ctxSize),
    "--threads",
    normalizeThread(config.parameters.threads),
    "--threads-batch",
    normalizeThread(config.parameters.threadsBatch),
    "--n-gpu-layers",
    normalizeGpuLayers(config.parameters.gpuLayers),
    "--batch-size",
    String(config.parameters.batchSize),
    "--ubatch-size",
    String(config.parameters.ubatchSize),
  ];

  args.push("--flash-attn", config.parameters.flashAttention);

  args.push(config.parameters.mmap ? "--mmap" : "--no-mmap");

  if (config.parameters.mlock) {
    args.push("--mlock");
  }

  if (config.parameters.metrics) {
    args.push("--metrics");
  }

  if (config.parameters.idleSleepSeconds > 0) {
    args.push("--sleep-idle-seconds", String(config.parameters.idleSleepSeconds));
  }

  if (config.parameters.mmprojPath?.trim()) {
    args.push("--mmproj", config.parameters.mmprojPath.trim());
    if (!config.parameters.mmprojOffload) {
      args.push("--no-mmproj-offload");
    }
  }

  return args;
}

function validateThreadSetting(
  value: StartupParameters["threads"],
  label: string,
  errors: string[],
): void {
  if (value === "auto") {
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${label}必须是 auto 或正整数。`);
  }
}

function validateGpuLayers(value: GpuLayerSetting, errors: string[]): void {
  if (value === "auto" || value === "all") {
    return;
  }

  if (!Number.isInteger(value) || value < 0) {
    errors.push("GPU offload 层数必须是 auto、all 或非负整数。");
  }
}

function normalizeThread(value: StartupParameters["threads"]): string {
  return value === "auto" ? "-1" : String(value);
}

function normalizeGpuLayers(value: GpuLayerSetting): string {
  return String(value);
}

// flash-attn is a boolean flag, no normalize function needed.
