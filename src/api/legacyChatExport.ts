import { invoke } from "@tauri-apps/api/core";

export async function exportLegacyChatHistory(): Promise<string> {
  return invoke<string>("export_legacy_chat_history_command");
}
