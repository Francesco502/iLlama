import { MessageSquareCode, Pencil, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assistantProfiles, buildAssistantSystemPrompt } from "../../lib/assistantProfiles";
import type { ChatConversation } from "../../types/chat";

interface SystemPromptEditorProps {
  conversation: ChatConversation | null;
  onSaveConversation: (conversation: ChatConversation) => void | Promise<void>;
}

export function SystemPromptEditor({ conversation, onSaveConversation }: SystemPromptEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationId = conversation?.id ?? null;
  const systemPrompt = conversation?.systemPrompt ?? "";

  useEffect(() => {
    if (!conversationId) {
      setOpen(false);
      setDraft("");
      return;
    }
    setDraft(systemPrompt);
  }, [conversationId, systemPrompt]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  if (!conversation) {
    return null;
  }

  const profile = assistantProfiles[conversation.assistantMode] ?? assistantProfiles.general;
  const composed = buildAssistantSystemPrompt(conversation.assistantMode, draft);

  function commit() {
    if (!conversation) return;
    void onSaveConversation({
      ...conversation,
      systemPrompt: draft.trim(),
    });
    setOpen(false);
  }

  function cancel() {
    setDraft(systemPrompt);
    setOpen(false);
  }

  return (
    <section className="system-prompt-editor" aria-label="自定义系统提示">
      <div className="system-prompt-heading">
        <MessageSquareCode size={14} />
        <span>当前对话系统提示</span>
        {!open && (
          <button
            type="button"
            className="ghost-button compact"
            aria-label="编辑系统提示"
            onClick={() => setOpen(true)}
          >
            <Pencil size={12} />
            编辑
          </button>
        )}
      </div>
      {!open && (
        <p className="system-prompt-summary">
          {draft.trim().length === 0
            ? `当前未追加自定义提示，使用「${profile.label}」基础提示。`
            : draft.length > 200
              ? `${draft.slice(0, 200)}…`
              : draft}
        </p>
      )}
      {open && (
        <div className="system-prompt-editor-body">
          <label className="field field-wide">
            <span>追加到「{profile.label}」基础提示之后（留空表示仅使用基础提示）</span>
            <textarea
              ref={textareaRef}
              rows={4}
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="例如：回答用中文，保留代码块原貌……"
            />
          </label>
          <details className="system-prompt-preview">
            <summary>预览实际发送给模型的系统提示</summary>
            <pre>{composed}</pre>
          </details>
          <div className="system-prompt-actions">
            <button type="button" className="ghost-button compact" onClick={cancel}>
              <X size={12} />
              取消
            </button>
            <button type="button" className="primary-button compact" onClick={commit}>
              <Save size={12} />
              保存
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
