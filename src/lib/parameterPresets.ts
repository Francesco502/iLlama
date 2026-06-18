import type { ModelEntry, SamplingParameters, StartupParameters } from "../types/domain";

export const MODEL_FAMILY_AUTO_PRESET_SOURCE_ID = "model-family:auto";

export type UserParameterPresetId = "user:balanced" | "user:precise" | "user:creative" | "user:low-memory";
export type ParameterPresetSourceId = typeof MODEL_FAMILY_AUTO_PRESET_SOURCE_ID | UserParameterPresetId;
export type ModelFamilyId = "generic" | "gemma" | "qwen" | "llama" | "mistral";

export interface ParameterPresetSource {
  id: ParameterPresetSourceId;
  name: string;
  description: string;
}

interface ParameterPresetDefinition {
  id: string;
  name: string;
  description: string;
  sampling: Partial<SamplingParameters>;
  parameters: Partial<Pick<StartupParameters, "batchSize" | "ubatchSize" | "flashAttention" | "mmap" | "mlock">>;
}

export interface AppliedParameterPreset {
  source: ParameterPresetSource;
  appliedPreset: ParameterPresetDefinition;
  parameters: StartupParameters;
  sampling: SamplingParameters;
}

export const parameterPresetSources: ParameterPresetSource[] = [
  {
    id: MODEL_FAMILY_AUTO_PRESET_SOURCE_ID,
    name: "自动模型族",
    description: "根据 GGUF architecture 和文件名识别 Gemma、Qwen、Llama、Mistral 等模型族。",
  },
  {
    id: "user:balanced",
    name: "均衡",
    description: "通用聊天和外部客户端联调，保持稳定采样和默认吞吐设置。",
  },
  {
    id: "user:precise",
    name: "严谨/代码",
    description: "降低随机性，适合代码、结构化回答和事实型任务。",
  },
  {
    id: "user:creative",
    name: "创意写作",
    description: "提高发散度，适合头脑风暴、改写和长文风格探索。",
  },
  {
    id: "user:low-memory",
    name: "低内存",
    description: "降低 batch/micro-batch 并关闭 Flash Attention，优先提高兼容性。",
  },
];

const genericPreset: ParameterPresetDefinition = {
  id: "family:generic",
  name: "通用模型",
  description: "未识别模型族时使用的稳健默认参数。",
  sampling: {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    minP: 0.05,
    repeatPenalty: 1.1,
  },
  parameters: {
    flashAttention: "auto",
  },
};

const familyPresets: Record<ModelFamilyId, ParameterPresetDefinition> = {
  generic: genericPreset,
  gemma: {
    id: "family:gemma",
    name: "Gemma 通用",
    description: "Gemma/Gemma 3 系列的通用聊天参数。",
    sampling: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.0,
    },
    parameters: {
      flashAttention: "auto",
    },
  },
  qwen: {
    id: "family:qwen",
    name: "Qwen 通用",
    description: "Qwen/Qwen2/Qwen3 系列的稳健指令参数。",
    sampling: {
      temperature: 0.6,
      topP: 0.95,
      topK: 20,
      minP: 0.0,
      repeatPenalty: 1.05,
    },
    parameters: {
      flashAttention: "auto",
    },
  },
  llama: {
    id: "family:llama",
    name: "Llama 通用",
    description: "Llama 系列的通用聊天参数。",
    sampling: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.1,
    },
    parameters: {
      flashAttention: "auto",
    },
  },
  mistral: {
    id: "family:mistral",
    name: "Mistral 通用",
    description: "Mistral/Mixtral 系列的通用指令参数。",
    sampling: {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.05,
    },
    parameters: {
      flashAttention: "auto",
    },
  },
};

const userPresets: Record<UserParameterPresetId, ParameterPresetDefinition> = {
  "user:balanced": {
    id: "user:balanced",
    name: "均衡",
    description: "通用聊天和外部客户端联调。",
    sampling: genericPreset.sampling,
    parameters: {
      batchSize: 1024,
      ubatchSize: 256,
      flashAttention: "auto",
    },
  },
  "user:precise": {
    id: "user:precise",
    name: "严谨/代码",
    description: "降低随机性，适合代码和事实型任务。",
    sampling: {
      temperature: 0.3,
      topP: 0.8,
      topK: 30,
      minP: 0.02,
      repeatPenalty: 1.1,
    },
    parameters: {
      batchSize: 1024,
      ubatchSize: 256,
      flashAttention: "auto",
    },
  },
  "user:creative": {
    id: "user:creative",
    name: "创意写作",
    description: "提高发散度，适合写作和改写。",
    sampling: {
      temperature: 0.9,
      topP: 0.95,
      topK: 50,
      minP: 0.05,
      repeatPenalty: 1.05,
    },
    parameters: {
      batchSize: 1024,
      ubatchSize: 256,
      flashAttention: "auto",
    },
  },
  "user:low-memory": {
    id: "user:low-memory",
    name: "低内存",
    description: "降低 batch/micro-batch 并关闭 Flash Attention。",
    sampling: {
      temperature: 0.6,
      topP: 0.9,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.1,
    },
    parameters: {
      batchSize: 512,
      ubatchSize: 128,
      flashAttention: "off",
      mlock: false,
    },
  },
};

export function detectModelFamily(model: Pick<ModelEntry, "architecture" | "fileName"> | null | undefined): ModelFamilyId {
  const architecture = model?.architecture?.toLowerCase() ?? "";
  const fileName = model?.fileName.toLowerCase() ?? "";
  const haystack = `${architecture} ${fileName}`;

  if (haystack.includes("gemma")) return "gemma";
  if (haystack.includes("qwen")) return "qwen";
  if (haystack.includes("mistral") || haystack.includes("mixtral")) return "mistral";
  if (haystack.includes("llama") || haystack.includes("granite")) return "llama";
  return "generic";
}

export function normalizeParameterPresetSourceId(sourceId: string | null | undefined): ParameterPresetSourceId {
  return parameterPresetSources.some((source) => source.id === sourceId)
    ? (sourceId as ParameterPresetSourceId)
    : MODEL_FAMILY_AUTO_PRESET_SOURCE_ID;
}

export function applyParameterPresetSource(
  sourceId: string | null | undefined,
  model: Pick<ModelEntry, "architecture" | "fileName"> | null | undefined,
  parameters: StartupParameters,
  sampling: SamplingParameters,
): AppliedParameterPreset {
  const normalizedSourceId = normalizeParameterPresetSourceId(sourceId);
  const source = parameterPresetSources.find((item) => item.id === normalizedSourceId) ?? parameterPresetSources[0];
  const preset =
    normalizedSourceId === MODEL_FAMILY_AUTO_PRESET_SOURCE_ID
      ? familyPresets[detectModelFamily(model)]
      : userPresets[normalizedSourceId];

  return {
    source,
    appliedPreset: preset,
    parameters: {
      ...parameters,
      ...preset.parameters,
    },
    sampling: {
      ...sampling,
      ...preset.sampling,
    },
  };
}
