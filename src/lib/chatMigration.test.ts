import { describe, expect, it } from "vitest";
import { normalizeChatConversation, type LegacyChatConversationInput } from "./chatMigration";

describe("chat conversation migration", () => {
  it("adds v2.1 assistant defaults to an existing schema v1 conversation", () => {
    const legacy = {
      id: "conversation-1",
      schemaVersion: 1,
      title: "旧对话",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
      pinned: false,
      archived: false,
      messageCount: 0,
      lastMessagePreview: "",
      modelPath: null,
      modelName: null,
      systemPrompt: "",
      messages: [],
    } satisfies LegacyChatConversationInput;

    const normalized = normalizeChatConversation(legacy);

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.assistantMode).toBe("general");
    expect(normalized.compression.enabled).toBe(true);
    expect(normalized.memory.summary).toBe("");
    expect(normalized.memory.compressedMessageCount).toBe(0);
  });

  it("fills safe defaults for a partial conversation", () => {
    const normalized = normalizeChatConversation({ id: "conversation-2" });

    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.title).toBe("新对话");
    expect(normalized.createdAt).toEqual(expect.any(String));
    expect(normalized.updatedAt).toBe(normalized.createdAt);
    expect(normalized.pinned).toBe(false);
    expect(normalized.archived).toBe(false);
    expect(normalized.messageCount).toBe(0);
    expect(normalized.lastMessagePreview).toBe("");
    expect(normalized.modelPath).toBeNull();
    expect(normalized.modelName).toBeNull();
    expect(normalized.systemPrompt).toBe("");
    expect(normalized.messages).toEqual([]);
  });

  it("merges partial compression and memory settings with defaults", () => {
    const normalized = normalizeChatConversation({
      id: "conversation-3",
      compression: { enabled: false, preserveRecentTurns: 10 },
      memory: { summary: "旧摘要", compressedMessageCount: 4 },
    });

    expect(normalized.compression).toEqual({
      enabled: false,
      triggerRatio: 0.82,
      preserveRecentTurns: 10,
      maxSummaryTokens: 700,
    });
    expect(normalized.memory).toEqual({
      summary: "旧摘要",
      updatedAt: null,
      compressedMessageCount: 4,
      compressedThroughMessageId: null,
    });
  });

  it("falls back to general mode for invalid assistant modes", () => {
    const normalized = normalizeChatConversation({
      id: "conversation-4",
      assistantMode: "bad-mode",
    });

    expect(normalized.assistantMode).toBe("general");
  });

  it("migrates legacy message and attachment defaults", () => {
    const normalized = normalizeChatConversation({
      id: "conversation-5",
      createdAt: "2026-05-09T00:00:00.000Z",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "看图",
          attachments: [
            {
              id: "attachment-1",
              name: "screen.png",
              mimeType: "image/png",
              sizeBytes: 2048,
            },
          ],
        },
      ],
    });

    expect(normalized.messages[0]).toMatchObject({
      id: "message-1",
      role: "user",
      content: "看图",
      createdAt: "2026-05-09T00:00:00.000Z",
      status: "complete",
    });
    expect(normalized.messages[0].attachments?.[0]).toMatchObject({
      id: "attachment-1",
      dataUrl: "",
      persistence: "memory",
    });
  });

  it("returns independent compression and memory objects per normalization", () => {
    const first = normalizeChatConversation({ id: "conversation-6" });
    const second = normalizeChatConversation({ id: "conversation-7" });

    expect(first.compression).not.toBe(second.compression);
    expect(first.memory).not.toBe(second.memory);
  });
});
