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
  setModels,
  selectedModelPath,
  setSelectedModelPath,
}: UseModelDirectoryScanningOptions): UseModelDirectoryScanningResult {
  const [scanning, setScanning] = useState(false);
  const requestSequenceRef = useRef(0);
  const activeRequestIdsRef = useRef(new Map<string, string>());
  const activeOperationCountRef = useRef(0);

  const beginDirectoryRequest = useCallback((path: string) => {
    const requestId = `model-scan-${requestSequenceRef.current + 1}`;
    requestSequenceRef.current += 1;
    activeRequestIdsRef.current.set(path, requestId);
    activeOperationCountRef.current += 1;
    setScanning(true);
    return requestId;
  }, []);

  const finishDirectoryRequest = useCallback((path: string, requestId: string) => {
    if (activeRequestIdsRef.current.get(path) === requestId) {
      activeRequestIdsRef.current.delete(path);
    }
    activeOperationCountRef.current = Math.max(0, activeOperationCountRef.current - 1);
    setScanning(activeOperationCountRef.current > 0);
  }, []);

  const isCurrentRequest = useCallback((path: string, requestId: string) => (
    activeRequestIdsRef.current.get(path) === requestId
  ), []);

  const applyProgress = useCallback(
    (path: string, requestId: string, progress: ModelScanProgress) => {
      if (
        progress.requestId !== requestId ||
        progress.directory !== path ||
        !isCurrentRequest(path, requestId)
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

  const markDirectoryMissing = useCallback((path: string, message: string) => {
    setDirectories((current) => {
      const progress = current.find((directory) => directory.path === path)?.progress;
      return upsertDirectory(current, {
        path,
        status: "missing",
        ...(progress ? { progress } : {}),
        lastError: message,
      });
    });
  }, [setDirectories]);

  const scanDirectories = useCallback(
    async (paths: string[], preferredModelPath: string | null) => {
      const uniquePaths = [...new Set(paths)];
      const requestIds = new Map(
        uniquePaths.map((path) => [path, beginDirectoryRequest(path)]),
      );
      setDirectories((current) => uniquePaths.reduce(
        (next, path) => upsertDirectory(next, {
          path,
          status: "scanning",
          progress: { filesScanned: 0, modelsFound: 0 },
        }),
        current,
      ));
      setModels((current) => {
        const next = uniquePaths.reduce(
          (remaining, path) => removeDirectoryModels(remaining, path),
          current,
        );
        setSelectedModelPath((selected) => pickSelectedModelPath(next, preferredModelPath ?? selected));
        return next;
      });

      for (const path of uniquePaths) {
        const requestId = requestIds.get(path)!;
        if (!isCurrentRequest(path, requestId)) {
          finishDirectoryRequest(path, requestId);
          continue;
        }
        appendSystemLog(`开始扫描：${path}`);
        try {
          const result = await scanModelDirectory(path, requestId, (progress) => {
            applyProgress(path, requestId, progress);
          });
          if (
            isCurrentRequest(path, requestId) &&
            result.requestId === requestId &&
            result.directory === path
          ) {
            setModels((current) => {
              const merged = mergeScannedModels(current, path, result.models);
              setSelectedModelPath((selected) => (
                pickSelectedModelPath(merged, preferredModelPath ?? selected)
              ));
              return merged;
            });
            setDirectories((current) => upsertDirectory(current, {
              path,
              status: "ready",
              progress: {
                filesScanned: result.filesScanned,
                modelsFound: result.modelsFound,
              },
            }));
            appendSystemLog(`扫描完成：${path}，发现 ${result.modelsFound} 个 GGUF 模型。`);
          }
        } catch (error) {
          if (isCurrentRequest(path, requestId)) {
            const message = error instanceof Error ? error.message : String(error);
            markDirectoryMissing(path, message);
            appendSystemLog(message);
          }
        } finally {
          finishDirectoryRequest(path, requestId);
        }
      }
    },
    [
      appendSystemLog,
      applyProgress,
      beginDirectoryRequest,
      finishDirectoryRequest,
      isCurrentRequest,
      markDirectoryMissing,
      setDirectories,
      setModels,
      setSelectedModelPath,
    ],
  );

  const scanDirectory = useCallback(
    async (path: string) => {
      const requestId = beginDirectoryRequest(path);
      setDirectories((current) => upsertDirectory(current, {
        path,
        status: "scanning",
        progress: { filesScanned: 0, modelsFound: 0 },
      }));
      appendSystemLog(`开始扫描：${path}`);
      try {
        const result = await scanModelDirectory(path, requestId, (progress) => {
          applyProgress(path, requestId, progress);
        });
        if (
          !isCurrentRequest(path, requestId) ||
          result.requestId !== requestId ||
          result.directory !== path
        ) return;
        setModels((current) => {
          const merged = mergeScannedModels(current, path, result.models);
          setSelectedModelPath((currentSelected) => pickSelectedModelPath(merged, currentSelected));
          return merged;
        });
        setDirectories((current) => upsertDirectory(current, {
          path,
          status: "ready",
          progress: {
            filesScanned: result.filesScanned,
            modelsFound: result.modelsFound,
          },
        }));
        appendSystemLog(`扫描完成，发现 ${result.modelsFound} 个 GGUF 模型。`);
      } catch (error) {
        if (!isCurrentRequest(path, requestId)) return;
        const message = error instanceof Error ? error.message : String(error);
        markDirectoryMissing(path, message);
        appendSystemLog(message);
      } finally {
        finishDirectoryRequest(path, requestId);
      }
    },
    [
      appendSystemLog,
      applyProgress,
      beginDirectoryRequest,
      finishDirectoryRequest,
      isCurrentRequest,
      markDirectoryMissing,
      setDirectories,
      setModels,
      setSelectedModelPath,
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
      activeRequestIdsRef.current.delete(path);
      setDirectories((current) => current.filter((d) => d.path !== path));
      setModels((current) => {
        const nextModels = removeDirectoryModels(current, path);
        setSelectedModelPath((selected) => pickSelectedModelPath(nextModels, selected));
        return nextModels;
      });
      appendSystemLog(`已移除目录：${path}`);
    },
    [appendSystemLog, setDirectories, setModels, setSelectedModelPath],
  );

  const handleRefresh = useCallback(async () => {
    if (directories.length === 0) {
      appendSystemLog("请先选择模型目录。");
      return;
    }
    if (!runningInTauri) {
      appendSystemLog("浏览器预览模式下刷新演示模型列表。");
      setModels(demoModels);
      return;
    }
    await scanDirectories(
      directories.map((d) => d.path),
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
