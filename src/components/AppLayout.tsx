import { ChevronDown, FlaskConical, HelpCircle, Link2, Settings2, Square } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LogEntry, RuntimeMetrics, RuntimeStatus } from "../types/domain";
import { formatBytes } from "../lib/format";

export type AppTab = "run" | "connect" | "test";

interface AppLayoutProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  sidebar: ReactNode;
  runContent: ReactNode;
  connectionContent: ReactNode;
  testContent: ReactNode;
  logs: LogEntry[];
  runtimeStatus: RuntimeStatus;
  runtimeMetrics: RuntimeMetrics;
  canStop: boolean;
  onStop: () => void;
  onClearLogs?: () => void;
  logOpen: boolean;
  logHeight: number;
  onLogOpenChange: (open: boolean) => void;
  onLogHeightChange: (height: number) => void;
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

const MIN_LOG_DRAWER_HEIGHT = 96;
const MAX_LOG_DRAWER_HEIGHT = 480;
const LOG_DRAWER_KEYBOARD_STEP = 24;

function clampLogDrawerHeight(height: number): number {
  return Math.min(MAX_LOG_DRAWER_HEIGHT, Math.max(MIN_LOG_DRAWER_HEIGHT, Math.round(height)));
}

export function AppLayout({
  activeTab,
  onTabChange,
  sidebar,
  runContent,
  connectionContent,
  testContent,
  logs,
  runtimeStatus,
  runtimeMetrics,
  canStop,
  onStop,
  onClearLogs,
  logOpen,
  logHeight,
  onLogOpenChange,
  onLogHeightChange,
}: AppLayoutProps) {
  const [logFilter, setLogFilter] = useState<"all" | "stdout" | "stderr" | "system">("all");
  const [logQuery, setLogQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const stopLogResize = useCallback(() => {
    logResizeRef.current = null;
    document.body.removeAttribute("data-log-resizing");
  }, []);

  const handleLogResizeMove = useCallback((event: MouseEvent) => {
    const resizeState = logResizeRef.current;
    if (!resizeState) {
      return;
    }
    onLogHeightChange(
      clampLogDrawerHeight(resizeState.startHeight + resizeState.startY - event.clientY),
    );
  }, [onLogHeightChange]);

  const handleLogResizeEnd = useCallback(() => {
    stopLogResize();
    window.removeEventListener("mousemove", handleLogResizeMove);
    window.removeEventListener("mouseup", handleLogResizeEnd);
  }, [handleLogResizeMove, stopLogResize]);

  const handleLogResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      logResizeRef.current = {
        startY: event.clientY,
        startHeight: logHeight,
      };
      document.body.setAttribute("data-log-resizing", "true");
      window.addEventListener("mousemove", handleLogResizeMove);
      window.addEventListener("mouseup", handleLogResizeEnd);
    },
    [handleLogResizeEnd, handleLogResizeMove, logHeight],
  );

  function handleLogResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onLogHeightChange(clampLogDrawerHeight(logHeight + LOG_DRAWER_KEYBOARD_STEP));
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onLogHeightChange(clampLogDrawerHeight(logHeight - LOG_DRAWER_KEYBOARD_STEP));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onLogHeightChange(MIN_LOG_DRAWER_HEIGHT);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onLogHeightChange(MAX_LOG_DRAWER_HEIGHT);
    }
  }

  // #3: Auto-scroll log drawer to bottom
  useEffect(() => {
    if (logOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, logOpen]);

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleLogResizeMove);
      window.removeEventListener("mouseup", handleLogResizeEnd);
      stopLogResize();
    };
  }, [handleLogResizeEnd, handleLogResizeMove, stopLogResize]);

  // Keyboard shortcut: Esc closes log panel / shortcuts modal
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (logOpen) onLogOpenChange(false);
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
  }, [logOpen, onLogOpenChange, shortcutsOpen]);

  return (
    <>
      <div className="app-layout">
        <aside className="sidebar">{sidebar}</aside>
        <div className="main-content">
          <div className="tab-bar">
            <button
              className="tab-button"
              type="button"
              data-active={activeTab === "run"}
              onClick={() => onTabChange("run")}
            >
              <Settings2 size={14} />
              运行
            </button>
            <button
              className="tab-button"
              type="button"
              data-active={activeTab === "connect"}
              onClick={() => onTabChange("connect")}
            >
              <Link2 size={14} />
              连接
            </button>
            <button
              className="tab-button"
              type="button"
              data-active={activeTab === "test"}
              onClick={() => onTabChange("test")}
            >
              <FlaskConical size={14} />
              测试
            </button>
          </div>
          <div className="tab-panel">
            {activeTab === "run" && runContent}
            {activeTab === "connect" && connectionContent}
            {activeTab === "test" && testContent}
          </div>
        </div>
      </div>

      {/* Log Drawer */}
      <div
        className="log-drawer"
        data-open={logOpen}
        role="region"
        aria-label="日志面板"
        aria-hidden={!logOpen}
        style={logOpen ? { height: `${logHeight}px` } : undefined}
      >
        {logOpen && (
          <>
            <div
              className="log-resize-handle"
              role="separator"
              aria-label="调整日志面板高度"
              aria-orientation="horizontal"
              aria-valuemin={MIN_LOG_DRAWER_HEIGHT}
              aria-valuemax={MAX_LOG_DRAWER_HEIGHT}
              aria-valuenow={logHeight}
              tabIndex={0}
              onMouseDown={handleLogResizeStart}
              onKeyDown={handleLogResizeKeyDown}
            />
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
                  type="button"
                  className="log-clear-btn"
                  aria-label="清空日志"
                  onClick={onClearLogs}
                  disabled={logs.length === 0}
                >
                  清空
                </button>
              )}
            </div>
          </>
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
            onClick={() => onLogOpenChange(!logOpen)}
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
              <dt>刷新模型列表</dt>
              <dd>
                <kbd>⌘/Ctrl</kbd> + <kbd>R</kbd>
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
