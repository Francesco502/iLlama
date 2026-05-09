import { SendHorizontal, Square } from "lucide-react";
import { KeyboardEvent, useState } from "react";
import type { PendingChatMessage } from "../../types/chat";

interface ChatComposerProps {
  disabled: boolean;
  streaming: boolean;
  onSend: (message: PendingChatMessage) => void;
  onCancel: () => void;
}

export function ChatComposer({ disabled, streaming, onSend, onCancel }: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const canSend = !disabled && draft.trim().length > 0;

  function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend({ text, attachments: [] });
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }

  return (
    <footer className="chat-composer">
      <textarea
        aria-label="输入消息"
        disabled={disabled}
        placeholder={disabled ? "启动模型后即可发送" : "输入消息，与本地模型对话…"}
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {streaming ? (
        <button type="button" className="chat-composer-send" aria-label="取消生成" onClick={onCancel}>
          <Square size={16} />
        </button>
      ) : (
        <button type="button" className="chat-composer-send" aria-label="发送消息" disabled={!canSend} onClick={submit}>
          <SendHorizontal size={16} />
        </button>
      )}
    </footer>
  );
}
