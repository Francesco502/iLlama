import { describe, expect, it } from "vitest";
import { createConversationTitle } from "./chatTitle";
import { buildContextWindow, estimateTokenCount } from "./contextBudget";

describe("chat title helpers", () => {
  it("creates a short title from the first user message", () => {
    expect(createConversationTitle("请帮我写一个 Rust 文件存储方案，要求安全可靠")).toBe(
      "请帮我写一个 Rust 文件存储方案",
    );
  });

  it("falls back when the message has no useful text", () => {
    expect(createConversationTitle("   **   ")).toBe("新对话");
  });
});

describe("context budget helpers", () => {
  it("estimates cjk and ascii text without returning zero", () => {
    expect(estimateTokenCount("hello world 你好")).toBeGreaterThan(3);
  });

  it("keeps newest user message when trimming context", () => {
    const result = buildContextWindow({
      systemPrompt: "你是助手",
      messages: [
        {
          id: "old",
          role: "user",
          content: "旧消息".repeat(100),
          createdAt: "1",
          status: "complete",
        },
        {
          id: "new",
          role: "user",
          content: "最新问题",
          createdAt: "2",
          status: "complete",
        },
      ],
      contextSize: 64,
      maxTokens: 16,
    });

    expect(result.messages.at(-1)?.id).toBe("new");
    expect(result.trimmedMessageCount).toBe(1);
  });
});
