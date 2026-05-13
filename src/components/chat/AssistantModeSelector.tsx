import type { ChangeEvent } from "react";
import { assistantProfiles } from "../../lib/assistantProfiles";
import type { ChatAssistantMode, ChatConversation } from "../../types/chat";

interface AssistantModeSelectorProps {
  conversation: ChatConversation | null;
  onSaveConversation: (conversation: ChatConversation) => void | Promise<void>;
}

export function AssistantModeSelector({
  conversation,
  onSaveConversation,
}: AssistantModeSelectorProps) {
  const activeMode = conversation?.assistantMode ?? "general";

  function handleModeChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!conversation) {
      return;
    }

    const assistantMode = event.target.value as ChatAssistantMode;
    if (assistantMode === conversation.assistantMode) {
      return;
    }

    void onSaveConversation({
      ...conversation,
      assistantMode,
    });
  }

  return (
    <label className="assistant-mode-selector">
      <span>模式</span>
      <select aria-label="助手模式" disabled={!conversation} value={activeMode} onChange={handleModeChange}>
        {Object.values(assistantProfiles).map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.label}
          </option>
        ))}
      </select>
    </label>
  );
}
