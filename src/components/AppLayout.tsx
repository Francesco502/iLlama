import { Settings2, MessageCircle, ChevronDown, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { LogEntry, RuntimeMetrics, RuntimeStatus } from "../types/domain";
import { formatBytes } from "../lib/format";

interface AppLayoutProps {
  activeTab: "config" | "chat";
  onTabChange: (tab: "config" | "chat") => void;
  sidebar: ReactNode;
  configContent: ReactNode;
  chatContent: ReactNode;
  logs: LogEntry[];
  runtimeStatus: RuntimeStatus;
  runtimeMetrics: RuntimeMetrics;
  onStop: () => void;
}

const statusLabel: Record<RuntimeStatus, string> = {
  idle: "空闲",
  scanning: "扫描中",
  starting: "启动中",
  healthy: "运行中",
  failed: "失败",
  stopping: "停止中",
  stopped: "已停止",
};

export function AppLayout({
  activeTab,
  onTabChange,
  sidebar,
  configContent,
  chatContent,
  logs,
  runtimeStatus,
  runtimeMetrics,
  onStop,
}: AppLayoutProps) {
  const [logOpen, setLogOpen] = React.useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const canStop = runtimeStatus === "starting" || runtimeStatus === "healthy";

  // #3: Auto-scroll log drawer to bottom
  useEffect(() => {
    if (logOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, logOpen]);

  // Keyboard shortcut: Esc closes log panel
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && logOpen) {
        setLogOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [logOpen]);

  return (
    <>
      <div className="app-layout">
        <aside className="sidebar">{sidebar}</aside>
        <div className="main-content">
          <div className="tab-bar">
            <button
              className="tab-button"
              type="button"
              data-active={activeTab === "config"}
              onClick={() => onTabChange("config")}
            >
              <Settings2 size={14} />
              配置
            </button>
            <button
              className="tab-button"
              type="button"
              data-active={activeTab === "chat"}
              onClick={() => onTabChange("chat")}
            >
              <MessageCircle size={14} />
              对话
            </button>
          </div>
          <div className="tab-panel">
            {activeTab === "config" ? configContent : chatContent}
          </div>
        </div>
      </div>

      {/* Log Drawer */}
      <div className="log-drawer" data-open={logOpen}>
        <div className="log-drawer-inner">
          {logs.map((log) => (
            <div className="log-line" data-stream={log.stream} key={log.id}>
              <span>{log.timestamp}</span>
              <code>{log.message}</code>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-indicator">
          <span className="status-dot-live" data-status={runtimeStatus} />
          <span>{statusLabel[runtimeStatus]}</span>
        </div>
        <span className="status-divider" />
        <div className="status-metric">
          <span className="status-metric-label">CPU</span>
          <span className="status-metric-value" data-idle={runtimeMetrics.cpuPercent == null}>
            {runtimeMetrics.cpuPercent != null ? `${runtimeMetrics.cpuPercent.toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="status-metric">
          <span className="status-metric-label">内存</span>
          <span className="status-metric-value" data-idle={runtimeMetrics.memoryBytes == null}>
            {runtimeMetrics.memoryBytes != null ? formatBytes(runtimeMetrics.memoryBytes) : "—"}
          </span>
        </div>
        <div className="status-metric">
          <span className="status-metric-label">Token/s</span>
          <span className="status-metric-value" data-idle={runtimeMetrics.tokensPerSecond == null}>
            {runtimeMetrics.tokensPerSecond != null ? runtimeMetrics.tokensPerSecond.toFixed(1) : "—"}
          </span>
        </div>
        <div className="status-metric">
          <span className="status-metric-label">KV</span>
          <span className="status-metric-value" data-idle={runtimeMetrics.kvCacheUsageRatio == null}>
            {runtimeMetrics.kvCacheUsageRatio != null
              ? `${(runtimeMetrics.kvCacheUsageRatio * 100).toFixed(0)}%`
              : "—"}
          </span>
        </div>
        <div className="status-bar-actions">
          {canStop && (
            <button className="stop-button" type="button" onClick={onStop}>
              <Square size={10} />
              停止
            </button>
          )}
          <button
            className="log-toggle-btn"
            type="button"
            data-open={logOpen}
            onClick={() => setLogOpen(!logOpen)}
          >
            日志 {logs.length}
            <ChevronDown size={12} />
          </button>
        </div>
      </div>
    </>
  );
}

// React import needed for useState inside AppLayout
import React from "react";
