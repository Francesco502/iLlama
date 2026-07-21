import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSnapshot } from "../api/tauri";
import type { LaunchConfig } from "../types/domain";
import { runtimeSnapshot, startLlama, stopLlama } from "../api/tauri";
import { useLlamaProcess } from "./useLlamaProcess";

vi.mock("../api/tauri", () => ({
  isTauriRuntime: () => true,
  runtimeSnapshot: vi.fn(),
  startLlama: vi.fn(),
  stopLlama: vi.fn(),
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

const startingSnapshot: RuntimeSnapshot = {
  status: "starting",
  pid: 42,
  startedAt: "2026-07-21T00:00:00Z",
  activeModelPath: config.modelPath,
  activeLaunch: {
    binaryPath: config.binaryPath!,
    modelPath: config.modelPath!,
    host: config.host,
    port: config.port,
    parameters: config.parameters,
    prometheusHints: config.prometheusHints,
    startedAt: "2026-07-21T00:00:00Z",
    modelId: null,
    serverCapabilities: null,
  },
  lastError: null,
  metrics: {
    cpuPercent: null,
    memoryBytes: null,
    tokensPerSecond: null,
    promptTokensPerSecond: null,
    kvCacheUsageRatio: null,
  },
  logs: [],
};

describe("useLlamaProcess", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(startLlama).mockResolvedValue(startingSnapshot);
    vi.mocked(runtimeSnapshot).mockResolvedValue(startingSnapshot);
    vi.mocked(stopLlama).mockResolvedValue({ ...startingSnapshot, status: "stopped", pid: null });
  });

  afterEach(() => vi.useRealTimers());

  it("exposes the backend active launch snapshot after starting", async () => {
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog: vi.fn(), mergeLogs: vi.fn() }),
    );

    await act(async () => result.current.handleStart(config));

    expect(result.current.snapshot.activeLaunch?.modelPath).toBe("/models/a.gguf");
    expect(result.current.canStop).toBe(true);
  });

  it("keeps a live process in starting state after two minutes", async () => {
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog: vi.fn(), mergeLogs: vi.fn() }),
    );
    await act(async () => result.current.handleStart(config));

    await act(async () => vi.advanceTimersByTimeAsync(121_000));

    expect(result.current.snapshot.status).toBe("starting");
    expect(result.current.snapshot.pid).toBe(42);
    expect(result.current.canStop).toBe(true);
  });

  it("ignores an old in-flight poll after stop and a new start", async () => {
    let resolveOldPoll!: (snapshot: RuntimeSnapshot) => void;
    vi.mocked(runtimeSnapshot).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOldPoll = resolve;
      }),
    );
    const configB = { ...config, modelPath: "/models/b.gguf", port: 9090 };
    const snapshotB: RuntimeSnapshot = {
      ...startingSnapshot,
      pid: 84,
      activeModelPath: configB.modelPath,
      activeLaunch: {
        ...startingSnapshot.activeLaunch!,
        modelPath: configB.modelPath!,
        port: configB.port,
      },
    };
    vi.mocked(startLlama)
      .mockResolvedValueOnce(startingSnapshot)
      .mockResolvedValueOnce(snapshotB);
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog: vi.fn(), mergeLogs: vi.fn() }),
    );
    await act(async () => result.current.handleStart(config));
    act(() => vi.advanceTimersByTime(800));
    await act(async () => result.current.handleStop());
    await act(async () => result.current.handleStart(configB));

    await act(async () => {
      resolveOldPoll({ ...startingSnapshot, status: "stopped", pid: null, activeLaunch: null });
      await Promise.resolve();
    });

    expect(result.current.snapshot.pid).toBe(84);
    expect(result.current.snapshot.activeLaunch?.modelPath).toBe("/models/b.gguf");
  });
});
