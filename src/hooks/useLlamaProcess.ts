import { useCallback, useRef, useState } from "react";
import {
  checkHealth,
  confirmHealth,
  isTauriRuntime,
  runtimeSnapshot,
  startLlama,
  stopLlama,
} from "../api/tauri";
import type { LaunchConfig, LogEntry, RuntimeMetrics, RuntimeStatus } from "../types/domain";

const HEALTH_POLL_INTERVAL_MS = 5_000;

const idleMetrics: RuntimeMetrics = {
  cpuPercent: null,
  memoryBytes: null,
  tokensPerSecond: null,
  promptTokensPerSecond: null,
  kvCacheUsageRatio: null,
};

interface UseLlamaProcessOptions {
  appendSystemLog: (message: string) => void;
  mergeLogs: (incoming: LogEntry[]) => void;
  onHealthy?: () => void;
}

export function useLlamaProcess({ appendSystemLog, mergeLogs, onHealthy }: UseLlamaProcessOptions) {
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("idle");
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics>(idleMetrics);
  const healthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHealthPoll = useCallback(() => {
    if (healthPollRef.current !== null) {
      clearInterval(healthPollRef.current);
      healthPollRef.current = null;
    }
  }, []);

  const startHealthPoll = useCallback(() => {
    stopHealthPoll();
    healthPollRef.current = setInterval(async () => {
      try {
        const snapshot = await runtimeSnapshot();
        setRuntimeMetrics(snapshot.metrics);
        mergeLogs(snapshot.logs);
        if (snapshot.status === "stopped" || snapshot.status === "failed") {
          setRuntimeStatus(snapshot.status);
          if (snapshot.lastError) {
            appendSystemLog(snapshot.lastError);
          }
          appendSystemLog("检测到 llama-server 已停止运行。");
          stopHealthPoll();
        }
      } catch {
        // Ignore transient errors during polling
      }
    }, HEALTH_POLL_INTERVAL_MS);
  }, [appendSystemLog, mergeLogs, stopHealthPoll]);

  const pollUntilHealthy = useCallback(async (healthPort: number) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const snapshot = await runtimeSnapshot();
      setRuntimeMetrics(snapshot.metrics);
      mergeLogs(snapshot.logs);
      if (snapshot.status === "stopped" || snapshot.status === "failed") {
        setRuntimeStatus(snapshot.status);
        if (snapshot.lastError) {
          appendSystemLog(snapshot.lastError);
        }
        return;
      }
      const health = await checkHealth("127.0.0.1", healthPort);
      if (health.healthy) {
        await confirmHealth();
        setRuntimeStatus("healthy");
        appendSystemLog("健康检查通过，可以开始对话。");
        startHealthPoll();
        onHealthy?.();
        return;
      }
    }
    setRuntimeStatus("failed");
    appendSystemLog("健康检查超时，请查看启动日志。");
  }, [appendSystemLog, mergeLogs, startHealthPoll, onHealthy]);

  const handleStart = useCallback(
    async (config: LaunchConfig) => {
      if (!isTauriRuntime()) {
        setRuntimeStatus("healthy");
        appendSystemLog("浏览器预览模式已模拟启动。");
        onHealthy?.();
        return;
      }

      setRuntimeStatus("starting");
      appendSystemLog("正在启动 llama-server...");

      try {
        const snapshot = await startLlama(config);
        setRuntimeStatus(snapshot.status);
        setRuntimeMetrics(snapshot.metrics);
        mergeLogs(snapshot.logs);
        appendSystemLog(`进程已启动${snapshot.pid ? `，PID ${snapshot.pid}` : ""}。`);
        void pollUntilHealthy(config.port);
      } catch (error) {
        setRuntimeStatus("failed");
        appendSystemLog(error instanceof Error ? error.message : String(error));
      }
    },
    [appendSystemLog, mergeLogs, pollUntilHealthy, onHealthy],
  );

  const handleStop = useCallback(async () => {
    if (!isTauriRuntime()) {
      setRuntimeStatus("stopped");
      appendSystemLog("浏览器预览模式已停止。");
      return;
    }

    stopHealthPoll();
    setRuntimeStatus("stopping");
    try {
      const snapshot = await stopLlama();
      setRuntimeStatus(snapshot.status);
      setRuntimeMetrics(snapshot.metrics);
      mergeLogs(snapshot.logs);
      appendSystemLog("llama-server 已停止。");
    } catch (error) {
      setRuntimeStatus("failed");
      appendSystemLog(error instanceof Error ? error.message : String(error));
    }
  }, [appendSystemLog, mergeLogs, stopHealthPoll]);

  return {
    runtimeStatus,
    runtimeMetrics,
    handleStart,
    handleStop,
    stopHealthPoll,
  };
}
