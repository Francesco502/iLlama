import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSnapshot } from "../api/tauri";
import type { LaunchConfig } from "../types/domain";
import { isTauriRuntime, runtimeSnapshot, startLlama, stopLlama } from "../api/tauri";
import { useLlamaProcess } from "./useLlamaProcess";
import { resolvedStartupParametersFixture } from "../test/resolvedStartupParameters";

vi.mock("../api/tauri", () => ({
  isTauriRuntime: vi.fn(() => true),
  runtimeSnapshot: vi.fn(),
  startLlama: vi.fn(),
  stopLlama: vi.fn(),
  normalizeCommandError: (error: unknown) => error,
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
    parameters: resolvedStartupParametersFixture(config.parameters),
    commandArgs: [],
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
    vi.clearAllMocks();
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    vi.useFakeTimers();
    vi.mocked(startLlama).mockResolvedValue(startingSnapshot);
    vi.mocked(runtimeSnapshot).mockResolvedValue(startingSnapshot);
    vi.mocked(stopLlama).mockResolvedValue({ ...startingSnapshot, status: "stopped", pid: null });
  });

  afterEach(() => vi.useRealTimers());

  it("hydrates an already-running backend process on mount", async () => {
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog: vi.fn(), mergeLogs: vi.fn() }),
    );

    await act(async () => Promise.resolve());

    expect(runtimeSnapshot).toHaveBeenCalled();
    expect(result.current.snapshot.pid).toBe(42);
    expect(result.current.snapshot.activeLaunch?.modelPath).toBe("/models/a.gguf");
    expect(result.current.canStop).toBe(true);
  });

  it("retries mount hydration after a temporary invoke failure", async () => {
    vi.mocked(runtimeSnapshot)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValueOnce(startingSnapshot);
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog: vi.fn(), mergeLogs: vi.fn() }),
    );
    await act(async () => Promise.resolve());

    expect(result.current.snapshot.status).toBe("idle");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(runtimeSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot.pid).toBe(42);
    expect(result.current.canStop).toBe(true);
  });

  it("exposes the backend active launch snapshot after starting", async () => {
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog: vi.fn(), mergeLogs: vi.fn() }),
    );

    await act(async () => result.current.handleStart(config));

    expect(result.current.snapshot.activeLaunch?.modelPath).toBe("/models/a.gguf");
    expect(result.current.canStop).toBe(true);
  });

  it("does not fabricate a running process in browser preview mode", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    const appendSystemLog = vi.fn();
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog, mergeLogs: vi.fn() }),
    );

    await act(async () => result.current.handleStart(config));

    expect(result.current.snapshot.status).toBe("idle");
    expect(result.current.snapshot.pid).toBeNull();
    expect(result.current.snapshot.activeLaunch).toBeNull();
    expect(startLlama).not.toHaveBeenCalled();
    expect(appendSystemLog).toHaveBeenCalledWith(
      "浏览器预览模式仅展示界面，无法执行原生 llama-server。",
    );
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

  it("coalesces repeated starts while the first start request is in flight", async () => {
    let resolveStart!: (snapshot: RuntimeSnapshot) => void;
    vi.mocked(startLlama).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog: vi.fn(), mergeLogs: vi.fn() }),
    );

    let firstStart!: Promise<void>;
    act(() => {
      firstStart = result.current.handleStart(config);
    });
    expect(result.current.isStartPending).toBe(true);
    await act(async () => result.current.handleStart(config));
    expect(startLlama).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveStart(startingSnapshot);
      await firstStart;
    });
    expect(result.current.isStartPending).toBe(false);
    expect(result.current.canStop).toBe(true);
  });

  it("preserves a structured recovery action when start fails", async () => {
    vi.mocked(startLlama).mockRejectedValueOnce({
      code: "port_unavailable",
      message: "端口被占用",
      recoveryAction: "changePort",
    });
    const { result } = renderHook(() =>
      useLlamaProcess({ appendSystemLog: vi.fn(), mergeLogs: vi.fn() }),
    );

    await act(async () => result.current.handleStart(config));

    expect(result.current.commandError).toEqual({
      code: "port_unavailable",
      message: "端口被占用",
      recoveryAction: "changePort",
    });
  });
});
