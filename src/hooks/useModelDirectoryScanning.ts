import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { scanModelDirectory, type ModelScanProgress } from "../api/tauri";
import { demoModels } from "../state/appStore";
import { mergeScannedModels, pickSelectedModelPath, removeDirectoryModels } from "../state/appState";
import type { ModelDirectory, ModelEntry, StartupParameters } from "../types/domain";
import { upsertDirectory } from "../app/modelWorkspace";

export interface UseModelDirectoryScanningOptions {
  runningInTauri: boolean;
  appendSystemLog: (message: string) => void;
  directories: ModelDirectory[];
  setDirectories: Dispatch<SetStateAction<ModelDirectory[]>>;
  models: ModelEntry[];
  setModels: Dispatch<SetStateAction<ModelEntry[]>>;
  selectedModelPath: string | null;
  setSelectedModelPath: Dispatch<SetStateAction<string | null>>;
  setStartupParameters: Dispatch<SetStateAction<StartupParameters>>;
}

export interface UseModelDirectoryScanningResult {
  scanning: boolean;
  handleAddDirectory: () => Promise<void>;
  handleRemoveDirectory: (path: string) => void;
  handleRefresh: () => Promise<void>;
  scanDirectories: (paths: string[], preferredModelPath: string | null) => Promise<void>;
  scanDirectory: (path: string) => Promise<void>;
}

