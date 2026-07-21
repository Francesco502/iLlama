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

function useHarness() {
  const [directories, setDirectories] = useState<ModelDirectory[]>([]);
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
      newScan.resolve({ requestId: newRequestId, directory: "/models", models: [readyModel("new")] });
      await newRequest;
    });
    await act(async () => {
      oldScan.resolve({ requestId: oldRequestId, directory: "/models", models: [readyModel("old")] });
      await oldRequest;
    });

    expect(result.current.models.map((model) => model.fileName)).toEqual(["new.gguf"]);
    expect(result.current.selectedModelPath).toBe("/models/new.gguf");
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
      newScan.resolve({ requestId: newRequestId, directory: "/models", models: [readyModel("new")] });
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
});
