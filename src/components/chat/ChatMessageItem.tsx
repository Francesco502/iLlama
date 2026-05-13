import { Play, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { decodeAttachmentPlainText, isLengthLikeFinishReason } from "../../api/chat";
import { finishReasonUserHint, externalFinishReasonDocHref } from "../../lib/chatFinishReason";
import type { ChatMessage } from "../../types/chat";
import { ErrorBoundary } from "../ErrorBoundary";
import { MarkdownContent } from "../MarkdownContent";
import { MessageActions } from "./MessageActions";
import { ReasoningDisclosure } from "./ReasoningDisclosure";

interface ChatMessageItemProps {
  message: ChatMessage;
  streaming: boolean;
  onBranch: () => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
  onRegenerate: () => void;
  onContinue: () => void;
  onOpenSamplingTab: () => void;
}

export function ChatMessageItem({
  message,
  streaming,
  onBranch,
  onDelete,
  onEdit,
  onRegenerate,
  onContinue,
  onOpenSamplingTab,
}: ChatMessageItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  useEffect(() => {
    setDraft(message.content);
    setEditing(false);
  }, [message.content, message.id]);

  function saveEdit() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    setEditing(false);
    onEdit(text);
  }

  const roleLabel = message.role === "assistant" ? "助手" : message.role === "user" ? "用户" : "系统";
  const maxTokens = message.modelSnapshot?.sampling.maxTokens;
  const usageSource =
    message.role === "assistant" && message.stats
      ? message.stats.completionTokens != null
        ? "server"
        : "estimate"
      : null;

  const completionTokens =
    message.role === "assistant" ? message.stats?.completionTokens ?? message.stats?.generatedTokens ?? null : null;
  const remainingTokens =
    typeof maxTokens === "number" && Number.isFinite(maxTokens) && completionTokens != null
      ? Math.max(0, Math.floor(maxTokens - completionTokens))
      : null;

  const showLengthChip =
    message.role === "assistant" && message.status === "complete" && isLengthLikeFinishReason(message.finishReason);
  const showContinueCancelled = message.role === "assistant" && message.status === "cancelled";
  const continueDisabled = streaming;
  const finishHint = message.role === "assistant" ? finishReasonUserHint(message.finishReason) : null;
  const finishReasonDocHref = externalFinishReasonDocHref();

  return (
    <article className="chat-message-item" data-role={message.role} aria-label={`${roleLabel}消息`}>
      <div className="chat-message-topline">
        <span>{roleLabel}</span>
        <MessageActions
          canEdit={message.role === "user"}
          canRegenerate={message.role === "assistant"}
          content={message.content}
          onBranch={onBranch}
          onDelete={onDelete}
          onEdit={() => setEditing(true)}
          onRegenerate={onRegenerate}
        />
      </div>
      {showLengthChip && (
        <div
          className="message-truncate-banner"
          data-kind="length"
          role="status"
          aria-label="输出因长度限制被截断"
        >
          <span>
            输出因达到 maxTokens 被截断（finish_reason: <code>{message.finishReason}</code>
            ）。
          </span>
          <div className="message-truncate-banner-actions">
            <button
              className="ghost-button compact"
              type="button"
              disabled={continueDisabled}
              aria-label="继续输出"
              onClick={onContinue}
            >
              <Play size={12} />
              继续输出
            </button>
            <button
              className="ghost-button compact"
              type="button"
              disabled={continueDisabled}
              aria-label="打开采样设置以提高 maxTokens"
              onClick={onOpenSamplingTab}
            >
              <SlidersHorizontal size={12} />
              提高 maxTokens
            </button>
          </div>
        </div>
      )}
      {showContinueCancelled && (
        <div
          className="message-truncate-banner"
          data-kind="cancelled"
          role="status"
          aria-label="生成已取消，可续写"
        >
          <span>生成已取消；可在同一条消息上续写。</span>
          <div className="message-truncate-banner-actions">
            <button
              className="ghost-button compact"
              type="button"
              disabled={continueDisabled}
              aria-label="继续输出"
              onClick={onContinue}
            >
              <Play size={12} />
              继续输出
            </button>
          </div>
        </div>
      )}
      {message.role === "assistant" && message.stats && (() => {
        const hasGenerated = (completionTokens ?? 0) > 0;
        const hasMeaningfulMetrics =
          hasGenerated ||
          message.stats.promptTokens != null ||
          message.stats.totalTokens != null ||
          (message.stats.tokensPerSecond ?? 0) > 0 ||
          message.status === "complete" ||
          message.status === "failed" ||
          message.status === "cancelled";
        if (!hasMeaningfulMetrics) {
          return null;
        }
        return (
          <div className="message-metrics" aria-label="消息统计">
            {hasGenerated && <span className="metric">生成 {completionTokens} tok</span>}
            {message.stats.promptTokens != null && (
              <span className="metric">提示 {message.stats.promptTokens} tok</span>
            )}
            {message.stats.totalTokens != null && (
              <span className="metric">总计 {message.stats.totalTokens} tok</span>
            )}
            {remainingTokens != null && <span className="metric">剩余 {remainingTokens} tok</span>}
            {message.stats.tokensPerSecond != null && message.stats.tokensPerSecond > 0 && (
              <span className="metric">{message.stats.tokensPerSecond.toFixed(1)} tok/s</span>
            )}
            {usageSource && (
              <span className="metric" data-source={usageSource}>
                {usageSource === "server" ? "usage: server" : "usage: estimate"}
              </span>
            )}
            {message.status === "complete" &&
              message.finishReason &&
              !isLengthLikeFinishReason(message.finishReason) && (
                <span className="metric" data-source="finish">
                  finish: {message.finishReason}
                </span>
              )}
          </div>
        );
      })()}
      {finishHint && message.status === "complete" && (
        <p className="message-finish-hint" role="note">
          {finishHint}{" "}
          {finishReasonDocHref ? (
            <a className="message-finish-hint-doc-link" href={finishReasonDocHref} rel="noreferrer">
              说明文档
            </a>
          ) : (
            <span className="message-finish-hint-doc">详见仓库 README「用户向说明」。</span>
          )}
        </p>
      )}
      {message.attachments && message.attachments.length > 0 && (
        <div className="message-attachments">
          {message.attachments.map((attachment) => {
            const isImage = attachment.mimeType.toLowerCase().startsWith("image/");
            return (
              <button
                className="message-attachment-button"
                type="button"
                key={attachment.id}
                onClick={() =>
                  isImage
                    ? openAttachmentInNewTab(attachment.dataUrl, attachment.name)
                    : openTextSnippetInNewTab(attachment)
                }
                aria-label={isImage ? `查看图片 ${attachment.name}` : `查看文本附件 ${attachment.name}`}
                title={attachment.name}
              >
                {isImage ? (
                  <img alt={attachment.name} src={attachment.thumbnailUrl || attachment.dataUrl} />
                ) : (
                  <span className="message-attachment-snippet">{attachment.name}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {message.role === "assistant" && message.reasoningContent && (
        <ReasoningDisclosure text={message.reasoningContent} streaming={message.status === "streaming"} />
      )}
      <div className="chat-message-content">
        {editing ? (
          <div className="message-edit-form">
            <textarea
              aria-label="编辑用户消息"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
            />
            <div className="message-edit-actions">
              <button type="button" onClick={() => setEditing(false)}>
                取消编辑
              </button>
              <button type="button" disabled={draft.trim().length === 0} onClick={saveEdit}>
                保存并重新发送
              </button>
            </div>
          </div>
        ) : message.role === "assistant" ? (
          <ErrorBoundary variant="inline" title="Markdown 渲染错误">
            <MarkdownContent text={message.content} />
          </ErrorBoundary>
        ) : (
          <p>{message.content}</p>
        )}
      </div>
      {message.status === "failed" && <div className="message-status failed">{message.error ?? "生成失败"}</div>}
    </article>
  );
}

function openTextSnippetInNewTab(attachment: { name: string; dataUrl: string }): void {
  try {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) return;
    const safeName = attachment.name.replace(/[<>"&]/g, "");
    const body = decodeAttachmentPlainText(attachment.dataUrl) ?? "(无法解码附件)";
    popup.document.title = safeName;
    popup.document.body.style.margin = "16px";
    popup.document.body.style.fontFamily = "ui-monospace, monospace";
    popup.document.body.style.fontSize = "13px";
    popup.document.body.style.whiteSpace = "pre-wrap";
    popup.document.body.style.wordBreak = "break-word";
    const pre = popup.document.createElement("pre");
    pre.textContent = body;
    popup.document.body.appendChild(pre);
  } catch {
    // Best-effort fallback
  }
}

function openAttachmentInNewTab(dataUrl: string, name: string): void {
  try {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) return;
    const safeName = name.replace(/[<>"&]/g, "");
    popup.document.title = safeName;
    popup.document.body.style.margin = "0";
    popup.document.body.style.background = "#000";
    popup.document.body.style.display = "flex";
    popup.document.body.style.alignItems = "center";
    popup.document.body.style.justifyContent = "center";
    const img = popup.document.createElement("img");
    img.alt = safeName;
    img.src = dataUrl;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100vh";
    popup.document.body.appendChild(img);
  } catch {
    // Best-effort fallback: ignore failures in restricted environments.
  }
}
