import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { scanModelDirectory } from "../api/tauri";
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

  const scanDirectories = useCallback(
    async (paths: string[], preferredModelPath: string | null) => {
      setScanning(true);
      setDirectories(paths.map((path) => ({ path, status: "scanning" })));
      const allModels: ModelEntry[] = [];
      const nextDirectories: ModelDirectory[] = [];

      for (const path of paths) {
        appendSystemLog(`开始扫描：${path}`);
        try {
          const scanned = await scanModelDirectory(path);
          allModels.push(...scanned);
          nextDirectories.push({ path, status: "ready" });
          appendSystemLog(`扫描完成：${path}，发现 ${scanned.length} 个 GGUF 模型。`);
        } catch (error) {
          nextDirectories.push({ path, status: "missing" });
          appendSystemLog(error instanceof Error ? error.message : String(error));
        }
      }

      setDirectories(nextDirectories);
      setModels(allModels);
      setSelectedModelPath(pickSelectedModelPath(allModels, preferredModelPath));
      setStartupParameters((current) => ({ ...current, mmprojPath: null }));
      setScanning(false);
    },
    [appendSystemLog, setDirectories, setModels, setSelectedModelPath, setStartupParameters],
  );

  const scanDirectory = useCallback(
    async (path: string) => {
      setScanning(true);
      setDirectories((current) => upsertDirectory(current, { path, status: "scanning" }));
      appendSystemLog(`开始扫描：${path}`);
      try {
        const scanned = await scanModelDirectory(path);
        setModels((current) => {
          const merged = mergeScannedModels(current, path, scanned);
          setSelectedModelPath((currentSelected) => pickSelectedModelPath(merged, currentSelected));
          return merged;
        });
        setStartupParameters((current) => ({ ...current, mmprojPath: null }));
        setDirectories((current) => upsertDirectory(current, { path, status: "ready" }));
        appendSystemLog(`扫描完成，发现 ${scanned.length} 个 GGUF 模型。`);
      } catch (error) {
        setDirectories((current) => upsertDirectory(current, { path, status: "missing" }));
        appendSystemLog(error instanceof Error ? error.message : String(error));
      } finally {
        setScanning(false);
      }
    },
    [appendSystemLog, setDirectories, setModels, setSelectedModelPath, setStartupParameters],
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
