import { Archive, ArchiveRestore, Download, MessageSquarePlus, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { ChatConversationSummary } from "../../types/chat";
import type { ConversationDateRangePreset } from "../../lib/conversationDateFilter";

interface ConversationSidebarProps {
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  searchQuery: string;
  searchInputRef?: RefObject<HTMLInputElement>;
  showArchived: boolean;
  filterByCurrentModel?: boolean;
  onFilterByCurrentModelChange?: (next: boolean) => void;
  modelFilterEnabled?: boolean;
  dateRangePreset?: ConversationDateRangePreset;
  onDateRangePresetChange?: (next: ConversationDateRangePreset) => void;
  onSearchQueryChange: (query: string) => void;
  onToggleShowArchived: (next: boolean) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onToggleArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
  onExportBeforeDelete: (id: string, format: "markdown" | "json") => void;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  searchQuery,
  searchInputRef,
  showArchived,
  filterByCurrentModel = false,
  onFilterByCurrentModelChange,
  modelFilterEnabled = false,
  dateRangePreset = "all",
  onDateRangePresetChange,
  onSearchQueryChange,
  onToggleShowArchived,
  onCreate,
  onSelect,
  onRename,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onExportBeforeDelete,
}: ConversationSidebarProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pendingDeleteId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPendingDeleteId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDeleteId]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  function startEditing(conversation: ChatConversationSummary) {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
  }

  function commitEdit() {
    if (!editingId) return;
    const next = draftTitle.trim() || "新对话";
    onRename(editingId, next);
    setEditingId(null);
    setDraftTitle("");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftTitle("");
  }

  function handleEditKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  }

  return (
    <aside className="conversation-sidebar" aria-label="历史对话">
      <div className="conversation-sidebar-header">
        <button className="conversation-new-btn" type="button" onClick={onCreate} aria-label="新建对话">
          <MessageSquarePlus size={15} />
          新建对话
        </button>
      </div>
      <input
        ref={searchInputRef}
        className="conversation-search"
        aria-label="搜索对话"
        placeholder="搜索标题或正文"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
      />
      <label className="conversation-archived-toggle">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => onToggleShowArchived(event.target.checked)}
        />
        <span>显示已归档</span>
      </label>
      {modelFilterEnabled && onFilterByCurrentModelChange && (
        <label className="conversation-model-filter-toggle">
          <input
            type="checkbox"
            checked={filterByCurrentModel}
            onChange={(event) => onFilterByCurrentModelChange(event.target.checked)}
            aria-label="仅显示当前所选模型路径的对话"
          />
          <span>仅当前模型</span>
        </label>
      )}
      {onDateRangePresetChange && (
        <div className="conversation-date-filter">
          <label htmlFor="conversation-date-preset">时间范围</label>
          <select
            id="conversation-date-preset"
            value={dateRangePreset}
            aria-label="按更新时间筛选对话"
            onChange={(event) =>
              onDateRangePresetChange(event.target.value as ConversationDateRangePreset)
            }
          >
            <option value="all">全部</option>
            <option value="today">今天</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </select>
        </div>
      )}
      <div className="conversation-list">
        {conversations.length === 0 && <div className="conversation-empty">没有匹配的对话</div>}
        {conversations.map((conversation) => {
          const isEditing = editingId === conversation.id;
          return (
            <div className="conversation-row-wrap" key={conversation.id}>
              {isEditing ? (
                <div className="conversation-edit-row">
                  <input
                    ref={editInputRef}
                    aria-label="对话标题"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={handleEditKey}
                  />
                </div>
              ) : (
                <button
                  className="conversation-row"
                  type="button"
                  aria-label={conversation.title}
                  aria-current={activeConversationId === conversation.id ? "true" : undefined}
                  data-active={activeConversationId === conversation.id}
                  data-archived={conversation.archived}
                  onClick={() => onSelect(conversation.id)}
                  onDoubleClick={() => startEditing(conversation)}
                >
                  <span className="conversation-title">
                    {conversation.pinned && <Pin size={11} />}
                    {conversation.archived && <Archive size={11} />}
                    {conversation.title}
                  </span>
                  <span className="conversation-preview">{conversation.lastMessagePreview || "新对话"}</span>
                </button>
              )}
              <div className="conversation-row-actions">
                <button
                  type="button"
                  className="conversation-action-btn"
                  aria-label={conversation.pinned ? `取消置顶 ${conversation.title}` : `置顶 ${conversation.title}`}
                  title={conversation.pinned ? "取消置顶" : "置顶"}
                  onClick={() => onTogglePin(conversation.id, !conversation.pinned)}
                >
                  {conversation.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
                <button
                  type="button"
                  className="conversation-action-btn"
                  aria-label="重命名对话"
                  title="重命名"
                  onClick={() => startEditing(conversation)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className="conversation-action-btn"
                  aria-label={conversation.archived ? "取消归档" : "归档对话"}
                  title={conversation.archived ? "取消归档" : "归档"}
                  onClick={() => onToggleArchive(conversation.id, !conversation.archived)}
                >
                  {conversation.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                </button>
                <button
                  className="conversation-action-btn conversation-delete-btn"
                  type="button"
                  aria-label={`删除 ${conversation.title}`}
                  aria-expanded={pendingDeleteId === conversation.id}
                  onClick={() =>
                    setPendingDeleteId((current) => (current === conversation.id ? null : conversation.id))
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {pendingDeleteId === conversation.id && (
                <div className="conversation-delete-confirm" role="group" aria-label={`删除 ${conversation.title} 前确认`}>
                  <button
                    type="button"
                    aria-label="删除前导出 Markdown"
                    onClick={() => onExportBeforeDelete(conversation.id, "markdown")}
                  >
                    <Download size={12} />
                    Markdown
                  </button>
                  <button
                    type="button"
                    aria-label="删除前导出 JSON"
                    onClick={() => onExportBeforeDelete(conversation.id, "json")}
                  >
                    <Download size={12} />
                    JSON
                  </button>
                  <button
                    type="button"
                    aria-label={`确认删除 ${conversation.title}`}
                    onClick={() => {
                      setPendingDeleteId(null);
                      onDelete(conversation.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                  <button type="button" aria-label="取消删除" onClick={() => setPendingDeleteId(null)}>
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
