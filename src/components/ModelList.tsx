import { Check, Cpu, FolderSearch, Search, X } from "lucide-react";
import { formatBytes, formatDateTime } from "../lib/format";
import type { ModelEntry } from "../types/domain";

type ModelSort = "name" | "size" | "date";

interface ModelListProps {
  models: ModelEntry[];
  selectedPath: string | null;
  sort: ModelSort;
  onSortChange: (sort: ModelSort) => void;
  onSelect: (path: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
}

export function ModelList({
  models,
  selectedPath,
  sort,
  onSortChange,
  onSelect,
  search,
  onSearchChange,
}: ModelListProps) {
  return (
    <section className="sidebar-section model-section">
      <div className="section-header">
        <span>本地模型</span>
        <div className="sort-controls">
          <select className="sort-select" value={sort} onChange={(e) => onSortChange(e.target.value as ModelSort)} aria-label="排序方式">
            <option value="name">名称</option>
            <option value="size">大小</option>
            <option value="date">日期</option>
          </select>
          <span className="count-label">{models.length}</span>
        </div>
      </div>

      <div className="model-search-wrapper">
        <Search size={13} className="model-search-icon" />
        <input
          type="text"
          className="model-search-input"
          placeholder="搜索本地模型..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="搜索模型"
        />
        {search && (
          <button
            type="button"
            className="model-search-clear"
            onClick={() => onSearchChange("")}
            aria-label="清除搜索"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="model-list" role="listbox" aria-label="GGUF 模型列表">
        {models.length === 0 && (
          <div className="model-empty">
            <FolderSearch size={24} strokeWidth={1} />
            <span>{search ? "没有找到匹配的模型" : "选择目录后自动扫描 GGUF 模型"}</span>
          </div>
        )}
        {models.map((model) => {
          const selected = selectedPath === model.path;
          const invalid = model.metadataStatus === "invalid" || !model.available;
          return (
            <button
              aria-disabled={invalid}
              aria-selected={selected}
              className="model-row"
              data-native-acceptance-target={invalid ? undefined : "model-option"}
              data-model-path={model.path}
              data-metadata-status={model.metadataStatus}
              data-selected={selected}
              disabled={invalid}
              key={model.path}
              role="option"
              type="button"
              onClick={() => {
                if (!invalid) onSelect(model.path);
              }}
            >
              <Cpu size={16} />
              <span className="model-row-main">
                <span className="model-name">{model.fileName}</span>
                <span className="model-meta">{model.quantization ?? "GGUF"} · {formatBytes(model.sizeBytes)} · {formatDateTime(model.modifiedAt)}</span>
                {model.metadataStatus === "limited" ? (
                  <span className="model-metadata-warning">
                    元数据受限{model.metadataError ? `：${model.metadataError}` : ""}
                  </span>
                ) : null}
                {model.metadataStatus === "invalid" ? (
                  <span className="model-metadata-error">
                    不可用{model.metadataError ? `：${model.metadataError}` : "：无效 GGUF 文件"}
                  </span>
                ) : null}
              </span>
              {selected ? <Check className="selected-check" size={15} /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
