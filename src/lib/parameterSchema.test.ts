import { describe, expect, it, vi } from "vitest";
import {
  buildMaxCapabilitySampling,
  buildMaxCapabilityStartupParameters,
  buildCommandPreview,
  builtInProfiles,
  calculateMaxOutputTokens,
  getProfileById,
  validateLaunchConfig,
} from "./parameterSchema";
import * as parameterSchema from "./parameterSchema";
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
  it("builds command previews from the backend capability-filtered command spec", async () => {
    expect(parameterSchema.buildCapabilityFilteredPreview).toBeTypeOf("function");
    const config = {
      binaryPath: "/Applications/llama server",
      modelPath: "/Models/Test.gguf",
      host: "127.0.0.1" as const,
      port: 8080,
      parameters: getProfileById("custom").parameters,
      prometheusHints: emptyPrometheusHintsConfig(),
    };
    const buildSpec = vi.fn().mockResolvedValue({
      executable: "/Applications/llama server",
      args: ["--model", "/Models/Test.gguf", "--port", "8080"],
      warnings: ["当前 llama-server 不支持 --metrics，已从启动命令省略。"],
      capabilities: {
        binaryPath: "/Applications/llama server",
        versionText: "llama-server 1",
        supportedFlags: ["--model", "--host", "--port"],
        status: "limited" as const,
        warnings: [],
      },
    });

    const preview = await parameterSchema.buildCapabilityFilteredPreview(config, buildSpec);

    expect(buildSpec).toHaveBeenCalledWith(config);
    expect(preview).toEqual({
      args: [
        "/Applications/llama server",
        "--model",
        "/Models/Test.gguf",
        "--port",
        "8080",
      ],
      warnings: ["当前 llama-server 不支持 --metrics，已从启动命令省略。"],
    });
  });
  it("builds a stable balanced llama-server command preview", () => {
    const preview = buildCommandPreview(baseConfig);

    expect(preview).toEqual([
      "/usr/local/bin/llama-server",
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
      "--flash-attn",
      "auto",
      "--mmap",
      "--metrics",
    ]);
  });

  it("passes explicit flash attention modes to llama-server", () => {
    const offPreview = buildCommandPreview({
      ...baseConfig,
      parameters: { ...baseConfig.parameters, flashAttention: "off" },
    });
    const onPreview = buildCommandPreview({
      ...baseConfig,
      parameters: { ...baseConfig.parameters, flashAttention: "on" },
    });

    expect(offPreview).toEqual(expect.arrayContaining(["--flash-attn", "off"]));
    expect(onPreview).toEqual(expect.arrayContaining(["--flash-attn", "on"]));
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

  it("exposes only automatic and custom parameter modes", () => {
    expect(builtInProfiles.map((profile) => profile.id)).toEqual(["max-capability", "custom"]);
    expect(getProfileById("max-capability").name).toBe("自动配置");

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
    expect(sampling.maxTokens).toBe(2048);
  });

  it("uses the full 256k model context in maximum capability mode", () => {
    const parameters = buildMaxCapabilityStartupParameters(262_144, baseConfig.parameters);
    const sampling = buildMaxCapabilitySampling(parameters.ctxSize, defaultSampling());

    expect(parameters.ctxSize).toBe(262_144);
    expect(sampling.maxTokens).toBe(2048);
  });

  it("does not impose a fixed app ceiling when model metadata reports a larger context", () => {
    const parameters = buildMaxCapabilityStartupParameters(524_288, baseConfig.parameters);
    const sampling = buildMaxCapabilitySampling(parameters.ctxSize, defaultSampling());

    expect(parameters.ctxSize).toBe(524_288);
    expect(sampling.maxTokens).toBe(2048);
  });

  it("reserves most of a small context window for prompts", () => {
    expect(calculateMaxOutputTokens(4096)).toBe(1024);
    expect(calculateMaxOutputTokens(8192)).toBe(2048);
  });
});

function defaultSampling() {
  return getProfileById("custom").sampling;
}
