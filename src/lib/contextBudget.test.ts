import { describe, expect, it } from "vitest";
import { createConversationTitle } from "./chatTitle";
import { buildContextWindow, calculateContextUsageRatio, estimateTokenCount, suggestMaxOutputTokensHint } from "./contextBudget";

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

  it("prefers keeping code block messages when budget is tight", () => {
    const result = buildContextWindow({
      systemPrompt: "",
      messages: [
        {
          id: "plain",
          role: "assistant",
          content: "plain ".repeat(40),
          createdAt: "1",
          status: "complete",
        },
        {
          id: "code",
          role: "assistant",
          content: "```ts\nexport const x = 1;\n```\n" + "hint ".repeat(15),
          createdAt: "2",
          status: "complete",
        },
        {
          id: "latest",
          role: "user",
          content: "latest question " + "q ".repeat(10),
          createdAt: "3",
          status: "complete",
        },
      ],
      // Budget should allow keeping either `plain` or `code` plus the newest user message, but not both.
      contextSize: 120,
      maxTokens: 60,
    });

    const keptIds = result.messages.map((m) => m.id);
    expect(keptIds).toContain("latest");
    expect(keptIds).toContain("code");
    expect(keptIds).not.toContain("plain");
  });

  it("prefers keeping messages with attachments when budget is tight", () => {
    const result = buildContextWindow({
      systemPrompt: "",
      messages: [
        {
          id: "no-attachment",
          role: "assistant",
          content: "context ".repeat(250),
          createdAt: "1",
          status: "complete",
        },
        {
          id: "with-attachment",
          role: "user",
          content: "see attached image",
          attachments: [
            {
              id: "att-1",
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 10_000,
              dataUrl: "data:image/png;base64,AAAA",
              persistence: "memory",
            },
          ],
          createdAt: "2",
          status: "complete",
        },
        {
          id: "latest",
          role: "user",
          content: "latest request " + "r ".repeat(10),
          createdAt: "3",
          status: "complete",
        },
      ],
      // Budget should allow one extra message besides the latest user message.
      contextSize: 520,
      maxTokens: 60,
    });

    const keptIds = result.messages.map((m) => m.id);
    expect(keptIds).toContain("latest");
    expect(keptIds).toContain("with-attachment");
    expect(keptIds).not.toContain("no-attachment");
  });

  it("calculates context usage ratio for zero, over budget, and normal cases", () => {
    expect(calculateContextUsageRatio(10, 0)).toBe(1);
    expect(calculateContextUsageRatio(120, 100)).toBe(1);
    expect(calculateContextUsageRatio(25, 100)).toBe(0.25);
  });

  it("suggestMaxOutputTokensHint caps output when prompt dominates ctx", () => {
    const suggested = suggestMaxOutputTokensHint({
      contextSize: 4096,
      estimatedPromptTokens: 3500,
      currentMaxTokens: 1024,
    });
    expect(suggested).toBeLessThanOrEqual(1024);
    expect(suggested).toBeGreaterThanOrEqual(64);
  });
});
