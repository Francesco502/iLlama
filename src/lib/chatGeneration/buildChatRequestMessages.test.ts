import { describe, expect, it } from "vitest";
import { normalizeChatConversation } from "../chatMigration";
import { buildRequestMessages } from "./buildChatRequestMessages";

describe("buildChatRequestMessages", () => {
  it("includes system prompt and user message in order", () => {
    const conv = normalizeChatConversation({
      id: "c1",
      schemaVersion: 2,
      title: "t",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pinned: false,
      archived: false,
      messageCount: 1,
      lastMessagePreview: "",
      modelPath: null,
      modelName: null,
      assistantMode: "general",
      systemPrompt: "你是助手。",
      compression: {
        enabled: false,
        triggerRatio: 0.85,
        preserveRecentTurns: 4,
        maxSummaryTokens: 512,
      },
      memory: { summary: "", compressedMessageCount: 0 },
      messages: [
        {
          id: "u1",
          role: "user",
          content: "你好",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "complete",
        },
      ],
    });
    const msgs = buildRequestMessages(conv, 4096, 256);
    expect(msgs[0]?.role).toBe("system");
    expect(msgs[0]?.content).toContain("你是助手");
    expect(msgs.some((m) => m.role === "user" && m.content === "你好")).toBe(true);
  });
});
