import { describe, expect, it } from "vitest";
import type { ChatAttachment, ChatConversation, ChatMessage } from "../types/chat";
import {
  buildCompressedRequestMessages,
  buildCompressionPrompt,
  mergeConversationMemory,
  selectMessagesForCompression,
} from "./conversationCompression";

function message(id: string, role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: "2026-05-09T00:00:00.000Z",
    status: "complete",
    ...extra,
  };
}

const attachment: ChatAttachment = {
  id: "attachment-1",
  name: "draft.png",
  mimeType: "image/png",
  sizeBytes: 42,
  dataUrl: "data:image/png;base64,abc",
  persistence: "memory",
};

type ConversationOverrides = Partial<Omit<ChatConversation, "compression" | "memory" | "messages">> & {
  compression?: Partial<ChatConversation["compression"]>;
  memory?: Partial<ChatConversation["memory"]>;
  messages?: ChatMessage[];
};

function conversation(overrides: ConversationOverrides = {}): ChatConversation {
  const base: ChatConversation = {
    id: "conversation-1",
    schemaVersion: 2,
    assistantMode: "analysis",
    title: "长对话",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    pinned: false,
    archived: false,
    messageCount: 8,
    lastMessagePreview: "最新问题",
    modelPath: null,
    modelName: null,
    systemPrompt: "",
    compression: {
      enabled: true,
      triggerRatio: 0.82,
      preserveRecentTurns: 2,
      maxSummaryTokens: 500,
    },
    memory: {
      summary: "此前记忆",
      updatedAt: "2026-05-09T00:00:00.000Z",
      compressedMessageCount: 2,
      compressedThroughMessageId: "m2",
    },
    messages: [
      message("m1", "user", "第一轮"),
      message("m2", "assistant", "第一答"),
      message("m3", "user", "第二轮"),
      message("m4", "assistant", "第二答"),
      message("m5", "user", "第三轮"),
      message("m6", "assistant", "第三答"),
      message("m7", "user", "最新问题", { attachments: [attachment] }),
      message("m8", "assistant", ""),
    ],
  };

  return {
    ...base,
    ...overrides,
    compression: { ...base.compression, ...overrides.compression },
    memory: { ...base.memory, ...overrides.memory },
    messages: overrides.messages ?? base.messages,
  };
}

describe("conversation compression", () => {
  it("selects older messages and preserves recent turns", () => {
    const selected = selectMessagesForCompression(conversation());

    expect(selected.compress.map((item) => item.id)).toEqual(["m3", "m4"]);
    expect(selected.preserve.map((item) => item.id)).toEqual(["m5", "m6", "m7", "m8"]);
  });

  it("starts from the beginning when compressed through id no longer exists", () => {
    const selected = selectMessagesForCompression(
      conversation({
        memory: { compressedThroughMessageId: "missing-message" },
      }),
    );

    expect(selected.compress.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(selected.preserve.map((item) => item.id)).toEqual(["m5", "m6", "m7", "m8"]);
  });

  it("only compresses complete non-empty messages while preserving the original suffix", () => {
    const selected = selectMessagesForCompression(
      conversation({
        messages: [
          message("m1", "user", "第一轮"),
          message("m2", "assistant", "第一答"),
          message("m3", "user", "第二轮"),
          message("m4", "assistant", ""),
          message("m5", "assistant", "还没完成", { status: "streaming" }),
          message("m6", "assistant", "第三答"),
          message("m7", "user", "最新问题"),
          message("m8", "assistant", ""),
        ],
        memory: { compressedThroughMessageId: null },
      }),
    );

    expect(selected.compress.map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
    expect(selected.preserve.map((item) => item.id)).toEqual(["m5", "m6", "m7", "m8"]);
  });

  it("builds a Chinese compression prompt without reasoning content", () => {
    const prompt = buildCompressionPrompt(conversation(), [
      message("m3", "user", "第二轮"),
      message("m4", "assistant", "第二答", { reasoningContent: "隐藏推理链" }),
    ]);

    expect(prompt).toContain("此前记忆");
    expect(prompt).toContain("第二轮");
    expect(prompt).toContain("保留：事实/决定/人物与设定/未解决问题");
    expect(prompt).toContain("不包含模型推理过程");
    expect(prompt).not.toContain("隐藏推理链");
  });

  it("merges generated memory into the conversation", () => {
    const merged = mergeConversationMemory(conversation(), " 新的压缩记忆 ", "m4", 2);

    expect(merged.memory.summary).toBe("新的压缩记忆");
    expect(merged.memory.updatedAt).not.toBeNull();
    expect(merged.memory.compressedThroughMessageId).toBe("m4");
    expect(merged.memory.compressedMessageCount).toBe(4);
  });

  it("injects memory before preserved messages and keeps user attachments", () => {
    const messages = buildCompressedRequestMessages(conversation(), [
      message("system-1", "system", "临时系统消息"),
      message("m7", "user", "最新问题", { attachments: [attachment] }),
    ]);

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("长期对话记忆");
    expect(messages[1]).toEqual({
      role: "user",
      content: "最新问题",
      attachments: [attachment],
    });
    expect(messages).toHaveLength(2);
  });

  it("does not include incomplete preserved assistant messages in requests", () => {
    const messages = buildCompressedRequestMessages(conversation(), [
      message("m7", "user", "最新问题"),
      message("m8", "assistant", "正在生成", { status: "streaming" }),
      message("m9", "assistant", "失败回答", { status: "failed" }),
      message("m10", "assistant", "取消回答", { status: "cancelled" }),
      message("m11", "assistant", "完成回答"),
    ]);

    expect(messages.map((item) => item.content)).toEqual([
      "长期对话记忆：\n此前记忆",
      "最新问题",
      "完成回答",
    ]);
  });

  it("does not inject a memory system message when summary is empty", () => {
    const messages = buildCompressedRequestMessages(
      conversation({ memory: { summary: "   " } }),
      [message("m7", "user", "最新问题")],
    );

    expect(messages).toEqual([{ role: "user", content: "最新问题", attachments: undefined }]);
  });

  it("preserves at least two messages when preserveRecentTurns is zero or negative", () => {
    const zero = selectMessagesForCompression(
      conversation({
        compression: { preserveRecentTurns: 0 },
        memory: { compressedThroughMessageId: null },
      }),
    );
    const negative = selectMessagesForCompression(
      conversation({
        compression: { preserveRecentTurns: -3 },
        memory: { compressedThroughMessageId: null },
      }),
    );

    expect(zero.compress.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(zero.preserve.map((item) => item.id)).toEqual(["m7", "m8"]);
    expect(negative.compress.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(negative.preserve.map((item) => item.id)).toEqual(["m7", "m8"]);
  });

  it("preserves all messages when preserveRecentTurns exceeds the message list", () => {
    const selected = selectMessagesForCompression(
      conversation({
        compression: { preserveRecentTurns: 100 },
        memory: { compressedThroughMessageId: null },
      }),
    );

    expect(selected.compress).toEqual([]);
    expect(selected.preserve.map((item) => item.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);
  });
});
