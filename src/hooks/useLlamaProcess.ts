import { useCallback, useRef, useState } from "react";
import {
  isTauriRuntime,
  runtimeSnapshot as fetchRuntimeSnapshot,
  startLlama,
  stopLlama,
  type RuntimeSnapshot,
} from "../api/tauri";
import type { LaunchConfig, LogEntry, RuntimeMetrics } from "../types/domain";

const HEALTH_POLL_INTERVAL_MS = 5_000;
const HEALTH_STARTUP_INITIAL_DELAY_MS = 800;
const HEALTH_STARTUP_MAX_DELAY_MS = 4_000;

const idleMetrics: RuntimeMetrics = {
  cpuPercent: null,
  memoryBytes: null,
  tokensPerSecond: null,
  promptTokensPerSecond: null,
  kvCacheUsageRatio: null,
};

const idleSnapshot: RuntimeSnapshot = {
  status: "idle",
  pid: null,
  startedAt: null,
  activeModelPath: null,
  activeLaunch: null,
  lastError: null,
  metrics: idleMetrics,
  logs: [],
};

interface UseLlamaProcessOptions {
  appendSystemLog: (message: string) => void;
  mergeLogs: (incoming: LogEntry[]) => void;
  onHealthy?: () => void;
}

export function useLlamaProcess({ appendSystemLog, mergeLogs, onHealthy }: UseLlamaProcessOptions) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(idleSnapshot);
  const [isStartPending, setIsStartPending] = useState(false);
  const startPendingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextStartupDelayRef = useRef(HEALTH_STARTUP_INITIAL_DELAY_MS);
  const healthyNotifiedRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const stopHealthPoll = useCallback(() => {
    generationRef.current += 1;
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const applySnapshot = useCallback(
    (next: RuntimeSnapshot) => {
      setSnapshot(next);
      mergeLogs(next.logs);
      if (next.lastError && next.lastError !== lastErrorRef.current) {
        lastErrorRef.current = next.lastError;
        appendSystemLog(next.lastError);
      }
      if (next.status === "healthy" && !healthyNotifiedRef.current) {
        healthyNotifiedRef.current = true;
        appendSystemLog("健康检查通过，可以开始对话。");
        onHealthy?.();
      }
      if (next.status !== "healthy") {
        healthyNotifiedRef.current = false;
      }
    },
    [appendSystemLog, mergeLogs, onHealthy],
  );

  const pollRuntime = useCallback(async (generation: number) => {
    try {
      const next = await fetchRuntimeSnapshot();
      if (generation !== generationRef.current) return;
      applySnapshot(next);
      if (next.pid === null) {
        pollTimerRef.current = null;
        return;
      }
      const delay =
        next.status === "starting"
          ? nextStartupDelayRef.current
          : HEALTH_POLL_INTERVAL_MS;
      if (next.status === "starting") {
        nextStartupDelayRef.current = Math.min(
          HEALTH_STARTUP_MAX_DELAY_MS,
          Math.round(nextStartupDelayRef.current * 1.4),
        );
      }
      pollTimerRef.current = setTimeout(() => void pollRuntime(generation), delay);
    } catch (error) {
      if (generation !== generationRef.current) return;
      appendSystemLog(
        `读取运行状态失败，将自动重试：${error instanceof Error ? error.message : String(error)}`,
      );
      pollTimerRef.current = setTimeout(
        () => void pollRuntime(generation),
        HEALTH_POLL_INTERVAL_MS,
      );
    }
  }, [appendSystemLog, applySnapshot]);

  const startHealthPoll = useCallback((generation: number) => {
    nextStartupDelayRef.current = HEALTH_STARTUP_INITIAL_DELAY_MS;
    pollTimerRef.current = setTimeout(
      () => void pollRuntime(generation),
      HEALTH_STARTUP_INITIAL_DELAY_MS,
    );
  }, [pollRuntime]);

  const handleStart = useCallback(
    async (config: LaunchConfig) => {
      if (startPendingRef.current) return;
      startPendingRef.current = true;
      setIsStartPending(true);
      stopHealthPoll();
      const generation = generationRef.current;
      healthyNotifiedRef.current = false;
      lastErrorRef.current = null;
      if (!isTauriRuntime()) {
        const startedAt = new Date().toISOString();
        const preview: RuntimeSnapshot = {
          ...idleSnapshot,
          status: "healthy",
          pid: 1,
          startedAt,
          activeModelPath: config.modelPath,
          activeLaunch:
            config.binaryPath && config.modelPath
              ? {
                  binaryPath: config.binaryPath,
                  modelPath: config.modelPath,
                  host: config.host,
                  port: config.port,
                  parameters: config.parameters,
                  prometheusHints: config.prometheusHints,
                  startedAt,
                  modelId: "local",
                  serverCapabilities: null,
                }
              : null,
        };
        applySnapshot(preview);
        appendSystemLog("浏览器预览模式已模拟启动。");
        startPendingRef.current = false;
        setIsStartPending(false);
        return;
      }

      setSnapshot((current) => ({ ...current, status: "starting", lastError: null }));
      appendSystemLog("正在启动 llama-server...");
      try {
        const next = await startLlama(config);
        if (generation !== generationRef.current) return;
        applySnapshot(next);
        appendSystemLog(`进程已启动${next.pid ? `，PID ${next.pid}` : ""}。`);
        if (next.pid !== null) startHealthPoll(generation);
      } catch (error) {
        if (generation !== generationRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setSnapshot((current) => ({ ...current, status: "failed", lastError: message }));
        appendSystemLog(message);
      } finally {
        startPendingRef.current = false;
        setIsStartPending(false);
      }
    },
    [appendSystemLog, applySnapshot, startHealthPoll, stopHealthPoll],
  );

  const handleStop = useCallback(async () => {
    stopHealthPoll();
    const generation = generationRef.current;
    if (!isTauriRuntime()) {
      setSnapshot({ ...idleSnapshot, status: "stopped" });
      appendSystemLog("浏览器预览模式已停止。");
      return;
    }
    setSnapshot((current) => ({ ...current, status: "stopping" }));
    try {
      const next = await stopLlama();
      if (generation !== generationRef.current) return;
      applySnapshot(next);
      appendSystemLog("llama-server 已停止。");
    } catch (error) {
      if (generation !== generationRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setSnapshot((current) => ({ ...current, status: "failed", lastError: message }));
      appendSystemLog(message);
    }
  }, [appendSystemLog, applySnapshot, stopHealthPoll]);

  return {
    snapshot,
    runtimeStatus: snapshot.status,
    runtimeMetrics: snapshot.metrics,
    canStop: snapshot.pid !== null,
    isStartPending,
    handleStart,
    handleStop,
    stopHealthPoll,
  };
}
