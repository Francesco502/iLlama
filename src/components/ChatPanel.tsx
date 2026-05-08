import { ImagePlus, MessageCircle, SendHorizontal, Square, Trash2, X } from "lucide-react";
import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ChatImageAttachment, ChatMessage, PendingChatMessage } from "../types/domain";
import { MarkdownContent } from "./MarkdownContent";

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const THUMBNAIL_SIZE = 128;

interface ChatPanelProps {
  messages: ChatMessage[];
  disabled: boolean;
  streaming: boolean;
  onSend: (message: PendingChatMessage) => void;
  onCancel: () => void;
  onClear: () => void;
}

export function ChatPanel({ messages, disabled, streaming, onSend, onCancel, onClear }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSend = !disabled && !streaming && (draft.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  function submit() {
    const message = draft.trim();
    if ((!message && attachments.length === 0) || disabled || streaming) {
      return;
    }
    onSend({ text: message, attachments });
    setDraft("");
    setAttachments([]);
    setAttachmentError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    setAttachmentError(null);
    const remainingSlots = Math.max(0, MAX_IMAGE_ATTACHMENTS - attachments.length);
    const selectedFiles = files.slice(0, remainingSlots).filter((file) => file.type.startsWith("image/"));

    if (files.length > remainingSlots) {
      setAttachmentError(`一次会话最多附加 ${MAX_IMAGE_ATTACHMENTS} 张图片。`);
    }

    const accepted: ChatImageAttachment[] = [];
    for (const file of selectedFiles) {
      if (file.size > MAX_IMAGE_BYTES) {
        setAttachmentError("图片不能超过 8 MB。");
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      const thumbnailUrl = await createThumbnail(dataUrl, THUMBNAIL_SIZE);
      accepted.push({
        id: createAttachmentId(),
        name: file.name,
        mimeType: file.type || "image/png",
        sizeBytes: file.size,
        dataUrl,
        thumbnailUrl,
      });
    }

    setAttachments((current) => [...current, ...accepted].slice(0, MAX_IMAGE_ATTACHMENTS));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  }

  const hasMessages = messages.length > 0;
  const showClear = messages.length > 1; // More than just the welcome message

  return (
    <div className="chat-view">
      <div className="chat-list" ref={listRef}>
        {!hasMessages && (
          <div className="chat-empty">
            <MessageCircle size={40} strokeWidth={1} />
            <p>开始与本地模型对话</p>
            <small>{disabled ? "请先启动模型" : "输入消息，按 ⌘+Enter 发送"}</small>
          </div>
        )}
        {messages.map((message) => (
          <article className="chat-message" data-role={message.role} key={message.id}>
            <span>{message.role === "assistant" ? "助手" : "用户"}</span>
            {message.attachments && message.attachments.length > 0 && (
              <div className="message-attachments">
                {message.attachments.map((attachment) => (
                  <img
                    alt={attachment.name}
                    key={attachment.id}
                    src={attachment.thumbnailUrl || attachment.dataUrl}
                  />
                ))}
              </div>
            )}
            {(message.content || message.streaming) && (
              <div className="message-body">
                {message.role === "assistant" ? (
                  <MarkdownContent text={message.content} />
                ) : (
                  <p>{message.content}</p>
                )}
                {message.streaming ? <span className="streaming-cursor">▍</span> : null}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="chat-input-area">
        <div className="chat-input-container" data-disabled={disabled}>
          {attachments.length > 0 && (
            <div className="attachment-tray" aria-label="已选择图片">
              {attachments.map((attachment) => (
                <div className="attachment-chip" key={attachment.id}>
                  <img alt="" src={attachment.thumbnailUrl || attachment.dataUrl} />
                  <span>{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${attachment.name}`}
                    onClick={() =>
                      setAttachments((current) => current.filter((item) => item.id !== attachment.id))
                    }
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachmentError && <div className="attachment-error">{attachmentError}</div>}
          <div className="chat-input-row">
            <button
              className="chat-attach-btn"
              disabled={disabled || streaming}
              type="button"
              aria-label="添加图片"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={18} />
            </button>
            <input
              ref={fileInputRef}
              aria-label="选择图片附件"
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={handleImageSelection}
            />
            <textarea
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={disabled ? "模型启动后即可发送消息…" : "输入消息，与本地模型对话…"}
              rows={1}
              value={draft}
            />
            {streaming ? (
              <button className="chat-send-btn streaming" type="button" onClick={onCancel} aria-label="取消生成">
                <Square size={16} />
              </button>
            ) : (
              <button className="chat-send-btn" disabled={!canSend} type="button" aria-label="发送消息" onClick={submit}>
                <SendHorizontal size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="chat-input-hint">
          {streaming ? (
            "生成中… 点击停止按钮取消"
          ) : (
            <>
              支持图片输入 · ⌘+Enter 发送
              {showClear && (
                <button className="clear-chat-btn" type="button" onClick={onClear} aria-label="清空对话">
                  <Trash2 size={11} />
                  清空
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function createAttachmentId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取图片失败")));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale an image data URL to a small thumbnail for display in message history.
 * Falls back to the original if canvas is unavailable (e.g., in tests) or on timeout.
 */
function createThumbnail(dataUrl: string, maxSize: number): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(dataUrl);
      return;
    }

    let settled = false;
    const finish = (url: string) => {
      if (!settled) {
        settled = true;
        resolve(url);
      }
    };

    const timer = setTimeout(() => finish(dataUrl), 200);

    const img = new Image();
    img.addEventListener("load", () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/webp", 0.6));
      } catch {
        finish(dataUrl);
      }
    });
    img.addEventListener("error", () => {
      clearTimeout(timer);
      finish(dataUrl);
    });
    img.src = dataUrl;
  });
}
