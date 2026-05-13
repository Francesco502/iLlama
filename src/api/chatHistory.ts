import { invoke } from "@tauri-apps/api/core";
import type { ChatConversation, ChatConversationSummary } from "../types/chat";

export interface ChatHistoryIndex {
  schemaVersion: number;
  conversations: ChatConversationSummary[];
}

export async function loadChatHistoryIndex(): Promise<ChatHistoryIndex> {
  return invoke<ChatHistoryIndex>("load_chat_history_index_command");
}

export async function loadChatConversation(id: string): Promise<ChatConversation | null> {
  return invoke<ChatConversation | null>("load_chat_conversation_command", { id });
}

export async function saveChatConversation(
  conversation: ChatConversation,
): Promise<ChatHistoryIndex> {
  return invoke<ChatHistoryIndex>("save_chat_conversation_command", { conversation });
}

export async function deleteChatConversation(id: string): Promise<ChatHistoryIndex> {
  return invoke<ChatHistoryIndex>("delete_chat_conversation_command", { id });
}

export async function exportChatConversation(
  id: string,
  format: "markdown" | "json",
  includeReasoning: boolean,
): Promise<string> {
  return invoke<string>("export_chat_conversation_command", { id, format, includeReasoning });
}

export async function clearChatHistory(): Promise<void> {
  await invoke("clear_chat_history_command");
}
