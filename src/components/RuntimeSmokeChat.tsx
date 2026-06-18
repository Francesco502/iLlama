import { Trash2, User, Bot, Cpu, Zap, FileText } from "lucide-react";
import { useEffect, useRef } from "react";
import { useRuntimeSmokeChat } from "../hooks/useRuntimeSmokeChat";
import type { ChatAttachment, ChatMessage } from "../types/chat";
import type { ModelEntry, RuntimeStatus, SamplingParameters } from "../types/domain";
import { MarkdownContent } from "./MarkdownContent";
import { SmokeChatComposer } from "./SmokeChatComposer";

interface RuntimeSmokeChatProps {
  runtimeStatus: RuntimeStatus;
  selectedModel: ModelEntry | null;
  port: number;
  sampling: SamplingParameters;
  appendSystemLog: (message: string) => void;
  onNavigateToRun?: () => void;
}

export function RuntimeSmokeChat({
  runtimeStatus,
  selectedModel,
  port,
  sampling,
  appendSystemLog,
  onNavigateToRun,
}: RuntimeSmokeChatProps) {
  const {
    messages,
    streaming,
    streamTokensPerSecond,
    sendMessage,
    cancelGeneration,
    clearMessages,
  } = useRuntimeSmokeChat({
    port,
    sampling,
    modelName: selectedModel?.fileName ?? null,
    appendSystemLog,
  });
  const disabledReason = runtimeStatus === "healthy" ? (streaming ? "streaming" : undefined) : "runtime";
  const disabled = Boolean(disabledReason);

  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  return (
    <section className="runtime-smoke-chat panel" aria-label="临时测试对话">
      <div className="runtime-smoke-chat-header">
        <div>
          <span className="eyebrow">Smoke test</span>
          <h2>测试</h2>
          <p>仅用于验证当前模型是否能回复，不保存历史。</p>
        </div>
        <div className="runtime-smoke-chat-meta">
          <div className={`status-badge status-${runtimeStatus}`}>
            <span className="status-dot"></span>
            <span>
              {runtimeStatus === "healthy"
                ? "服务已启动"
                : runtimeStatus === "starting"
                ? "服务启动中"
                : runtimeStatus === "failed"
                ? "启动失败"
                : runtimeStatus === "stopping"
                ? "正在停止"
                : "服务未启动"}
            </span>
          </div>
          {selectedModel && (
            <span className="meta-pill" title={selectedModel.path}>
              <Cpu size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />
              {selectedModel.fileName}
            </span>
          )}
          <span className="meta-pill">
            <span className="meta-label">端口 </span>
            <strong>{port}</strong>
          </span>
          {streamTokensPerSecond != null && (
            <span className="meta-pill speed">
              <Zap size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />
              <strong>{streamTokensPerSecond.toFixed(1)}</strong> tok/s
            </span>
          )}
          {messages.length > 0 && (
            <button
              className="ghost-button compact clear-test-btn"
              type="button"
              onClick={clearMessages}
              style={{ marginLeft: 8 }}
            >
              <Trash2 size={12} />
              清空
            </button>
          )}
        </div>
      </div>

      <div className="runtime-smoke-chat-thread" ref={threadRef} aria-label="测试消息列表">
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            {runtimeStatus !== "healthy" ? (
              <>
                <h3>本地推理服务未运行</h3>
                <p>请先在运行面板中选择并开启模型。</p>
                {onNavigateToRun && (
                  <button
                    type="button"
                    className="start-button secondary"
                    onClick={onNavigateToRun}
                    style={{ marginTop: 12 }}
                  >
                    前往配置与运行
                  </button>
                )}
              </>
            ) : (
              <>
                <h3>发送一条测试消息</h3>
                <p>如果这里能回复，就可以把连接信息填到 Chatbox、Cherry Studio 或其他客户端里。</p>
              </>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <article className="chat-message-item smoke-message-wrapper" data-role={message.role} key={message.id}>
              <div className="smoke-avatar">
                {message.role === "assistant" ? <Bot size={16} /> : <User size={16} />}
              </div>
              <div className="smoke-message-body">
                <div className="chat-message-topline">
                  <span className="smoke-role-name">{message.role === "assistant" ? "助手" : "用户"}</span>
                  <span className="smoke-status-label">{message.status === "streaming" ? "生成中" : statusLabel(message.status)}</span>
                </div>
                <div className="chat-message-content smoke-bubble">
                  {message.role === "assistant" ? (
                    <MarkdownContent text={message.content || (message.status === "streaming" ? "…" : "")} />
                  ) : (
                    <UserSmokeMessageContent message={message} />
                  )}
                </div>
                {message.status === "failed" && (
                  <div className="message-status failed">{message.error ?? "测试请求失败"}</div>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      <SmokeChatComposer
        disabled={disabled}
        disabledReason={disabledReason}
        streaming={streaming}
        imagePersistence="memory"
        onSend={sendMessage}
        onCancel={cancelGeneration}
      />
    </section>
  );
}

function UserSmokeMessageContent({ message }: { message: ChatMessage }) {
  const attachments = message.attachments ?? [];

  return (
    <>
      {message.content.trim().length > 0 && <p>{message.content}</p>}
      {attachments.length > 0 && (
        <div className="smoke-message-attachments" aria-label="消息附件">
          {attachments.map((attachment) => (
            <SmokeMessageAttachment attachment={attachment} key={attachment.id} />
          ))}
        </div>
      )}
    </>
  );
}

function SmokeMessageAttachment({ attachment }: { attachment: ChatAttachment }) {
  const isImage = attachment.mimeType.toLowerCase().startsWith("image/");
  const imageUrl = attachment.thumbnailUrl || attachment.dataUrl;

  return (
    <div className="smoke-message-attachment">
      {isImage && imageUrl ? (
        <img alt={attachment.name} src={imageUrl} />
      ) : (
        <span className="smoke-message-attachment-icon" aria-hidden>
          <FileText size={14} />
        </span>
      )}
      <span>{attachment.name}</span>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "complete":
      return "完成";
    case "cancelled":
      return "已取消";
    case "failed":
      return "失败";
    default:
      return status;
  }
}
