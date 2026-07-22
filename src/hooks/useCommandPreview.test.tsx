import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommandSpec, probeLlamaServer } from "../api/tauri";
import type { LaunchConfig } from "../types/domain";
import { COMMAND_PREVIEW_DEBOUNCE_MS, useCommandPreview } from "./useCommandPreview";

vi.mock("../api/tauri", () => ({
  probeLlamaServer: vi.fn(),
  buildCommandSpec: vi.fn(),
}));

const config: LaunchConfig = {
  binaryPath: "/bin/llama-server",
  modelPath: "/models/a.gguf",
  host: "127.0.0.1",
  port: 8080,
  parameters: {
    ctxSize: 4096,
    threads: "auto",
    threadsBatch: "auto",
    gpuLayers: "all",
    batchSize: 512,
    ubatchSize: 128,
    flashAttention: "auto",
    mmap: true,
    mlock: false,
    metrics: true,
    idleSleepSeconds: 0,
    mmprojPath: null,
    mmprojOffload: true,
  },
  prometheusHints: {
    kvSubstrings: [],
    promptSubstrings: [],
    generationAnyOf: [],
    generationRequired: [],
  },
};

const capabilities = {
  binaryPath: "/bin/llama-server",
  versionText: "llama.cpp fixture",
  supportedFlags: ["--model", "--host", "--port", "--ctx-size"],
  status: "compatible" as const,
  warnings: [],
};

describe("useCommandPreview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(probeLlamaServer).mockResolvedValue(capabilities);
    vi.mocked(buildCommandSpec).mockImplementation(async (next) => ({
      executable: next.binaryPath!,
      args: ["--ctx-size", String(next.parameters.ctxSize)],
      warnings: [],
      capabilities,
    }));
  });

  afterEach(() => vi.useRealTimers());

  it("debounces parameter edits and probes a stable binary only once", async () => {
    const { result, rerender } = renderHook(
      ({ next }: { next: LaunchConfig }) => useCommandPreview(next, true),
      { initialProps: { next: config } },
    );
    rerender({ next: { ...config, parameters: { ...config.parameters, ctxSize: 8192 } } });
    rerender({ next: { ...config, parameters: { ...config.parameters, ctxSize: 16384 } } });

    await act(async () => vi.advanceTimersByTimeAsync(COMMAND_PREVIEW_DEBOUNCE_MS));
    expect(probeLlamaServer).toHaveBeenCalledTimes(1);
    expect(buildCommandSpec).toHaveBeenCalledTimes(1);
    expect(result.current.args).toEqual(["/bin/llama-server", "--ctx-size", "16384"]);
    expect(result.current.capabilities).toEqual(capabilities);

    rerender({ next: { ...config, parameters: { ...config.parameters, ctxSize: 32768 } } });
    await act(async () => vi.advanceTimersByTimeAsync(COMMAND_PREVIEW_DEBOUNCE_MS));
    expect(probeLlamaServer).toHaveBeenCalledTimes(1);
    expect(buildCommandSpec).toHaveBeenCalledTimes(2);
  });
});
