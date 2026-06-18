import { ClipboardPaste, FileText, ImagePlus, SendHorizontal, Square, X } from "lucide-react";
import { ChangeEvent, DragEvent, KeyboardEvent, ClipboardEvent, useEffect, useRef, useState } from "react";
import type { ChatAttachment, ChatAttachmentPersistence, PendingChatMessage } from "../types/chat";

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;
const THUMBNAIL_SIZE = 128;
const COMPOSER_MIN_HEIGHT = 44;
const COMPOSER_MAX_HEIGHT = 180;

interface SmokeChatComposerProps {
  disabled: boolean;
  disabledReason?: "runtime" | "conversation" | "streaming";
  streaming: boolean;
  imagePersistence: ChatAttachmentPersistence;
  draftText?: string;
  onDraftTextChange?: (text: string) => void;
  onSend: (message: PendingChatMessage) => void | Promise<void>;
  onCancel: () => void;
}

export function SmokeChatComposer({
  disabled,
  disabledReason,
  streaming,
  imagePersistence,
  draftText,
  onDraftTextChange,
  onSend,
  onCancel,
}: SmokeChatComposerProps) {
  const [uncontrolledDraft, setUncontrolledDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasDisabledRef = useRef(disabled);
  const draft = draftText ?? uncontrolledDraft;
  const canSend = !disabled && !streaming && (draft.trim().length > 0 || attachments.length > 0);
  const placeholder = disabled
    ? disabledReason === "conversation"
      ? "正在准备新对话…"
      : disabledReason === "streaming"
        ? "正在生成，可停止后继续输入"
        : "启动模型后即可发送"
    : "输入消息，与本地模型对话…（可拖入图片或文本文件）";

  function updateDraft(next: string) {
    if (draftText === undefined) {
      setUncontrolledDraft(next);
    }
    onDraftTextChange?.(next);
  }

  useEffect(() => {
    const wasDisabled = wasDisabledRef.current;
    wasDisabledRef.current = disabled;
    if (wasDisabled && !disabled && !streaming) {
      textareaRef.current?.focus();
    }
  }, [disabled, streaming]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.max(
      COMPOSER_MIN_HEIGHT,
      Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT),
    );
    textarea.style.height = `${nextHeight}px`;
  }, [draft]);

  function submit() {
    const text = draft.trim();
    if ((text.length === 0 && attachments.length === 0) || disabled || streaming) return;
    void onSend({ text, attachments });
    updateDraft("");
    setAttachments([]);
    setAttachmentError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function isTextSnippetCandidate(file: File): boolean {
    const t = file.type.toLowerCase();
    if (t.startsWith("text/")) return true;
    if (t === "application/json" || t.includes("json")) return true;
    if (t.includes("yaml") || t.includes("csv") || t.includes("markdown")) return true;
    return /\.(txt|md|mdx|json|csv|ts|tsx|js|jsx|mjs|cjs|rs|py|go|toml|yaml|yml|html|css|sh|bash)$/i.test(
      file.name,
    );
  }

  async function addFilesFromList(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setAttachmentError(null);
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const textFiles = files.filter((f) => !f.type.startsWith("image/") && isTextSnippetCandidate(f));
    const rejected = files.filter((f) => !f.type.startsWith("image/") && !isTextSnippetCandidate(f));
    if (rejected.length > 0 && imageFiles.length === 0 && textFiles.length === 0) {
      setAttachmentError("不支持的文件类型；请使用图片或文本/代码类文件（.txt、.md、.json 等）。");
      return;
    }

    const accepted: ChatAttachment[] = [];
    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const toProcess = [...imageFiles, ...textFiles].slice(0, remainingSlots);

    if (files.length > remainingSlots) {
      setAttachmentError(`一次最多附加 ${MAX_ATTACHMENTS} 个附件（图片或文本片段）。`);
    }

    for (const file of toProcess) {
      if (file.type.startsWith("image/")) {
        if (file.size > MAX_IMAGE_BYTES) {
          setAttachmentError("单张图片不能超过 8 MB。");
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        const thumbnailUrl = await createThumbnail(dataUrl, THUMBNAIL_SIZE);
        accepted.push({
          id: createAttachmentId(),
          name: file.name || "image.png",
          mimeType: file.type || "image/png",
          sizeBytes: file.size,
          dataUrl,
          thumbnailUrl,
          persistence: imagePersistence,
        });
      } else {
        if (file.size > MAX_TEXT_BYTES) {
          setAttachmentError("单个文本附件不能超过 512 KB。");
          continue;
        }
        const body = await readFileAsText(file);
        const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(body)}`;
        accepted.push({
          id: createAttachmentId(),
          name: file.name || "snippet.txt",
          mimeType: file.type || "text/plain",
          sizeBytes: file.size,
          dataUrl,
          persistence: imagePersistence,
        });
      }
    }

    setAttachments((current) => [...current, ...accepted].slice(0, MAX_ATTACHMENTS));
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    if (disabled || streaming) {
      event.target.value = "";
      return;
    }
    const files = Array.from(event.target.files ?? []);
    await addFilesFromList(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const dt = event.clipboardData;
    if (!dt) return;
    const fromItems: File[] = [];
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) fromItems.push(f);
      }
    }
    const files =
      fromItems.length > 0 ? fromItems : Array.from(dt.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    await addFilesFromList(files);
  }

  function handleDragOver(event: DragEvent) {
    if (disabled || streaming) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  async function handleDrop(event: DragEvent) {
    if (disabled || streaming) return;
    const all = Array.from(event.dataTransfer.files ?? []);
    if (all.length === 0) return;
    const supported = all.some((f) => f.type.startsWith("image/") || isTextSnippetCandidate(f));
    if (!supported) {
      event.preventDefault();
      setAttachmentError("仅支持拖入图片或文本/代码文件（.txt、.md、.json 等）。");
      return;
    }
    event.preventDefault();
    await addFilesFromList(all);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    if (event.metaKey || event.ctrlKey || !event.altKey) {
      event.preventDefault();
      submit();
    }
  }

  async function addClipboardTextAsSnippet() {
    if (disabled || streaming) return;
    setAttachmentError(null);
    const remaining = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (remaining <= 0) {
      setAttachmentError(`一次最多附加 ${MAX_ATTACHMENTS} 个附件。`);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        setAttachmentError("剪贴板为空。");
        return;
      }
      if (trimmed.length > MAX_TEXT_BYTES) {
        setAttachmentError("剪贴板文本不能超过 512 KB。");
        return;
      }
      const blob = new Blob([trimmed], { type: "text/plain;charset=utf-8" });
      const file = new File([blob], `剪贴板-${Date.now()}.txt`, { type: "text/plain" });
      await addFilesFromList([file]);
    } catch {
      setAttachmentError("无法读取剪贴板；请检查应用权限或使用文件/拖放添加。");
    }
  }

  return (
    <footer className="chat-composer">
      <div
        className="chat-composer-box"
        data-disabled={disabled}
        onDragOver={handleDragOver}
        onDrop={(e) => void handleDrop(e)}
      >
        {attachments.length > 0 && (
          <div className="attachment-tray" aria-label="已选择的附件">
            {attachments.map((attachment) => (
              <div className="attachment-chip" key={attachment.id}>
                {attachment.mimeType.toLowerCase().startsWith("image/") ? (
                  <img alt="" src={attachment.thumbnailUrl || attachment.dataUrl} />
                ) : (
                  <span className="attachment-chip-icon" aria-hidden>
                    <FileText size={16} />
                  </span>
                )}
                <span className="attachment-chip-name">{attachment.name}</span>
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
        <div className="chat-composer-row">
          <button
            type="button"
            className="chat-composer-attach"
            aria-label="添加图片或文本附件"
            disabled={disabled || streaming}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={17} />
          </button>
          <button
            type="button"
            className="chat-composer-attach"
            aria-label="将剪贴板纯文本添加为附件"
            title="剪贴板文本为附件"
            disabled={disabled || streaming}
            onClick={() => void addClipboardTextAsSnippet()}
          >
            <ClipboardPaste size={17} />
          </button>
          <input
            ref={fileInputRef}
            aria-label="选择图片或文本附件"
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.rs,.py,text/plain,application/json"
            disabled={disabled || streaming}
            multiple
            onChange={handleFileSelection}
          />
          <textarea
            ref={textareaRef}
            aria-label="输入消息"
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(e) => void handlePaste(e)}
          />
        </div>
      </div>
      {streaming ? (
        <button type="button" className="chat-composer-send streaming" aria-label="取消生成" onClick={onCancel}>
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

function createAttachmentId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取文件失败")));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取文本失败")));
    reader.readAsText(file, "utf-8");
  });
}

function createThumbnail(dataUrl: string, maxSize: number): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof Image === "undefined") {
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
    const image = new Image();
    image.addEventListener("load", () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          finish(dataUrl);
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/webp", 0.6));
      } catch {
        finish(dataUrl);
      }
    });
    image.addEventListener("error", () => {
      clearTimeout(timer);
      finish(dataUrl);
    });
    image.src = dataUrl;
  });
}
