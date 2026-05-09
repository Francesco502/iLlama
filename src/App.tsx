import { FileCog, Play, Cpu } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AppLayout } from "./components/AppLayout";
import { ChatWorkspace } from "./components/chat/ChatWorkspace";
import { CommandPreview } from "./components/CommandPreview";
import { ModelDirectoryPicker } from "./components/ModelDirectoryPicker";
import { ModelList } from "./components/ModelList";
import { ParameterPanel } from "./components/ParameterPanel";
import {
  isTauriRuntime,
  findAvailablePort,
  loadSettings,
  resolveLlamaServerPath,
  saveSettings,
  scanModelDirectory,
  type AppSettings,
  type ChatHistorySettings,
} from "./api/tauri";
import { buildCommandPreview, getProfileById, validateLaunchConfig } from "./lib/parameterSchema";
import { demoModelDirectories, demoModels } from "./state/appStore";
import {
  buildSettingsSnapshot,
  defaultChatHistorySettings,
  mergeScannedModels,
  pickSelectedModelPath,
  removeDirectoryModels,
} from "./state/appState";
import { useLlamaProcess } from "./hooks/useLlamaProcess";
import { useChatGeneration } from "./hooks/useChatGeneration";
import { useChatWorkspace } from "./hooks/useChatWorkspace";
import type {
  LogEntry,
  ModelDirectory,
  ModelEntry,
  ParameterProfile,
  RuntimeMetrics,
} from "./types/domain";

const DEFAULT_PORT = 8080;

const sampleLogs: LogEntry[] = [
  {
    id: "1",
    timestamp: "09:16:03",
    stream: "system",
    message: "等待选择模型并启动 llama-server",
  },
];

