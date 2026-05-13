import type { ChatConversationSummary } from "../types/chat";

export type ConversationDateRangePreset = "all" | "today" | "7d" | "30d";

export function conversationMatchesDateRange(
  summary: ChatConversationSummary,
  preset: ConversationDateRangePreset,
): boolean {
  if (preset === "all") {
    return true;
  }
  const t = new Date(summary.updatedAt).getTime();
  if (!Number.isFinite(t)) {
    return true;
  }
  const now = Date.now();
  if (preset === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return t >= start.getTime();
  }
  if (preset === "7d") {
    return t >= now - 7 * 86400000;
  }
  if (preset === "30d") {
    return t >= now - 30 * 86400000;
  }
  return true;
}
