import { describe, expect, it } from "vitest";
import { normalizeChatConversation } from "./chatMigration";
import { buildSearchHaystack } from "./conversationSearchHaystack";

describe("buildSearchHaystack", () => {
  it("joins title and message excerpts lowercased", () => {
    const conv = normalizeChatConversation({
      id: "c1",
      schemaVersion: 2,
      title: "Alpha",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pinned: false,
      archived: false,
      messageCount: 1,
      lastMessagePreview: "",
      modelPath: null,
      modelName: null,
      assistantMode: "general",
      systemPrompt: "",
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
          content: "BetaCode",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "complete",
        },
      ],
    });
    const h = buildSearchHaystack(conv);
    expect(h).toContain("alpha");
    expect(h).toContain("betacode");
  });
});
