import { Gauge } from "lucide-react";
import type { ChatConversation } from "../../types/chat";
import type { ModelEntry } from "../../types/domain";

interface ConversationTitleBarProps {
  conversation: ChatConversation | null;
  selectedModel: ModelEntry | null;
  streamTokensPerSecond: number | null;
}

export function ConversationTitleBar({
  conversation,
  selectedModel,
  streamTokensPerSecond,
}: ConversationTitleBarProps) {
  return (
    <header className="conversation-title-bar">
      <div>
        <h2>{conversation?.title ?? "新对话"}</h2>
        <p>{selectedModel?.fileName ?? conversation?.modelName ?? "未选择模型"}</p>
      </div>
      <div className="conversation-title-meta">
        <Gauge size={13} />
        {streamTokensPerSecond != null ? `${streamTokensPerSecond.toFixed(1)} tok/s` : "上下文就绪"}
      </div>
    </header>
  );
}