export function useModelDirectoryScanning({
  runningInTauri,
  appendSystemLog,
  directories,
  setDirectories,
  models,
  setModels,
  selectedModelPath,
  setSelectedModelPath,
  setStartupParameters,
}: UseModelDirectoryScanningOptions): UseModelDirectoryScanningResult {
  const [scanning, setScanning] = useState(false);
  const generationRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const activeRequestIdsRef = useRef(new Map<string, string>());

  const beginGeneration = useCallback(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeRequestIdsRef.current.clear();
    setScanning(true);
    return generation;
  }, []);

  const beginDirectoryRequest = useCallback((generation: number, path: string) => {
    const requestId = `model-scan-${generation}-${requestSequenceRef.current + 1}`;
    requestSequenceRef.current += 1;
    activeRequestIdsRef.current.set(path, requestId);
    return requestId;
  }, []);

  const isCurrentRequest = useCallback((generation: number, path: string, requestId: string) => (
    generationRef.current === generation && activeRequestIdsRef.current.get(path) === requestId
  ), []);

  const applyProgress = useCallback(
    (generation: number, path: string, requestId: string, progress: ModelScanProgress) => {
      if (
        progress.requestId !== requestId ||
        progress.directory !== path ||
        !isCurrentRequest(generation, path, requestId)
      ) {
        return;
      }
      setDirectories((current) => upsertDirectory(current, {
        path,
        status: "scanning",
        progress: {
          filesScanned: progress.filesScanned,
          modelsFound: progress.modelsFound,
        },
      }));
    },
    [isCurrentRequest, setDirectories],
  );

  const scanDirectories = useCallback(
    async (paths: string[], preferredModelPath: string | null) => {
      const generation = beginGeneration();
      setDirectories(paths.map((path) => ({
        path,
        status: "scanning",
        progress: { filesScanned: 0, modelsFound: 0 },
      })));
      const allModels: ModelEntry[] = [];
      const nextDirectories: ModelDirectory[] = [];

      for (const path of paths) {
        const requestId = beginDirectoryRequest(generation, path);
        appendSystemLog(`开始扫描：${path}`);
        try {
          const result = await scanModelDirectory(path, requestId, (progress) => {
            applyProgress(generation, path, requestId, progress);
          });
          if (!isCurrentRequest(generation, path, requestId) || result.requestId !== requestId) return;
          allModels.push(...result.models);
          nextDirectories.push({
            path,
            status: "ready",
            progress: { filesScanned: result.models.length, modelsFound: result.models.length },
          });
          appendSystemLog(`扫描完成：${path}，发现 ${result.models.length} 个 GGUF 模型。`);
        } catch (error) {
          if (!isCurrentRequest(generation, path, requestId)) return;
          const message = error instanceof Error ? error.message : String(error);
          nextDirectories.push({ path, status: "missing", lastError: message });
          appendSystemLog(message);
        }
      }

      if (generationRef.current !== generation) return;
      setDirectories(nextDirectories);
      setModels(allModels);
      setSelectedModelPath(pickSelectedModelPath(allModels, preferredModelPath));
      setStartupParameters((current) => ({ ...current, mmprojPath: null }));
      setScanning(false);
    },
    [
      appendSystemLog,
      applyProgress,
      beginDirectoryRequest,
      beginGeneration,
      isCurrentRequest,
      setDirectories,
      setModels,
      setSelectedModelPath,
      setStartupParameters,
    ],
  );

  const scanDirectory = useCallback(
    async (path: string) => {
      const generation = beginGeneration();
      const requestId = beginDirectoryRequest(generation, path);
      setDirectories((current) => upsertDirectory(current, {
        path,
        status: "scanning",
        progress: { filesScanned: 0, modelsFound: 0 },
      }));
      appendSystemLog(`开始扫描：${path}`);
      try {
        const result = await scanModelDirectory(path, requestId, (progress) => {
          applyProgress(generation, path, requestId, progress);
        });
        if (!isCurrentRequest(generation, path, requestId) || result.requestId !== requestId) return;
        setModels((current) => {
          const merged = mergeScannedModels(current, path, result.models);
          setSelectedModelPath((currentSelected) => pickSelectedModelPath(merged, currentSelected));
          return merged;
        });
        setStartupParameters((current) => ({ ...current, mmprojPath: null }));
        setDirectories((current) => upsertDirectory(current, {
          path,
          status: "ready",
          progress: { filesScanned: result.models.length, modelsFound: result.models.length },
        }));
        appendSystemLog(`扫描完成，发现 ${result.models.length} 个 GGUF 模型。`);
      } catch (error) {
        if (!isCurrentRequest(generation, path, requestId)) return;
        const message = error instanceof Error ? error.message : String(error);
        setDirectories((current) => upsertDirectory(current, {
          path,
          status: "missing",
          lastError: message,
        }));
        appendSystemLog(message);
      } finally {
        if (isCurrentRequest(generation, path, requestId)) setScanning(false);
      }
    },
    [
      appendSystemLog,
      applyProgress,
      beginDirectoryRequest,
      beginGeneration,
      isCurrentRequest,
      setDirectories,
      setModels,
      setSelectedModelPath,
      setStartupParameters,
    ],
  );

  const handleAddDirectory = useCallback(async () => {
    if (!runningInTauri) {
      appendSystemLog("浏览器预览模式下使用演示模型；在 Tauri 应用中会打开原生目录选择。");
      return;
    }
    const selected = await open({ title: "选择 GGUF 模型目录", directory: true, multiple: false });
    if (typeof selected !== "string") return;
    await scanDirectory(selected);
  }, [appendSystemLog, runningInTauri, scanDirectory]);

  const handleRemoveDirectory = useCallback(
    (path: string) => {
      const nextModels = removeDirectoryModels(models, path);
      setDirectories((current) => current.filter((d) => d.path !== path));
      setModels(nextModels);
      setSelectedModelPath((current) => pickSelectedModelPath(nextModels, current));
      appendSystemLog(`已移除目录：${path}`);
    },
    [appendSystemLog, models, setDirectories, setModels, setSelectedModelPath],
  );

  const handleRefresh = useCallback(async () => {
    const firstReadyDirectory = directories.find((d) => d.status === "ready");
    if (!firstReadyDirectory) {
      appendSystemLog("请先选择模型目录。");
      return;
    }
    if (!runningInTauri) {
      appendSystemLog("浏览器预览模式下刷新演示模型列表。");
      setModels(demoModels);
      return;
    }
    await scanDirectories(
      directories.filter((d) => d.status === "ready").map((d) => d.path),
      selectedModelPath,
    );
  }, [appendSystemLog, directories, runningInTauri, scanDirectories, selectedModelPath, setModels]);

  return {
    scanning,
    handleAddDirectory,
    handleRemoveDirectory,
    handleRefresh,
    scanDirectories,
    scanDirectory,
  };
}
