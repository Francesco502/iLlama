import { FileCog, Play, Cpu, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { computeContextLengthMismatch } from "./app/modelWorkspace";
import { AppLayout, type AppTab } from "./components/AppLayout";
import { CommandPreview } from "./components/CommandPreview";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { ModelDirectoryPicker } from "./components/ModelDirectoryPicker";
import { ModelList } from "./components/ModelList";
import { ParameterPanel } from "./components/ParameterPanel";
import { RuntimeStatusCard } from "./components/RuntimeStatusCard";
import { RuntimeSmokeChat } from "./components/RuntimeSmokeChat";
import { SamplingPanel } from "./components/SamplingPanel";
import {
  isTauriRuntime,
  findAvailablePort,
  resolveLlamaServerPath,
  getTrayEnabled,
  setTrayEnabled,
} from "./api/tauri";
import { exportLegacyChatHistory } from "./api/legacyChatExport";
import {
  buildMaxCapabilitySampling,
  buildMaxCapabilityStartupParameters,
  getProfileById,
  resolveModelContextLimit,
  validateLaunchConfig,
} from "./lib/parameterSchema";
import {
  applyParameterPresetSource,
  MODEL_FAMILY_AUTO_PRESET_SOURCE_ID,
  parameterPresetSources,
  type ParameterPresetSourceId,
} from "./lib/parameterPresets";
import { buildRuntimeConnection } from "./lib/externalClients";
import { getLaunchDraftChanges } from "./lib/launchDraft";
import { demoModelDirectories, demoModels } from "./state/appStore";
import {
  buildSettingsSnapshot,
  getModelLaunchAssessment,
  reconcileMmprojPathForModel,
  resolveLaunchPort,
} from "./state/appState";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useDebouncedSettingsPersist } from "./hooks/useDebouncedSettingsPersist";
import { useLlamaProcess } from "./hooks/useLlamaProcess";
import { useCommandPreview } from "./hooks/useCommandPreview";
import { useExclusiveAsyncAction } from "./hooks/useExclusiveAsyncAction";
import { useModelDirectoryScanning } from "./hooks/useModelDirectoryScanning";
import { useAppLogs } from "./hooks/useAppLogs";
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
} from "./types/domain";
import type { AppSettings } from "./api/tauri";

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
  const [autoPort, setAutoPort] = useState(true);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [profileId, setProfileId] = useState<ParameterProfile["id"]>("max-capability");
  const [parameterPresetSourceId, setParameterPresetSourceId] = useState<ParameterPresetSourceId>(
    MODEL_FAMILY_AUTO_PRESET_SOURCE_ID,
  );
  const [startupParameters, setStartupParameters] = useState(getProfileById("max-capability").parameters);
  const [prometheusHints, setPrometheusHints] = useState<PrometheusHintsConfig>(emptyPrometheusHintsConfig);
  const [activeTab, setActiveTab] = useState<AppTab>("run");
  const [modelSort, setModelSort] = useState<"name" | "size" | "date">("name");
  const [modelSearch, setModelSearch] = useState("");
  const [uiSettings, setUiSettings] = useState<AppSettings["ui"]>({
    showInMenuBar: false,
    logPanelOpen: false,
    logPanelHeight: 180,
    advancedOpen: false,
  });

  const hasBootstrappedRef = useRef(!runningInTauri);

  const profile = getProfileById(profileId);
  const selectedModel = models.find((model) => model.path === selectedModelPath) ?? null;
  const modelLaunchAssessment = getModelLaunchAssessment(selectedModel);
  const [sampling, setSampling] = useState(profile.sampling);
  const appliedParameterPreset = useMemo(
    () => applyParameterPresetSource(parameterPresetSourceId, selectedModel, startupParameters, sampling),
    [
      parameterPresetSourceId,
      sampling,
      selectedModel,
      startupParameters,
    ],
  );
  const contextLengthMismatch =
    selectedModel?.contextLength && selectedModel.contextLength > 0
      ? computeContextLengthMismatch(selectedModel.contextLength, startupParameters.ctxSize)
      : null;

  // --- Custom hooks ---
  const {
    snapshot: runtimeSnapshot,
    runtimeStatus,
    runtimeMetrics,
    canStop,
    isStartPending,
    handleStart: startProcess,
    handleStop,
    stopHealthPoll,
  } = useLlamaProcess({
    appendSystemLog,
    mergeLogs,
    onHealthy: () => setActiveTab("connect"),
  });

  const launchDraft = useMemo(
    () => ({
      binaryPath,
      modelPath: selectedModel?.path ?? selectedModelPath,
      host: "127.0.0.1" as const,
      port,
      parameters: startupParameters,
      prometheusHints,
      autoPort,
    }),
    [autoPort, binaryPath, port, prometheusHints, selectedModel?.path, selectedModelPath, startupParameters],
  );
  const launchDraftChanges = useMemo(
    () => getLaunchDraftChanges(launchDraft, runtimeSnapshot.activeLaunch),
    [launchDraft, runtimeSnapshot.activeLaunch],
  );

  const previewConfig = useMemo(
    () => ({
        binaryPath,
        modelPath: selectedModel?.path ?? null,
        host: "127.0.0.1" as const,
        port,
        parameters: startupParameters,
        prometheusHints,
      }),
    [binaryPath, port, prometheusHints, selectedModel?.path, startupParameters],
  );
  const commandPreview = useCommandPreview(previewConfig, runningInTauri);

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
        parameterPresetSourceId,
        selectedModelPath,
        autoPort,
        port,
        startupParameters,
        sampling,
        prometheusHints,
        ui: uiSettings,
      }),
    [
      binaryPath,
      autoPort,
      directories,
      port,
      parameterPresetSourceId,
      profileId,
      prometheusHints,
      selectedModelPath,
      startupParameters,
      sampling,
      uiSettings,
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
  const { pending: isLaunchTransactionPending, run: runLaunchTransaction } =
    useExclusiveAsyncAction();

  useAppBootstrap({
    runningInTauri,
    appendSystemLog,
    hasBootstrappedRef,
    setBinaryPath,
    setAutoPort,
    setPort,
    setProfileId,
    setParameterPresetSourceId,
    setStartupParameters,
    setSampling,
    setUiSettings,
    setDirectories,
    setModels,
    setSelectedModelPath,
    setPrometheusHints,
    scanDirectories: modelScan.scanDirectories,
  });

  useDebouncedSettingsPersist(runningInTauri, hasBootstrappedRef, settingsSnapshot, appendSystemLog);

  // Read tray state from backend on startup
  useEffect(() => {
    if (!runningInTauri) return;
    getTrayEnabled()
      .then((enabled) =>
        setUiSettings((current) => ({ ...current, showInMenuBar: enabled })),
      )
      .catch(() => {/* ignore — tray API might not be available in dev */});
  }, [runningInTauri]);

  const sortedModels = useMemo(() => {
    let result = [...models];
    if (modelSearch) {
      const q = modelSearch.toLowerCase();
      result = result.filter((m) => m.fileName.toLowerCase().includes(q));
    }
    switch (modelSort) {
      case "size":
        result.sort((a, b) => b.sizeBytes - a.sizeBytes);
        break;
      case "date":
        result.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
        break;
      default:
        result.sort((a, b) => a.fileName.localeCompare(b.fileName));
    }
    return result;
  }, [models, modelSort, modelSearch]);

  const runtimeConnection = useMemo(
    () =>
      buildRuntimeConnection({
        snapshot: runtimeSnapshot,
        draftPort: port,
        draftModelName: selectedModel?.fileName ?? null,
      }),
    [port, runtimeSnapshot, selectedModel?.fileName],
  );

  useEffect(() => {
    setStartupParameters((current) => {
      const base =
        profileId === "max-capability"
          ? buildMaxCapabilityStartupParameters(selectedModel?.contextLength ?? null, current)
          : current;
      return applyParameterPresetSource(parameterPresetSourceId, selectedModel, base, getProfileById("custom").sampling)
        .parameters;
    });
    setSampling((current) => {
      const base =
        profileId === "max-capability"
          ? buildMaxCapabilitySampling(resolveModelContextLimit(selectedModel?.contextLength ?? null), current)
          : current;
      return applyParameterPresetSource(
        parameterPresetSourceId,
        selectedModel,
        getProfileById("custom").parameters,
        base,
      ).sampling;
    });
  }, [
    parameterPresetSourceId,
    profileId,
    selectedModel,
  ]);

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

  async function performStart() {
    if (!selectedModel) {
      appendSystemLog("请先选择 GGUF 模型。");
      return;
    }
    if (!modelLaunchAssessment.allowed) {
      appendSystemLog(modelLaunchAssessment.error ?? "该模型无法启动。");
      return;
    }
    if (modelLaunchAssessment.warning) {
      appendSystemLog(`模型元数据警告：${modelLaunchAssessment.warning}`);
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
      launchPort = await resolveLaunchPort(autoPort, port, findAvailablePort);
      if (autoPort && launchPort !== port) {
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

  async function handleStart() {
    await runLaunchTransaction(performStart);
  }

  function restoreActiveLaunchToDraft() {
    const active = runtimeSnapshot.activeLaunch;
    if (!active) return;
    setBinaryPath(active.binaryPath);
    setSelectedModelPath(active.modelPath);
    setPort(active.port);
    setAutoPort(false);
    setStartupParameters(active.parameters);
    setPrometheusHints(active.prometheusHints);
    appendSystemLog("已将草稿恢复为当前运行配置；自动端口已关闭以保留实际端口。");
  }

  function handleSelectModel(path: string) {
    const nextModel = models.find((model) => model.path === path) ?? null;
    if (!getModelLaunchAssessment(nextModel).allowed) return;
    setSelectedModelPath(path);
    setStartupParameters((current) => {
      const mmprojPath = reconcileMmprojPathForModel(current.mmprojPath, nextModel);
      if (mmprojPath === current.mmprojPath) return current;
      return { ...current, mmprojPath };
    });
  }

  async function handleExportLegacyHistory() {
    if (!runningInTauri) {
      appendSystemLog("浏览器预览模式下不能导出 V2 历史；请在 Tauri 应用中使用。");
      return;
    }

    try {
      const exportPath = await exportLegacyChatHistory();
      appendSystemLog(`已导出 V2 历史：${exportPath}`);
    } catch (error) {
      appendSystemLog(`导出 V2 历史失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="title-block">
          <Cpu size={16} />
          <h1>iLlama</h1>
          <span className="version-badge">v3.1.0</span>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button" onClick={handleSelectBinary}>
            <FileCog size={14} />
            {binaryPath ? "llama-server ✓" : "选择 llama-server"}
          </button>
          <button
            className="start-button"
            type="button"
            disabled={
              canStop || isStartPending || isLaunchTransactionPending || !modelLaunchAssessment.allowed
            }
            onClick={handleStart}
          >
            {runtimeStatus === "starting" || isStartPending || isLaunchTransactionPending ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <Play size={13} />
            )}
            {runtimeStatus === "starting" || isStartPending || isLaunchTransactionPending
              ? "启动中..."
              : "启动"}
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
              onRescanDirectory={modelScan.scanDirectory}
            />
            <ModelList
              models={sortedModels}
              selectedPath={selectedModelPath}
              sort={modelSort}
              onSortChange={setModelSort}
              onSelect={handleSelectModel}
              search={modelSearch}
              onSearchChange={setModelSearch}
            />
          </>
        }
        runContent={
          <div className="config-view">
            <RuntimeStatusCard snapshot={runtimeSnapshot} onStop={handleStop} />
            {runtimeSnapshot.activeLaunch && launchDraftChanges.length > 0 && (
              <section className="runtime-draft-notice panel" aria-label="下次启动配置变更">
                <div>
                  <strong>当前草稿有 {launchDraftChanges.length} 项变更</strong>
                  <p>这些变更只会在下次启动时生效；当前服务仍使用实际运行配置。</p>
                </div>
                <button className="ghost-button" type="button" onClick={restoreActiveLaunchToDraft}>
                  恢复为当前运行配置
                </button>
              </section>
            )}
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
              modelContextLength={selectedModel?.contextLength ?? null}
              port={port}
              onPortChange={setPort}
              autoPort={autoPort}
              onAutoPortChange={setAutoPort}
              mmprojCandidates={selectedModel?.mmprojCandidates ?? []}
              onSelectMmproj={handleSelectMmproj}
              validation={launchValidation}
              prometheusHints={prometheusHints}
              parameterPresetSourceId={parameterPresetSourceId}
              parameterPresetSources={parameterPresetSources}
              appliedParameterPresetName={appliedParameterPreset.appliedPreset.name}
              onParameterPresetSourceChange={(id) => {
                setParameterPresetSourceId(id);
                const adjusted = applyParameterPresetSource(id, selectedModel, startupParameters, sampling);
                setStartupParameters(adjusted.parameters);
                setSampling(adjusted.sampling);
              }}
              onPrometheusHintsChange={setPrometheusHints}
              onParametersChange={setStartupParameters}
              onProfileChange={(id) => {
                setProfileId(id);
                if (id === "max-capability") {
                  const nextParameters = buildMaxCapabilityStartupParameters(
                    selectedModel?.contextLength ?? null,
                    startupParameters,
                  );
                  const nextSampling = buildMaxCapabilitySampling(nextParameters.ctxSize, sampling);
                  const adjusted = applyParameterPresetSource(
                    parameterPresetSourceId,
                    selectedModel,
                    nextParameters,
                    nextSampling,
                  );
                  setStartupParameters(adjusted.parameters);
                  setSampling(adjusted.sampling);
                }
              }}
            />
            <SamplingPanel
              parameterMode={profileId}
              sampling={sampling}
              ctxSize={startupParameters.ctxSize}
              onSamplingChange={setSampling}
              advancedOpen={uiSettings.advancedOpen}
              onAdvancedOpenChange={(advancedOpen) =>
                setUiSettings((current) => ({ ...current, advancedOpen }))
              }
            />
            <CommandPreview args={commandPreview.args} warnings={commandPreview.warnings} />
          </div>
        }
        connectionContent={
          <ConnectionPanel
            connection={runtimeConnection}
            runningInTauri={runningInTauri}
            trayEnabled={uiSettings.showInMenuBar}
            onTrayToggle={(enabled) => {
              if (!runningInTauri) {
                setUiSettings((current) => ({ ...current, showInMenuBar: enabled }));
                return;
              }
              void setTrayEnabled(enabled)
                .then((actual) => {
                  setUiSettings((current) => ({ ...current, showInMenuBar: actual }));
                })
                .catch((err) => {
                  appendSystemLog(
                    `状态栏图标设置失败：${err instanceof Error ? err.message : String(err)}`,
                  );
                  void getTrayEnabled().then((actual) => {
                    setUiSettings((current) => ({ ...current, showInMenuBar: actual }));
                  });
                });
            }}
            onOpenTest={() => setActiveTab("test")}
            onExportLegacyHistory={() => void handleExportLegacyHistory()}
            appendSystemLog={appendSystemLog}
          />
        }
        testContent={
          <RuntimeSmokeChat
            snapshot={runtimeSnapshot}
            sampling={sampling}
            appendSystemLog={appendSystemLog}
            onNavigateToRun={() => setActiveTab("run")}
          />
        }
        logs={logs}
        runtimeStatus={runtimeStatus}
        runtimeMetrics={runtimeMetrics}
        canStop={canStop}
        onStop={handleStop}
        onClearLogs={clearLogs}
        logOpen={uiSettings.logPanelOpen}
        logHeight={uiSettings.logPanelHeight}
        onLogOpenChange={(logPanelOpen) =>
          setUiSettings((current) => ({ ...current, logPanelOpen }))
        }
        onLogHeightChange={(logPanelHeight) =>
          setUiSettings((current) => ({ ...current, logPanelHeight }))
        }
      />
    </div>
  );
}
