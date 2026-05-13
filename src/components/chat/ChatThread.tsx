import { useEffect, useRef, useState } from "react";
import type { ChatConversation } from "../../types/chat";
import { ChatMessageItem } from "./ChatMessageItem";

interface ChatThreadProps {
  conversation: ChatConversation | null;
  streaming: boolean;
  onBranchFromMessage: (messageId: string) => void;
  onEditAndResend: (messageId: string, text: string) => void;
  onRegenerate: (messageId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onContinueAssistant: (assistantMessageId: string) => void | Promise<void>;
  onOpenSamplingTab: () => void;
}

export function ChatThread({
  conversation,
  streaming,
  onBranchFromMessage,
  onEditAndResend,
  onRegenerate,
  onDeleteMessage,
  onContinueAssistant,
  onOpenSamplingTab,
}: ChatThreadProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (distanceFromBottom < 80) {
      list.scrollTop = list.scrollHeight;
      setShowJump(false);
    } else if (streaming) {
      setShowJump(true);
    }
  }, [conversation?.messages, streaming]);

  if (!conversation) {
    return (
      <div className="chat-thread empty">
        <p>选择或新建一个对话</p>
      </div>
    );
  }

  return (
    <div className="chat-thread" ref={listRef} aria-label="消息列表" aria-live={streaming ? "polite" : "off"}>
      {conversation.messages.map((message) => (
        <ChatMessageItem
          key={message.id}
          message={message}
          streaming={streaming}
          onBranch={() => onBranchFromMessage(message.id)}
          onDelete={() => onDeleteMessage(message.id)}
          onEdit={(text) => onEditAndResend(message.id, text)}
          onRegenerate={() => onRegenerate(message.id)}
          onContinue={() => void onContinueAssistant(message.id)}
          onOpenSamplingTab={onOpenSamplingTab}
        />
      ))}
      {showJump && (
        <button
          className="jump-bottom-btn"
          type="button"
          onClick={() => {
            if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
            setShowJump(false);
          }}
        >
          跳到底部
        </button>
      )}
    </div>
  );
}
