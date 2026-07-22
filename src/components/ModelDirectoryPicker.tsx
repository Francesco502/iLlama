import { FolderOpen, RefreshCw, X } from "lucide-react";
import type { ModelDirectory } from "../types/domain";

interface ModelDirectoryPickerProps {
  directories: ModelDirectory[];
  scanning: boolean;
  onAddDirectory: () => void;
  onRemoveDirectory: (path: string) => void;
  onRefresh: () => void;
  onRescanDirectory: (path: string) => void;
}

/** Shorten a path to the last 2-3 segments for display. */
function shortenPath(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

export function ModelDirectoryPicker({
  directories,
  scanning,
  onAddDirectory,
  onRemoveDirectory,
  onRefresh,
  onRescanDirectory,
}: ModelDirectoryPickerProps) {
  return (
    <section className="sidebar-section">
      <div className="section-header">
        <span>模型目录</span>
        <span className="count-label">{directories.length}</span>
      </div>
      <div className="toolbar-row">
        <button className="toolbar-button primary-subtle" type="button" onClick={onAddDirectory}>
          <FolderOpen size={15} />
          选择模型目录
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="刷新模型列表"
          title="刷新模型列表 (⌘R / Ctrl+R)"
          onClick={onRefresh}
        >
          <RefreshCw size={15} className={scanning ? "spin" : undefined} />
          <span>{scanning ? "扫描" : "刷新"}</span>
        </button>
      </div>
      <div className="directory-list">
        {directories.length === 0 && (
          <div className="directory-empty">选择目录以扫描 GGUF 模型</div>
        )}
        {directories.map((directory) => (
          <div className="directory-row" key={directory.path} title={directory.path}>
            <span className="status-dot" data-status={directory.status} />
            <span className="directory-row-main">
              <span className="directory-path">{shortenPath(directory.path)}</span>
              {directory.status === "scanning" && directory.progress ? (
                <span className="directory-detail">
                  已扫描 {directory.progress.filesScanned}，发现 {directory.progress.modelsFound}
                </span>
              ) : null}
              {directory.lastError ? (
                <span className="directory-error">{directory.lastError}</span>
              ) : null}
            </span>
            <button
              className="directory-rescan-btn"
              type="button"
              aria-label={`重新扫描 ${directory.path}`}
              onClick={(event) => {
                event.stopPropagation();
                onRescanDirectory(directory.path);
              }}
            >
              <RefreshCw size={10} />
            </button>
            <button
              className="directory-remove-btn"
              type="button"
              aria-label={`移除 ${directory.path}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDirectory(directory.path);
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
