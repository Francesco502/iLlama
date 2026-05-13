import { buildAssistantSystemPrompt } from "./assistantProfiles";
import { estimateMessageTokens, estimateTokenCount } from "./contextBudget";
import type { ChatConversation, ChatMessage } from "../types/chat";

/** Messages considered for token budget (respects compression cursor). */
export function getRequestCandidateMessages(conversation: ChatConversation): ChatMessage[] {
  const throughId = conversation.memory.compressedThroughMessageId;
  if (!throughId) {
    return conversation.messages;
  }

  const throughIndex = conversation.messages.findIndex((message) => message.id === throughId);
  return throughIndex >= 0 ? conversation.messages.slice(throughIndex + 1) : conversation.messages;
}

/** Rough token count for system + memory + all candidate messages (incl. attachments heuristic). */
export function estimateFullRequestTokens(conversation: ChatConversation): number {
  const systemPrompt = buildAssistantSystemPrompt(conversation.assistantMode, conversation.systemPrompt);
  const memoryPrompt = conversation.memory.summary.trim()
    ? `长期对话记忆：\n${conversation.memory.summary}`
    : "";
  const preambleTokens = [systemPrompt, memoryPrompt]
    .filter(Boolean)
    .reduce((total, text) => total + estimateTokenCount(text), 0);
  const messageTokens = getRequestCandidateMessages(conversation).reduce((total, message) => {
    if (message.role === "assistant" && message.status !== "complete") {
      return total;
    }
    return total + estimateMessageTokens(message);
  }, 0);
  return preambleTokens + messageTokens;
}
