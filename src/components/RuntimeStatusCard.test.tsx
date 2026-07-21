import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSnapshot } from "../api/tauri";
import { RuntimeStatusCard } from "./RuntimeStatusCard";

const snapshot: RuntimeSnapshot = {
  status: "healthy",
  pid: 4312,
  startedAt: "2026-07-21T08:00:00.000Z",
  activeModelPath: "/models/Qwen 3.gguf",
  activeLaunch: {
    binaryPath: "/opt/llama-server",
    modelPath: "/models/Qwen 3.gguf",
    host: "127.0.0.1",
    port: 8088,
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
    startedAt: "2026-07-21T08:00:00.000Z",
    modelId: "qwen-runtime-id",
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

describe("RuntimeStatusCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T08:01:05.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render without an active launch", () => {
    const { container } = render(
      <RuntimeStatusCard
        snapshot={{ ...snapshot, pid: null, activeLaunch: null }}
        onStop={() => undefined}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the actual launch model, port, pid, uptime, and status", () => {
    render(<RuntimeStatusCard snapshot={snapshot} onStop={() => undefined} />);

    expect(screen.getByRole("region", { name: "当前运行状态" })).toBeInTheDocument();
    expect(screen.getByText("qwen-runtime-id")).toBeInTheDocument();
    expect(screen.getByText("8088")).toBeInTheDocument();
    expect(screen.getByText("4312")).toBeInTheDocument();
    expect(screen.getByText("00:01:05")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });

  it("falls back to the active model filename when no model id is available", () => {
    render(
      <RuntimeStatusCard
        snapshot={{
          ...snapshot,
          activeLaunch: { ...snapshot.activeLaunch!, modelId: null },
        }}
        onStop={() => undefined}
      />,
    );

    expect(screen.getByText("Qwen 3.gguf")).toBeInTheDocument();
  });

  it("updates uptime once per second and clears the timer on unmount", () => {
    const { unmount } = render(
      <RuntimeStatusCard snapshot={snapshot} onStop={() => undefined} />,
    );

    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("00:01:06")).toBeInTheDocument();

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps stop available and warns when startup exceeds 120 seconds", () => {
    const onStop = vi.fn();
    render(
      <RuntimeStatusCard
        snapshot={{
          ...snapshot,
          status: "starting",
          activeLaunch: {
            ...snapshot.activeLaunch!,
            startedAt: "2026-07-21T07:59:04.000Z",
          },
        }}
        onStop={onStop}
      />,
    );

    expect(screen.getByText("加载较慢，服务仍在启动中")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止服务" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("hides stop when the snapshot has no pid", () => {
    render(<RuntimeStatusCard snapshot={{ ...snapshot, pid: null }} onStop={() => undefined} />);

    expect(screen.queryByRole("button", { name: "停止服务" })).not.toBeInTheDocument();
  });
});
