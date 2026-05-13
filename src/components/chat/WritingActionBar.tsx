import { PenLine } from "lucide-react";
import { buildWritingActionPrompt, writingActions } from "../../lib/writingActions";
import type { ChatConversation } from "../../types/chat";

interface WritingActionBarProps {
  conversation: ChatConversation | null;
  selectedText: string;
  onInsertPrompt: (prompt: string) => void;
}

export function WritingActionBar({
  conversation,
  selectedText,
  onInsertPrompt,
}: WritingActionBarProps) {
  if (!conversation) {
    return null;
  }

  const actions = writingActions.filter((action) => action.modeHint.includes(conversation.assistantMode));
  if (actions.length === 0) {
    return null;
  }

  return (
    <section className="writing-action-bar" aria-label="写作与分析工具">
      <div className="writing-action-bar-label">
        <PenLine size={14} />
        <span>工具</span>
      </div>
      <div className="writing-action-list">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() =>
              onInsertPrompt(
                buildWritingActionPrompt(action.id, {
                  mode: conversation.assistantMode,
                  selectedText,
                  conversationTitle: conversation.title,
                }),
              )
            }
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
