import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanModelDirectory } from "../api/tauri";
import { getProfileById } from "../lib/parameterSchema";
import type { ModelDirectory, ModelEntry } from "../types/domain";
import { useModelDirectoryScanning } from "./useModelDirectoryScanning";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/tauri", () => ({ scanModelDirectory: vi.fn() }));

const readyModel = (name: string): ModelEntry => ({
  path: `/models/${name}.gguf`,
  fileName: `${name}.gguf`,
  directory: "/models",
  sizeBytes: 10,
  modifiedAt: "2026-07-21T00:00:00Z",
  metadataStatus: "ready",
  available: true,
  mmprojCandidates: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function useHarness(initialDirectories: ModelDirectory[] = []) {
  const [directories, setDirectories] = useState<ModelDirectory[]>(initialDirectories);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState<string | null>(null);
  const [startupParameters, setStartupParameters] = useState(
    getProfileById("custom").parameters,
  );
  const appendSystemLog = vi.fn();
  const scanning = useModelDirectoryScanning({
    runningInTauri: true,
    appendSystemLog,
    directories,
    setDirectories,
    models,
    setModels,
    selectedModelPath,
    setSelectedModelPath,
    setStartupParameters,
  });
  return { directories, models, selectedModelPath, startupParameters, appendSystemLog, scanning };
}

describe("useModelDirectoryScanning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not let an older scan response overwrite a newer result", async () => {
    const oldScan = deferred<Awaited<ReturnType<typeof scanModelDirectory>>>();
    const newScan = deferred<Awaited<ReturnType<typeof scanModelDirectory>>>();
    vi.mocked(scanModelDirectory)
      .mockReturnValueOnce(oldScan.promise)
      .mockReturnValueOnce(newScan.promise);
    const { result } = renderHook(() => useHarness());

    let oldRequest!: Promise<void>;
    let newRequest!: Promise<void>;
    act(() => {
      oldRequest = result.current.scanning.scanDirectory("/models");
      newRequest = result.current.scanning.scanDirectory("/models");
    });
    const oldRequestId = vi.mocked(scanModelDirectory).mock.calls[0][1];
    const newRequestId = vi.mocked(scanModelDirectory).mock.calls[1][1];

    await act(async () => {
      newScan.resolve({
        requestId: newRequestId,
        directory: "/models",
        models: [readyModel("new")],
        filesScanned: 7,
        modelsFound: 1,
      });
      await newRequest;
    });
    await act(async () => {
      oldScan.resolve({
        requestId: oldRequestId,
        directory: "/models",
        models: [readyModel("old")],
        filesScanned: 99,
        modelsFound: 1,
      });
      await oldRequest;
    });

    expect(result.current.models.map((model) => model.fileName)).toEqual(["new.gguf"]);
    expect(result.current.selectedModelPath).toBe("/models/new.gguf");
    expect(result.current.directories[0]?.progress).toEqual({ filesScanned: 7, modelsFound: 1 });
  });

  it("ignores stale progress and failure from a superseded scan", async () => {
    const oldScan = deferred<Awaited<ReturnType<typeof scanModelDirectory>>>();
    const newScan = deferred<Awaited<ReturnType<typeof scanModelDirectory>>>();
    vi.mocked(scanModelDirectory)
      .mockReturnValueOnce(oldScan.promise)
      .mockReturnValueOnce(newScan.promise);
    const { result } = renderHook(() => useHarness());

    let oldRequest!: Promise<void>;
    let newRequest!: Promise<void>;
    act(() => {
      oldRequest = result.current.scanning.scanDirectory("/models");
      newRequest = result.current.scanning.scanDirectory("/models");
    });
    const oldProgress = vi.mocked(scanModelDirectory).mock.calls[0][2];
    const newProgress = vi.mocked(scanModelDirectory).mock.calls[1][2];
    const oldRequestId = vi.mocked(scanModelDirectory).mock.calls[0][1];
    const newRequestId = vi.mocked(scanModelDirectory).mock.calls[1][1];

    act(() => {
      oldProgress?.({ requestId: oldRequestId, directory: "/models", filesScanned: 99, modelsFound: 99 });
      newProgress?.({ requestId: newRequestId, directory: "/models", filesScanned: 2, modelsFound: 1 });
    });
    expect(result.current.directories[0]?.progress).toEqual({ filesScanned: 2, modelsFound: 1 });

    await act(async () => {
      newScan.resolve({
        requestId: newRequestId,
        directory: "/models",
        models: [readyModel("new")],
        filesScanned: 4,
        modelsFound: 1,
      });
      await newRequest;
    });
    await act(async () => {
      oldScan.reject(new Error("stale failure"));
      await oldRequest;
    });

    await waitFor(() => expect(result.current.directories[0]?.status).toBe("ready"));
    expect(result.current.directories[0]?.lastError).toBeUndefined();
    expect(result.current.appendSystemLog).not.toHaveBeenCalledWith("stale failure");
  });

  it("isolates bulk A+B from a single B rescan across progress, error, success, and completion", async () => {
    const bulkA = deferred<Awaited<ReturnType<typeof scanModelDirectory>>>();
    const singleB = deferred<Awaited<ReturnType<typeof scanModelDirectory>>>();
    vi.mocked(scanModelDirectory)
      .mockReturnValueOnce(bulkA.promise)
      .mockReturnValueOnce(singleB.promise);
    const { result } = renderHook(() => useHarness());

    let bulkRequest!: Promise<void>;
    act(() => {
      bulkRequest = result.current.scanning.scanDirectories(["/a", "/b"], null);
    });
    const bulkARequestId = vi.mocked(scanModelDirectory).mock.calls[0][1];
    const bulkAProgress = vi.mocked(scanModelDirectory).mock.calls[0][2];

    let singleRequest!: Promise<void>;
    act(() => {
      singleRequest = result.current.scanning.scanDirectory("/b");
    });
    const singleBRequestId = vi.mocked(scanModelDirectory).mock.calls[1][1];
    const singleBProgress = vi.mocked(scanModelDirectory).mock.calls[1][2];

    act(() => {
      bulkAProgress?.({
        requestId: bulkARequestId,
        directory: "/a",
        filesScanned: 3,
        modelsFound: 1,
      });
      singleBProgress?.({
        requestId: singleBRequestId,
        directory: "/b",
        filesScanned: 5,
        modelsFound: 0,
      });
    });

    await act(async () => {
      singleB.reject(new Error("B unavailable"));
      await singleRequest;
    });
    await act(async () => {
      bulkA.resolve({
        requestId: bulkARequestId,
        directory: "/a",
        models: [{ ...readyModel("a"), path: "/a/a.gguf", directory: "/a" }],
        filesScanned: 6,
        modelsFound: 1,
      });
      await bulkRequest;
    });

    expect(vi.mocked(scanModelDirectory)).toHaveBeenCalledTimes(2);
    expect(result.current.directories).toEqual([
      { path: "/a", status: "ready", progress: { filesScanned: 6, modelsFound: 1 } },
      {
        path: "/b",
        status: "missing",
        progress: { filesScanned: 5, modelsFound: 0 },
        lastError: "B unavailable",
      },
    ]);
    expect(result.current.models.map((model) => model.path)).toEqual(["/a/a.gguf"]);
    expect(result.current.scanning.scanning).toBe(false);
  });

  it("refreshes configured missing directories", async () => {
    vi.mocked(scanModelDirectory).mockResolvedValue({
      requestId: "placeholder",
      directory: "/missing",
      models: [],
      filesScanned: 0,
      modelsFound: 0,
    });
    const { result } = renderHook(() => useHarness([
      { path: "/missing", status: "missing", lastError: "offline" },
    ]));

    await act(async () => {
      await result.current.scanning.handleRefresh();
    });

    expect(vi.mocked(scanModelDirectory)).toHaveBeenCalledOnce();
    expect(vi.mocked(scanModelDirectory).mock.calls[0][0]).toBe("/missing");
  });

  it("does not let an active request resurrect a removed directory", async () => {
    const pending = deferred<Awaited<ReturnType<typeof scanModelDirectory>>>();
    vi.mocked(scanModelDirectory).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useHarness());

    let request!: Promise<void>;
    act(() => {
      request = result.current.scanning.scanDirectory("/models");
    });
    const requestId = vi.mocked(scanModelDirectory).mock.calls[0][1];
    act(() => result.current.scanning.handleRemoveDirectory("/models"));
    await act(async () => {
      pending.resolve({
        requestId,
        directory: "/models",
        models: [readyModel("late")],
        filesScanned: 1,
        modelsFound: 1,
      });
      await request;
    });

    expect(result.current.directories).toEqual([]);
    expect(result.current.models).toEqual([]);
  });
});
