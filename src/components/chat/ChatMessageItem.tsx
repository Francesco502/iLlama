import type { ChatMessage } from "../../types/chat";
import { MarkdownContent } from "../MarkdownContent";
import { MessageActions } from "./MessageActions";
import { ReasoningDisclosure } from "./ReasoningDisclosure";

interface ChatMessageItemProps {
  message: ChatMessage;
  onBranch: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
}

export function ChatMessageItem({ message, onBranch, onDelete, onRegenerate }: ChatMessageItemProps) {
  return (
    <article className="chat-message-item" data-role={message.role}>
      <div className="chat-message-topline">
        <span>{message.role === "assistant" ? "助手" : message.role === "user" ? "用户" : "系统"}</span>
        <MessageActions
          canRegenerate={message.role === "assistant"}
          content={message.content}
          onBranch={onBranch}
          onDelete={onDelete}
          onRegenerate={onRegenerate}
        />
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <div className="message-attachments">
          {message.attachments.map((attachment) => (
            <img alt={attachment.name} key={attachment.id} src={attachment.thumbnailUrl || attachment.dataUrl} />
          ))}
        </div>
      )}
      {message.role === "assistant" && message.reasoningContent && (
        <ReasoningDisclosure text={message.reasoningContent} streaming={message.status === "streaming"} />
      )}
      <div className="chat-message-content">
        {message.role === "assistant" ? <MarkdownContent text={message.content} /> : <p>{message.content}</p>}
      </div>
      {message.status === "failed" && <div className="message-status failed">{message.error ?? "生成失败"}</div>}
      {message.status === "cancelled" && <div className="message-status">已取消</div>}
    </article>
  );
}
