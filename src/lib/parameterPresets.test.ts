import { describe, expect, it } from "vitest";
import { getProfileById } from "./parameterSchema";
import {
  applyParameterPresetSource,
  detectModelFamily,
  MODEL_FAMILY_AUTO_PRESET_SOURCE_ID,
} from "./parameterPresets";
import type { ModelEntry } from "../types/domain";

const baseModel: ModelEntry = {
  path: "/models/qwen3-8b-q4_k_m.gguf",
  fileName: "qwen3-8b-q4_k_m.gguf",
  directory: "/models",
  sizeBytes: 1,
  modifiedAt: "2026-06-08T00:00:00Z",
  architecture: "qwen3",
  quantization: "Q4_K_M",
  contextLength: 32768,
  metadataStatus: "ready",
  available: true,
  mmprojCandidates: [],
};

describe("parameter preset sources", () => {
  it("detects common model families from architecture and file name", () => {
    expect(detectModelFamily({ architecture: "gemma3", fileName: "model.gguf" })).toBe("gemma");
    expect(detectModelFamily({ architecture: "qwen2", fileName: "model.gguf" })).toBe("qwen");
    expect(detectModelFamily({ architecture: "llama", fileName: "model.gguf" })).toBe("llama");
    expect(detectModelFamily({ architecture: undefined, fileName: "Mistral-7B-Instruct.gguf" })).toBe("mistral");
    expect(detectModelFamily({ architecture: undefined, fileName: "unknown.gguf" })).toBe("generic");
  });

  it("applies the detected model-family preset without changing context size", () => {
    const parameters = { ...getProfileById("max-capability").parameters, ctxSize: 262144 };
    const sampling = getProfileById("custom").sampling;

    const result = applyParameterPresetSource(
      MODEL_FAMILY_AUTO_PRESET_SOURCE_ID,
      baseModel,
      parameters,
      sampling,
    );

    expect(result.source.name).toBe("自动模型族");
    expect(result.appliedPreset.name).toContain("Qwen");
    expect(result.parameters.ctxSize).toBe(262144);
    expect(result.parameters.flashAttention).toBe("auto");
    expect(result.sampling.temperature).toBe(0.6);
    expect(result.sampling.topP).toBe(0.95);
    expect(result.sampling.repeatPenalty).toBe(1.05);
  });

  it("applies app user presets over current parameters", () => {
    const parameters = {
      ...getProfileById("max-capability").parameters,
      ctxSize: 131072,
      batchSize: 2048,
      ubatchSize: 512,
      flashAttention: "auto" as const,
    };
    const sampling = getProfileById("custom").sampling;

    const result = applyParameterPresetSource("user:low-memory", baseModel, parameters, sampling);

    expect(result.source.name).toBe("低内存");
    expect(result.parameters.ctxSize).toBe(131072);
    expect(result.parameters.batchSize).toBe(512);
    expect(result.parameters.ubatchSize).toBe(128);
    expect(result.parameters.flashAttention).toBe("off");
    expect(result.sampling.temperature).toBe(0.6);
    expect(result.sampling.topP).toBe(0.9);
  });
});
