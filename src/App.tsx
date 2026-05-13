import { FileCog, Play, Cpu } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { computeContextLengthMismatch } from "./app/modelWorkspace";
import { AppLayout } from "./components/AppLayout";
import { ChatWorkspace } from "./components/chat/ChatWorkspace";
import { CommandPreview } from "./components/CommandPreview";
import { ModelDirectoryPicker } from "./components/ModelDirectoryPicker";
import { ModelList } from "./components/ModelList";
import { ParameterPanel } from "./components/ParameterPanel";
import { SamplingPanel } from "./components/SamplingPanel";
import {
  isTauriRuntime,
  findAvailablePort,
  resolveLlamaServerPath,
  type ChatHistorySettings,
} from "./api/tauri";
import { exportChatConversation } from "./api/chatHistory";
import { buildCommandPreview, getProfileById, validateLaunchConfig } from "./lib/parameterSchema";
import { demoModelDirectories, demoModels } from "./state/appStore";
import {
  buildSettingsSnapshot,
  defaultChatHistorySettings,
} from "./state/appState";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useDebouncedSettingsPersist } from "./hooks/useDebouncedSettingsPersist";
import { useLlamaProcess } from "./hooks/useLlamaProcess";
import { useModelDirectoryScanning } from "./hooks/useModelDirectoryScanning";
import { useAppLogs } from "./hooks/useAppLogs";
import { useChatGeneration } from "./hooks/useChatGeneration";
import { useChatWorkspace } from "./hooks/useChatWorkspace";
import {
  formatErrorBoundaryLog,
  subscribeToErrorBoundaryReports,
} from "./lib/errorBoundaryEvents";
import {
  emptyPrometheusHintsConfig,
  type LogEntry,
  type ModelDirectory,
  type ModelEntry,
  type ParameterProfile,
  type PrometheusHintsConfig,
  type RuntimeMetrics,
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
  const { logs, appendSystemLog, mergeLogs, clearLogs } = useAppLogs(sampleLogs);
  const [selectedModelPath, setSelectedModelPath] = useState<string | null>(() =>
    runningInTauri ? null : demoModels[0]?.path ?? null,
  );
  const [binaryPath, setBinaryPath] = useState<string | null>(null);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [profileId, setProfileId] = useState<ParameterProfile["id"]>("balanced");
  const [startupParameters, setStartupParameters] = useState(getProfileById("balanced").parameters);
  const [prometheusHints, setPrometheusHints] = useState<PrometheusHintsConfig>(emptyPrometheusHintsConfig);
  const [activeTab, setActiveTab] = useState<"config" | "chat">("config");
  const [modelSort, setModelSort] = useState<"name" | "size" | "date">("name");
  const [chatHistory, setChatHistory] = useState<ChatHistorySettings>(
    defaultChatHistorySettings,
  );

  const hasBootstrappedRef = useRef(!runningInTauri);

  const profile = getProfileById(profileId);
  const selectedModel = models.find((model) => model.path === selectedModelPath) ?? null;
  const [sampling, setSampling] = useState(profile.sampling);
  const contextLengthMismatch =
    selectedModel?.contextLength && selectedModel.contextLength > 0
      ? computeContextLengthMismatch(selectedModel.contextLength, startupParameters.ctxSize)
      : null;

  useEffect(() => {
    setSampling(getProfileById(profileId).sampling);
  }, [profileId]);

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
    searchHaystacks,
    createConversation,
    selectConversation,
    saveConversation,
    renameConversation,
    setPinned,
    setArchived,
    deleteConversation,
    deleteMessagePair,
    clearHistory,
    branchFromMessage,
  } = useChatWorkspace({
    historyEnabled: chatHistory.enabled,
    imagePersistence: chatHistory.imagePersistence,
    maxConversations: chatHistory.maxConversations,
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
    continueFromAssistantMessage,
    compressActiveConversation,
  } = useChatGeneration({
    port,
    sampling,
    contextSize: startupParameters.ctxSize,
    modelPath: selectedModel?.path ?? null,
    modelName: selectedModel?.fileName ?? null,
    activeConversation,
    saveConversation,
    appendSystemLog,
  });

  const handleChatHistoryChange = useCallback((next: ChatHistorySettings) => {
    setChatHistory(next);
  }, []);

  const handleClearHistory = useCallback(async () => {
    try {
      await clearHistory();
      appendSystemLog("已清空本地对话历史。");
    } catch (error) {
      appendSystemLog(error instanceof Error ? error.message : String(error));
    }
  }, [appendSystemLog, clearHistory]);

  const handleExportConversation = useCallback(
    async (format: "markdown" | "json", includeReasoning: boolean, conversationId?: string) => {
      const targetId = conversationId ?? activeConversation?.id;
      if (!targetId) {
        return;
      }
      if (!runningInTauri) {
        appendSystemLog("浏览器预览模式下不能导出对话；请在 Tauri 应用中使用。");
        return;
      }
      try {
        const path = await exportChatConversation(targetId, format, includeReasoning);
        appendSystemLog(`已导出对话：${path}`);
      } catch (error) {
        appendSystemLog(error instanceof Error ? error.message : String(error));
      }
    },
    [activeConversation, appendSystemLog, runningInTauri],
  );

  const commandPreview = useMemo(
    () =>
      buildCommandPreview({
        binaryPath,
        modelPath: selectedModel?.path ?? null,
        host: "127.0.0.1",
        port,
        parameters: startupParameters,
        prometheusHints,
      }),
    [binaryPath, port, prometheusHints, selectedModel?.path, startupParameters],
  );

  const launchValidation = useMemo(
    () =>
      validateLaunchConfig({
        binaryPath: runningInTauri ? binaryPath : "browser-preview",
        modelPath: selectedModel?.path ?? null,
        host: "127.0.0.1",
        port,
        parameters: startupParameters,
        prometheusHints,
      }),
    [binaryPath, port, prometheusHints, runningInTauri, selectedModel?.path, startupParameters],
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
        prometheusHints,
      }),
    [
      binaryPath,
      chatHistory,
      directories,
      port,
      profileId,
      prometheusHints,
      selectedModelPath,
      startupParameters,
    ],
  );

  const modelScan = useModelDirectoryScanning({
    runningInTauri,
    appendSystemLog,
    directories,
    setDirectories,
    models,
    setModels,
    selectedModelPath,
    setSelectedModelPath,
    setStartupParameters,
  });
  const { handleRefresh } = modelScan;

  useAppBootstrap({
    runningInTauri,
    appendSystemLog,
    hasBootstrappedRef,
    setBinaryPath,
    setPort,
    setChatHistory,
    setProfileId,
    setStartupParameters,
    setDirectories,
    setModels,
    setSelectedModelPath,
    setPrometheusHints,
    scanDirectories: modelScan.scanDirectories,
  });

  useDebouncedSettingsPersist(runningInTauri, hasBootstrappedRef, settingsSnapshot, appendSystemLog);

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

  useEffect(() => {
    return () => {
      stopHealthPoll();
    };
  }, [stopHealthPoll]);

  useEffect(() => {
    return subscribeToErrorBoundaryReports((report) => {
      appendSystemLog(formatErrorBoundaryLog(report));
    });
  }, [appendSystemLog]);

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
  }, [handleRefresh]);

  // --- Handlers ---
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
        prometheusHints,
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
      prometheusHints,
    });
    if (!preflightValidation.valid) {
      preflightValidation.errors.forEach(appendSystemLog);
      return;
    }

    let launchPort: number;
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
      host: "127.0.0.1" as const,
      port: launchPort,
      parameters: startupParameters,
      prometheusHints,
    };
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
              scanning={modelScan.scanning}
              onAddDirectory={modelScan.handleAddDirectory}
              onRemoveDirectory={modelScan.handleRemoveDirectory}
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
                {contextLengthMismatch?.kind === "warn" && (
                  <p className="model-context-warning">
                    当前 `ctxSize`（{startupParameters.ctxSize.toLocaleString("zh-CN")}）大于模型元数据
                    `contextLength`（{selectedModel?.contextLength?.toLocaleString("zh-CN")}），可能无效或浪费显存/内存。{" "}
                    <button
                      className="inline-button"
                      type="button"
                      onClick={() =>
                        setStartupParameters((current) => ({
                          ...current,
                          ctxSize: contextLengthMismatch.recommendedCtxSize,
                        }))
                      }
                    >
                      一键对齐到 {contextLengthMismatch.recommendedCtxSize.toLocaleString("zh-CN")}
                    </button>
                  </p>
                )}
                {contextLengthMismatch?.kind === "info" && (
                  <p className="model-context-info">
                    模型支持更长上下文（{selectedModel?.contextLength?.toLocaleString("zh-CN")}），你当前 `ctxSize` 为{" "}
                    {startupParameters.ctxSize.toLocaleString("zh-CN")}。
                  </p>
                )}
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
              prometheusHints={prometheusHints}
              onPrometheusHintsChange={setPrometheusHints}
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
            <SamplingPanel sampling={sampling} ctxSize={startupParameters.ctxSize} onSamplingChange={setSampling} />
            <CommandPreview args={commandPreview} />
          </div>
        }
        chatContent={
          <ChatWorkspace
            runtimeStatus={runtimeStatus}
            selectedModel={selectedModel}
            ctxSize={startupParameters.ctxSize}
            samplingMaxTokens={sampling.maxTokens}
            conversations={conversations}
            activeConversation={activeConversation}
            searchHaystacks={searchHaystacks}
            chatHistory={chatHistory}
            streaming={streaming}
            streamTokensPerSecond={streamTokensPerSecond}
            onCreateConversation={createConversation}
            onSelectConversation={selectConversation}
            onSaveConversation={saveConversation}
            onCompressNow={compressActiveConversation}
            onRenameConversation={renameConversation}
            onSetPinned={setPinned}
            onSetArchived={setArchived}
            onDeleteConversation={deleteConversation}
            onDeleteMessage={deleteMessagePair}
            onBranchFromMessage={branchFromMessage}
            onSend={sendMessage}
            onCancel={cancelGeneration}
            onRegenerate={regenerateFromMessage}
            onEditAndResend={editUserMessageAndResend}
            onContinueAssistant={continueFromAssistantMessage}
            onOpenSamplingTab={() => setActiveTab("config")}
            runtimeMetrics={displayedRuntimeMetrics}
            onChatHistoryChange={handleChatHistoryChange}
            onClearHistory={handleClearHistory}
            onExportConversation={handleExportConversation}
            onApplySuggestedMaxTokens={(value) =>
              setSampling((current) => ({ ...current, maxTokens: Math.max(64, value) }))
            }
          />
        }
        logs={logs}
        runtimeStatus={runtimeStatus}
        runtimeMetrics={displayedRuntimeMetrics}
        onStop={handleStop}
        onClearLogs={clearLogs}
      />
    </div>
  );
}
