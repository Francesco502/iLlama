import { MessageSquarePlus, Pin, Trash2 } from "lucide-react";
import type { ChatConversationSummary } from "../../types/chat";

interface ConversationSidebarProps {
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  searchQuery,
  onSearchQueryChange,
  onCreate,
  onSelect,
  onDelete,
}: ConversationSidebarProps) {
  return (
    <aside className="conversation-sidebar" aria-label="历史对话">
      <div className="conversation-sidebar-header">
        <button className="conversation-new-btn" type="button" onClick={onCreate} aria-label="新建对话">
          <MessageSquarePlus size={15} />
          新建对话
        </button>
      </div>
      <input
        className="conversation-search"
        aria-label="搜索对话"
        placeholder="搜索对话"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
      />
      <div className="conversation-list">
        {conversations.length === 0 && <div className="conversation-empty">没有匹配的对话</div>}
        {conversations.map((conversation) => (
          <div className="conversation-row-wrap" key={conversation.id}>
            <button
              className="conversation-row"
              type="button"
              aria-label={conversation.title}
              data-active={activeConversationId === conversation.id}
              onClick={() => onSelect(conversation.id)}
            >
              <span className="conversation-title">
                {conversation.pinned && <Pin size={11} />}
                {conversation.title}
              </span>
              <span className="conversation-preview">{conversation.lastMessagePreview || "新对话"}</span>
            </button>
            <button
              className="conversation-delete-btn"
              type="button"
              aria-label={`删除 ${conversation.title}`}
              onClick={() => onDelete(conversation.id)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