export function App() {
  const runningInTauri = isTauriRuntime();
  const [directories, setDirectories] = useState<ModelDirectory[]>(() =>
    runningInTauri ? [] : demoModelDirectories,
  );
  const [models, setModels] = useState<ModelEntry[]>(() => (runningInTauri ? [] : demoModels));
  const [logs, setLogs] = useState<LogEntry[]>(sampleLogs);
  const [scanning, setScanning] = useState(false);
  const [selectedModelPath, setSelectedModelPath] = useState<string | null>(() =>
    runningInTauri ? null : demoModels[0]?.path ?? null,
  );
  const [binaryPath, setBinaryPath] = useState<string | null>(null);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [profileId, setProfileId] = useState<ParameterProfile["id"]>("balanced");
  const [startupParameters, setStartupParameters] = useState(getProfileById("balanced").parameters);
  const [activeTab, setActiveTab] = useState<"config" | "chat">("config");
  const [modelSort, setModelSort] = useState<"name" | "size" | "date">("name");
  const [chatHistory, setChatHistory] = useState<ChatHistorySettings>(
    defaultChatHistorySettings,
  );

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasBootstrappedRef = useRef(!runningInTauri);

  const profile = getProfileById(profileId);
  const selectedModel = models.find((model) => model.path === selectedModelPath) ?? null;

  // --- Logging helpers ---
  const appendSystemLog = useCallback((message: string) => {
    const timestamp = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
    setLogs((current) =>
      [
        ...current,
        {
          id: crypto.randomUUID(),
          timestamp,
          stream: "system" as const,
          message,
        },
      ].slice(-80),
    );
  }, []);

  const mergeLogs = useCallback((incoming: LogEntry[]) => {
    setLogs((current) => {
      const byId = new Map<string, LogEntry>();
      for (const log of current) byId.set(log.id, log);
      for (const log of incoming) byId.set(log.id, log);
      return Array.from(byId.values()).slice(-120);
    });
  }, []);

  // --- Custom hooks ---
  const {
    runtimeStatus,
    runtimeMetrics,
    handleStart: startProcess,
    handleStop,
    stopHealthPoll,
  } = useLlamaProcess({
    appendSystemLog,
    mergeLogs,
    onHealthy: () => setActiveTab("chat"),
  });

  const {
    conversations,
    activeConversation,
    createConversation,
    selectConversation,
    saveConversation,
    renameConversation,
    deleteConversation,
    branchFromMessage,
  } = useChatWorkspace({
    historyEnabled: chatHistory.enabled,
    modelPath: selectedModel?.path ?? null,
    modelName: selectedModel?.fileName ?? null,
  });

  const {
    streaming,
    streamTokensPerSecond,
    sendMessage,
    cancelGeneration,
    regenerateFromMessage,
    editUserMessageAndResend,
  } = useChatGeneration({
    port,
    sampling: profile.sampling,
    contextSize: startupParameters.ctxSize,
    modelPath: selectedModel?.path ?? null,
    modelName: selectedModel?.fileName ?? null,
    activeConversation,
    saveConversation,
    appendSystemLog,
  });

  const commandPreview = useMemo(
    () =>
      buildCommandPreview({
        binaryPath,
        modelPath: selectedModel?.path ?? null,
        host: "127.0.0.1",
        port,
        parameters: startupParameters,
      }),
    [binaryPath, port, selectedModel?.path, startupParameters],
  );

  const launchValidation = useMemo(
    () =>
      validateLaunchConfig({
        binaryPath: runningInTauri ? binaryPath : "browser-preview",
        modelPath: selectedModel?.path ?? null,
        host: "127.0.0.1",
        port,
        parameters: startupParameters,
      }),
    [binaryPath, port, runningInTauri, selectedModel?.path, startupParameters],
  );

  const settingsSnapshot = useMemo(
    () =>
      buildSettingsSnapshot({
        directories,
        binaryPath,
        profileId,
        selectedModelPath,
        port,
        startupParameters,
        chatHistory,
      }),
    [binaryPath, chatHistory, directories, port, profileId, selectedModelPath, startupParameters],
  );

  const displayedRuntimeMetrics = useMemo<RuntimeMetrics>(
    () => ({
      ...runtimeMetrics,
      tokensPerSecond: runtimeMetrics.tokensPerSecond ?? streamTokensPerSecond,
    }),
    [runtimeMetrics, streamTokensPerSecond],
  );

  const sortedModels = useMemo(() => {
    const sorted = [...models];
    switch (modelSort) {
      case "size":
        sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
        break;
      case "date":
        sorted.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
        break;
      default:
        sorted.sort((a, b) => a.fileName.localeCompare(b.fileName));
    }
    return sorted;
  }, [models, modelSort]);

  // --- Debounced auto-persist settings ---
  const debouncedPersist = useCallback((snapshot: AppSettings) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void saveSettings(snapshot).catch((error) => {
        appendSystemLog(error instanceof Error ? error.message : String(error));
      });
    }, 1500);
  }, [appendSystemLog]);

  useEffect(() => {
    if (!runningInTauri || !hasBootstrappedRef.current) return;
    debouncedPersist(settingsSnapshot);
  }, [debouncedPersist, runningInTauri, settingsSnapshot]);

  // --- Bootstrap ---
  useEffect(() => {
    if (!runningInTauri) return;
    let cancelled = false;
    async function bootstrap() {
      try {
        const settings = await loadSettings();
        if (cancelled) return;
        const resolvedBinary = await resolveLlamaServerPath(settings.llamaServerPath);
        if (cancelled) return;
        setBinaryPath(resolvedBinary ?? settings.llamaServerPath);
        setPort(settings.defaultPort || DEFAULT_PORT);
        setChatHistory(settings.chatHistory ?? defaultChatHistorySettings);
        const loadedProfileId = (settings.defaultPresetId as ParameterProfile["id"]) || "balanced";
        setProfileId(loadedProfileId);
        setStartupParameters({
          ...getProfileById(loadedProfileId).parameters,
          idleSleepSeconds: settings.idleSleepSeconds,
        });

        if (settings.modelDirectories.length > 0) {
          await scanDirectories(settings.modelDirectories, settings.lastSelectedModelPath);
        } else {
          setDirectories([]);
          setModels([]);
          setSelectedModelPath(null);
          appendSystemLog("请选择模型目录以扫描 GGUF 模型。");
        }
      } catch (error) {
        appendSystemLog(error instanceof Error ? error.message : String(error));
      } finally {
        hasBootstrappedRef.current = true;
      }
    }
    void bootstrap();
    return () => { cancelled = true; };
  }, [appendSystemLog, runningInTauri]);

  // --- Cleanup ---
  useEffect(() => {
    return () => {
      stopHealthPoll();
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [stopHealthPoll]);

  // --- #23: Keyboard shortcuts ---
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      if (meta && event.key === "r" && !event.shiftKey) {
        event.preventDefault();
        void handleRefresh();
      }
      if (event.key === "Escape") {
        // Could be used for closing log panel — handled inside AppLayout
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [directories]);

  // --- Handlers ---
  async function handleAddDirectory() {
    if (!runningInTauri) {
      appendSystemLog("浏览器预览模式下使用演示模型；在 Tauri 应用中会打开原生目录选择。");
      return;
    }
    const selected = await open({ title: "选择 GGUF 模型目录", directory: true, multiple: false });
    if (typeof selected !== "string") return;
    await scanDirectory(selected);
  }

  function handleRemoveDirectory(path: string) {
    const nextModels = removeDirectoryModels(models, path);
    setDirectories((current) => current.filter((d) => d.path !== path));
    setModels(nextModels);
    setSelectedModelPath((current) => pickSelectedModelPath(nextModels, current));
    appendSystemLog(`已移除目录：${path}`);
  }

  async function handleSelectBinary() {
    if (!runningInTauri) {
      appendSystemLog("浏览器预览模式下不能选择 llama-server；请在 Tauri 应用中使用。");
      return;
    }
    const selected = await open({ title: "选择 llama-server 可执行文件", directory: false, multiple: false });
    if (typeof selected !== "string") return;
    setBinaryPath(selected);
    appendSystemLog(`已选择 llama-server：${selected}`);
  }

  async function handleSelectMmproj() {
    if (!runningInTauri) {
      appendSystemLog("浏览器预览模式下不能选择 mmproj；请在 Tauri 应用中使用。");
      return;
    }
    const selected = await open({
      title: "选择多模态 projector (.gguf)",
      directory: false,
      multiple: false,
      filters: [{ name: "GGUF", extensions: ["gguf"] }],
    });
    if (typeof selected !== "string") return;
    setStartupParameters((current) => ({ ...current, mmprojPath: selected }));
    appendSystemLog(`已选择 mmproj：${selected}`);
  }

  async function handleRefresh() {
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
    await scanDirectories(directories.filter((d) => d.status === "ready").map((d) => d.path), selectedModelPath);
  }

  async function scanDirectories(paths: string[], preferredModelPath: string | null) {
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
  }

  async function scanDirectory(path: string) {
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
  }

  async function handleStart() {
    if (!selectedModel) {
      appendSystemLog("请先选择 GGUF 模型。");
      return;
    }

    if (!runningInTauri) {
      await startProcess({
        binaryPath,
        modelPath: selectedModel.path,
        host: "127.0.0.1",
        port,
        parameters: startupParameters,
      });
      return;
    }

    const resolvedBinary = await resolveLlamaServerPath(binaryPath);
    if (!resolvedBinary) {
      appendSystemLog("请先选择 llama-server 可执行文件。");
      await handleSelectBinary();
      return;
    }
    if (resolvedBinary !== binaryPath) {
      setBinaryPath(resolvedBinary);
      appendSystemLog(`已解析 llama-server：${resolvedBinary}`);
    }

    const preflightValidation = validateLaunchConfig({
      binaryPath: resolvedBinary,
      modelPath: selectedModel.path,
      host: "127.0.0.1",
      port,
      parameters: startupParameters,
    });
    if (!preflightValidation.valid) {
      preflightValidation.errors.forEach(appendSystemLog);
      return;
    }

    let launchPort = port;
    try {
      launchPort = await findAvailablePort("127.0.0.1", port);
      if (launchPort !== port) {
        setPort(launchPort);
        appendSystemLog(`端口 ${port} 已占用，自动改用 ${launchPort}。`);
      }
    } catch (error) {
      appendSystemLog(error instanceof Error ? error.message : String(error));
      return;
    }

    const launchConfig = {
      binaryPath: resolvedBinary,
      modelPath: selectedModel.path,
      host: "127.0.0.1",
      port: launchPort,
      parameters: startupParameters,
    } as const;
    const validation = validateLaunchConfig(launchConfig);
    if (!validation.valid) {
      validation.errors.forEach(appendSystemLog);
      return;
    }
    validation.warnings.forEach(appendSystemLog);

    await startProcess(launchConfig);
  }

  function handleSelectModel(path: string) {
    const nextModel = models.find((model) => model.path === path) ?? null;
    setSelectedModelPath(path);
    setStartupParameters((current) => {
      if (!current.mmprojPath || nextModel?.mmprojCandidates.includes(current.mmprojPath)) return current;
      return { ...current, mmprojPath: null };
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="traffic-lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="title-block">
          <Cpu size={16} />
          <h1>iLlama</h1>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button" onClick={handleSelectBinary}>
            <FileCog size={14} />
            {binaryPath ? "llama-server ✓" : "选择 llama-server"}
          </button>
          <button
            className="start-button"
            type="button"
            disabled={runtimeStatus === "starting" || runtimeStatus === "healthy"}
            onClick={handleStart}
          >
            <Play size={13} />
            启动
          </button>
        </div>
      </header>

      <AppLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        sidebar={
          <>
            <ModelDirectoryPicker
              directories={directories}
              scanning={scanning}
              onAddDirectory={handleAddDirectory}
              onRemoveDirectory={handleRemoveDirectory}
              onRefresh={handleRefresh}
            />
            <ModelList
              models={sortedModels}
              selectedPath={selectedModelPath}
              sort={modelSort}
              onSortChange={setModelSort}
              onSelect={handleSelectModel}
            />
          </>
        }
        configContent={
          <div className="config-view">
            <section className="model-summary panel">
              <div>
                <span className="eyebrow">已选择模型</span>
                <h2>{selectedModel?.fileName ?? "未选择模型"}</h2>
                <p>
                  {selectedModel?.architecture ?? "unknown"} ·{" "}
                  {selectedModel?.quantization ?? "GGUF"} · 上下文{" "}
                  {selectedModel?.contextLength?.toLocaleString("zh-CN") ?? "--"}
                </p>
              </div>
              <div className="health-chip">本地 only</div>
            </section>
            <ParameterPanel
              profile={profile}
              parameters={startupParameters}
              port={port}
              onPortChange={setPort}
              mmprojCandidates={selectedModel?.mmprojCandidates ?? []}
              onSelectMmproj={handleSelectMmproj}
              validation={launchValidation}
              onParametersChange={setStartupParameters}
              onProfileChange={(id) => {
                setProfileId(id);
                const nextParameters = getProfileById(id).parameters;
                setStartupParameters({
                  ...nextParameters,
                  mmprojPath: startupParameters.mmprojPath,
                  mmprojOffload: startupParameters.mmprojOffload,
                });
              }}
            />
            <CommandPreview args={commandPreview} />
          </div>
        }
        chatContent={
          <ChatWorkspace
            runtimeStatus={runtimeStatus}
            selectedModel={selectedModel}
            conversations={conversations}
            activeConversation={activeConversation}
            streaming={streaming}
            streamTokensPerSecond={streamTokensPerSecond}
            onCreateConversation={createConversation}
            onSelectConversation={selectConversation}
            onSaveConversation={saveConversation}
            onRenameConversation={renameConversation}
            onDeleteConversation={deleteConversation}
            onBranchFromMessage={branchFromMessage}
            onSend={sendMessage}
            onCancel={cancelGeneration}
            onRegenerate={regenerateFromMessage}
            onEditAndResend={editUserMessageAndResend}
          />
        }
        logs={logs}
        runtimeStatus={runtimeStatus}
        runtimeMetrics={displayedRuntimeMetrics}
        onStop={handleStop}
      />
    </div>
  );
}

function upsertDirectory(directories: ModelDirectory[], next: ModelDirectory): ModelDirectory[] {
  const exists = directories.some((d) => d.path === next.path);
  if (!exists) return [...directories, next];
  return directories.map((d) => (d.path === next.path ? next : d));
}
