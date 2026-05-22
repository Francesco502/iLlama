import { describe, expect, it } from "vitest";
import {
  buildMaxCapabilitySampling,
  buildMaxCapabilityStartupParameters,
  buildCommandPreview,
  builtInProfiles,
  calculateMaxOutputTokens,
  getProfileById,
  validateLaunchConfig,
} from "./parameterSchema";
import type { LaunchConfig } from "../types/domain";
import { emptyPrometheusHintsConfig } from "../types/domain";

const baseConfig: LaunchConfig = {
  binaryPath: "/usr/local/bin/llama-server",
  modelPath: "/models/qwen2.5-7b-instruct-q4_k_m.gguf",
  host: "127.0.0.1",
  port: 8080,
  parameters: {
    ctxSize: 8192,
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
  },
  prometheusHints: emptyPrometheusHintsConfig(),
};

describe("parameter schema", () => {
  it("builds a stable balanced llama-server command preview", () => {
    const preview = buildCommandPreview(baseConfig);

    expect(preview).toEqual([
      "llama-server",
      "--model",
      "/models/qwen2.5-7b-instruct-q4_k_m.gguf",
      "--host",
      "127.0.0.1",
      "--port",
      "8080",
      "--ctx-size",
      "8192",
      "--threads",
      "-1",
      "--threads-batch",
      "-1",
      "--n-gpu-layers",
      "auto",
      "--batch-size",
      "1024",
      "--ubatch-size",
      "256",
      "--mmap",
      "--metrics",
    ]);
  });

  it("includes a selected multimodal projector in the command preview", () => {
    const preview = buildCommandPreview({
      ...baseConfig,
      parameters: {
        ...baseConfig.parameters,
        mmprojPath: "/models/mmproj-qwen2.5-vl.gguf",
        mmprojOffload: false,
      },
    });

    expect(preview).toContain("--mmproj");
    expect(preview).toContain("/models/mmproj-qwen2.5-vl.gguf");
    expect(preview).toContain("--no-mmproj-offload");
  });

  it("rejects invalid port values", () => {
    const result = validateLaunchConfig({ ...baseConfig, port: 80 });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("端口必须在 1024 到 65535 之间。");
  });

  it("rejects micro-batches larger than the batch size", () => {
    const result = validateLaunchConfig({
      ...baseConfig,
      parameters: {
        ...baseConfig.parameters,
        batchSize: 256,
        ubatchSize: 512,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Micro-batch 不能大于 batch size。");
  });

  it("exposes only maximum capability and custom parameter modes", () => {
    expect(builtInProfiles.map((profile) => profile.id)).toEqual(["max-capability", "custom"]);

    const profile = getProfileById("custom");
    expect(profile.name).toBe("自定义");
    expect(profile.parameters.ctxSize).toBe(8192);
    expect(profile.parameters.metrics).toBe(true);
  });

  it("maps old preset ids to custom mode for upgraded settings", () => {
    expect(getProfileById("balanced").id).toBe("custom");
    expect(getProfileById("performance").id).toBe("custom");
  });

  it("derives maximum capability settings from model context length", () => {
    const parameters = buildMaxCapabilityStartupParameters(65_536, baseConfig.parameters);
    const sampling = buildMaxCapabilitySampling(parameters.ctxSize, defaultSampling());

    expect(parameters.ctxSize).toBe(65_536);
    expect(parameters.gpuLayers).toBe("all");
    expect(parameters.batchSize).toBe(2048);
    expect(parameters.ubatchSize).toBe(512);
    expect(sampling.maxTokens).toBe(calculateMaxOutputTokens(65_536));
    expect(sampling.maxTokens).toBeLessThan(65_536);
  });
});

function defaultSampling() {
  return getProfileById("custom").sampling;
}
