import { Brain, Trash2, WandSparkles } from "lucide-react";
import { emptyConversationMemory } from "../../lib/chatMigration";
import type { ChatConversation } from "../../types/chat";

interface ConversationMemoryPanelProps {
  conversation: ChatConversation | null;
  onCompressNow?: () => void | Promise<void>;
  compressDisabled?: boolean;
  onSaveConversation: (conversation: ChatConversation) => void | Promise<void>;
}

export function ConversationMemoryPanel({
  conversation,
  onCompressNow,
  compressDisabled = false,
  onSaveConversation,
}: ConversationMemoryPanelProps) {
  const memory = conversation?.memory ?? emptyConversationMemory;
  const summary = memory.summary.trim();
  const hasMemory =
    summary.length > 0 || memory.compressedMessageCount > 0 || memory.compressedThroughMessageId != null;
  const compressionUnavailable = compressDisabled || !onCompressNow || !conversation;
  const compressionUnavailableReason = !onCompressNow
    ? "手动压缩稍后可用"
    : !conversation
      ? "当前没有对话"
      : compressDisabled
        ? "启动模型后可压缩对话"
        : "当前没有可压缩的对话";

  function handleClearMemory() {
    if (!conversation || !hasMemory) {
      return;
    }

    void onSaveConversation({
      ...conversation,
      memory: { ...emptyConversationMemory },
    });
  }

  return (
    <section className="conversation-memory-panel" aria-label="长期对话记忆">
      <div className="conversation-memory-heading">
        <Brain size={14} />
        <span>长期对话记忆</span>
        <span className="conversation-memory-count">已压缩 {memory.compressedMessageCount} 条消息</span>
      </div>
      <p className="conversation-memory-summary">{summary || "当前对话尚未压缩。"}</p>
      <div className="conversation-memory-actions">
        <button
          type="button"
          aria-label={compressionUnavailable ? "压缩当前对话（稍后可用）" : "压缩当前对话"}
          disabled={compressionUnavailable}
          title={compressionUnavailable ? compressionUnavailableReason : "压缩当前对话"}
          onClick={() => void onCompressNow?.()}
        >
          <WandSparkles size={13} />
          压缩当前对话
        </button>
        <button type="button" disabled={!hasMemory} onClick={handleClearMemory}>
          <Trash2 size={13} />
          清除压缩记忆
        </button>
      </div>
    </section>
  );
}
