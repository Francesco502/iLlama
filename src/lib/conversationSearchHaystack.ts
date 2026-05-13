import type { ChatConversation } from "../types/chat";

/** Lowercased haystack for sidebar search (title + message excerpts). */
export function buildSearchHaystack(conversation: ChatConversation): string {
  const parts: string[] = [conversation.title];
  for (const message of conversation.messages) {
    if (!message.content) continue;
    parts.push(message.content.length > 2000 ? message.content.slice(0, 2000) : message.content);
  }
  return parts.join("\n").toLowerCase();
}
