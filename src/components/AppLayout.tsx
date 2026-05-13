import { Settings2, MessageCircle, ChevronDown, HelpCircle, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
  onClearLogs?: () => void;
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
  onClearLogs,
}: AppLayoutProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<"all" | "stdout" | "stderr" | "system">("all");
  const [logQuery, setLogQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const canStop = runtimeStatus === "starting" || runtimeStatus === "healthy";

  // #3: Auto-scroll log drawer to bottom
  useEffect(() => {
    if (logOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, logOpen]);

  // Keyboard shortcut: Esc closes log panel / shortcuts modal
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (logOpen) setLogOpen(false);
        return;
      }
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        const isEditable =
          target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
        if (isEditable) return;
        event.preventDefault();
        setShortcutsOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [logOpen, shortcutsOpen]);

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
        {logOpen && (
          <div className="log-drawer-toolbar">
            <div className="log-filter-group" role="tablist" aria-label="日志过滤">
              {(["all", "stdout", "stderr", "system"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={logFilter === kind}
                  data-active={logFilter === kind}
                  onClick={() => setLogFilter(kind)}
                >
                  {kind === "all" ? "全部" : kind}
                </button>
              ))}
            </div>
            <input
              className="log-search"
              type="text"
              placeholder="搜索日志"
              aria-label="搜索日志"
              value={logQuery}
              onChange={(event) => setLogQuery(event.target.value)}
            />
            {onClearLogs && (
              <button
                className="log-clear-btn"
                type="button"
                aria-label="清空日志"
                onClick={onClearLogs}
                disabled={logs.length === 0}
              >
                清空
              </button>
            )}
          </div>
        )}
        <div className="log-drawer-inner">
          {logs
            .filter((log) => (logFilter === "all" ? true : log.stream === logFilter))
            .filter((log) => {
              const query = logQuery.trim().toLowerCase();
              if (!query) return true;
              return log.message.toLowerCase().includes(query);
            })
            .map((log) => (
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
            className="shortcuts-button"
            type="button"
            aria-label="查看快捷键"
            title="快捷键（?）"
            onClick={() => setShortcutsOpen(true)}
          >
            <HelpCircle size={12} />
          </button>
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
      {shortcutsOpen && (
        <div
          className="shortcuts-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="快捷键"
          onClick={() => setShortcutsOpen(false)}
        >
          <div className="shortcuts-modal" onClick={(event) => event.stopPropagation()}>
            <div className="shortcuts-header">
              <h2>快捷键</h2>
              <button
                type="button"
                aria-label="关闭"
                className="shortcuts-close"
                onClick={() => setShortcutsOpen(false)}
              >
                ×
              </button>
            </div>
            <dl className="shortcuts-grid">
              <dt>聚焦搜索框</dt>
              <dd>
                <kbd>⌘/Ctrl</kbd> + <kbd>K</kbd>
              </dd>
              <dt>新建对话</dt>
              <dd>
                <kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>O</kbd>
              </dd>
              <dt>发送消息</dt>
              <dd>
                <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd>
              </dd>
              <dt>取消生成 / 关闭面板</dt>
              <dd>
                <kbd>Esc</kbd>
              </dd>
              <dt>显示此面板</dt>
              <dd>
                <kbd>?</kbd>
              </dd>
            </dl>
          </div>
        </div>
      )}
    </>
  );
}
