import { useMemo, useState } from "react";
import type { ChatConversation, ChatConversationSummary, PendingChatMessage } from "../../types/chat";
import type { ModelEntry, RuntimeStatus } from "../../types/domain";
import { ChatComposer } from "./ChatComposer";
import { ChatThread } from "./ChatThread";
import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationTitleBar } from "./ConversationTitleBar";

export interface ChatWorkspaceProps {
  runtimeStatus: RuntimeStatus;
  selectedModel: ModelEntry | null;
  conversations: ChatConversationSummary[];
  activeConversation: ChatConversation | null;
  streaming: boolean;
  streamTokensPerSecond: number | null;
  onCreateConversation: () => Promise<ChatConversation>;
  onSelectConversation: (id: string) => void | Promise<void>;
  onSaveConversation: (conversation: ChatConversation) => void | Promise<void>;
  onRenameConversation: (id: string, title: string) => void | Promise<void>;
  onDeleteConversation: (id: string) => void | Promise<void>;
  onBranchFromMessage: (messageId: string) => void | Promise<ChatConversation | null>;
  onSend: (message: PendingChatMessage) => void | Promise<void>;
  onCancel: () => void;
  onRegenerate: (messageId: string) => void | Promise<void>;
  onEditAndResend: (messageId: string, text: string) => void | Promise<void>;
}

export function ChatWorkspace({
  runtimeStatus,
  selectedModel,
  conversations,
  activeConversation,
  streaming,
  streamTokensPerSecond,
  onCreateConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onBranchFromMessage,
  onSend,
  onCancel,
  onRegenerate,
}: ChatWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const disabled = runtimeStatus !== "healthy" || streaming || !activeConversation;
  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return conversations;
    }
    return conversations.filter((conversation) =>
      `${conversation.title} ${conversation.lastMessagePreview}`.toLowerCase().includes(query),
    );
  }, [conversations, searchQuery]);

  return (
    <div className="chat-workspace">
      <ConversationSidebar
        conversations={filteredConversations}
        activeConversationId={activeConversation?.id ?? null}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onCreate={onCreateConversation}
        onSelect={onSelectConversation}
        onRename={onRenameConversation}
        onDelete={onDeleteConversation}
      />
      <section className="chat-main" aria-label="对话工作区">
        <ConversationTitleBar
          conversation={activeConversation}
          selectedModel={selectedModel}
          streamTokensPerSecond={streamTokensPerSecond}
        />
        <ChatThread
          conversation={activeConversation}
          streaming={streaming}
          onBranchFromMessage={onBranchFromMessage}
          onRegenerate={onRegenerate}
          onDeleteMessage={() => undefined}
        />
        <ChatComposer
          disabled={disabled}
          streaming={streaming}
          onCancel={onCancel}
          onSend={onSend}
        />
      </section>
    </div>
  );
}
