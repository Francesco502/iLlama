import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeChatCompletion, streamChatCompletion } from "../api/chat";
import { defaultSampling } from "../lib/parameterSchema";
import { normalizeChatConversation } from "../lib/chatMigration";
import type { ChatConversation } from "../types/chat";
import { useChatGeneration } from "./useChatGeneration";

vi.mock("../api/chat", async () => {
  const actual = await vi.importActual<typeof import("../api/chat")>("../api/chat");
  return {
    ...actual,
    completeChatCompletion: vi.fn(),
    streamChatCompletion: vi.fn(),
  };
});

const baseConversation: ChatConversation = normalizeChatConversation({
  id: "conversation-1",
  schemaVersion: 1,
  title: "测试对话",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
  pinned: false,
  archived: false,
  messageCount: 0,
  lastMessagePreview: "",
  modelPath: "/models/qwen.gguf",
  modelName: "qwen.gguf",
  systemPrompt: "",
  messages: [],
});

function setupHook({
  conversation = baseConversation,
  contextSize = 4096,
  saveConversation = vi.fn(async () => undefined),
}: {
  conversation?: ChatConversation;
  contextSize?: number;
  saveConversation?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    saveConversation,
    ...renderHook(() =>
      useChatGeneration({
        port: 8080,
        sampling: defaultSampling,
        contextSize,
        modelPath: "/models/qwen.gguf",
        modelName: "qwen.gguf",
        activeConversation: conversation,
        saveConversation,
        appendSystemLog: vi.fn(),
      }),
    ),
  };
}

function lastSavedConversation(saveConversation: ReturnType<typeof vi.fn>): ChatConversation {
  const calls = saveConversation.mock.calls as unknown as Array<[ChatConversation]>;
  const saved = calls.at(-1)?.[0];
  expect(saved).toBeDefined();
  return saved as ChatConversation;
}

function message(
  id: string,
  role: "user" | "assistant",
  content: string,
  extra: Partial<ChatConversation["messages"][number]> = {},
): ChatConversation["messages"][number] {
  return {
    id,
    role,
    content,
    createdAt: "2026-05-09T00:00:00.000Z",
    status: "complete",
    ...extra,
  };
}

type ConversationOverrides = Partial<Omit<ChatConversation, "compression" | "memory">> & {
  compression?: Partial<ChatConversation["compression"]>;
  memory?: Partial<ChatConversation["memory"]>;
};

function conversation(overrides: ConversationOverrides = {}): ChatConversation {
  return normalizeChatConversation({
    ...baseConversation,
    ...overrides,
    compression: {
      ...baseConversation.compression,
      ...overrides.compression,
    },
    memory: {
      ...baseConversation.memory,
      ...overrides.memory,
    },
    messages: overrides.messages ?? baseConversation.messages,
  });
}

describe("useChatGeneration", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.mocked(completeChatCompletion).mockResolvedValue({
      content: "压缩后的长期记忆",
      reasoningContent: "压缩推理不应保存",
    });
    vi.mocked(streamChatCompletion).mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("streams reasoning and visible content into the assistant message", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async ({ onDelta }) => {
      onDelta?.({ contentDelta: "", reasoningDelta: "先想一下" });
      onDelta?.({ contentDelta: "最终答案", reasoningDelta: "" });
    });
    const { result, saveConversation } = setupHook();

    await act(async () => {
      await result.current.sendMessage({ text: "你好", attachments: [] });
    });

    const saved = lastSavedConversation(saveConversation);
    expect(saved.messages[0]).toMatchObject({ role: "user", content: "你好" });
    expect(saved.messages[1]).toMatchObject({
      role: "assistant",
      content: "最终答案",
      reasoningContent: "先想一下",
      status: "complete",
    });
  });

  it("marks the assistant message as failed when streaming throws", async () => {
    vi.mocked(streamChatCompletion).mockRejectedValue(new Error("boom"));
    const appendSystemLog = vi.fn();
    const saveConversation = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useChatGeneration({
        port: 8080,
        sampling: defaultSampling,
        contextSize: 4096,
        modelPath: "/models/qwen.gguf",
        modelName: "qwen.gguf",
        activeConversation: baseConversation,
        saveConversation,
        appendSystemLog,
      }),
    );

    await act(async () => {
      await result.current.sendMessage({ text: "你好", attachments: [] });
    });

    const saved = lastSavedConversation(saveConversation);
    expect(saved.messages[1]).toMatchObject({ status: "failed", error: "boom" });
    expect(appendSystemLog).toHaveBeenCalledWith("boom");
  });

  it("keeps generated token stats when streaming fails after a delta", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1500)
      .mockReturnValueOnce(2000);
    vi.mocked(streamChatCompletion).mockImplementation(async ({ onDelta }) => {
      onDelta?.({ contentDelta: "部分回答", reasoningDelta: "" });
      throw new Error("boom after token");
    });
    const { result, saveConversation } = setupHook();

    await act(async () => {
      await result.current.sendMessage({ text: "你好", attachments: [] });
    });

    const saved = lastSavedConversation(saveConversation);
    const stats = saved.messages[1].stats;
    expect(stats).toBeDefined();
    // 当前阶段还不会注入真实 usage：这里验证字段“存在且可读”，并允许 undefined → 视为 null
    expect(stats?.promptTokens ?? null).toBeNull();
    expect(stats?.completionTokens ?? null).toBeNull();
    expect(stats?.totalTokens ?? null).toBeNull();
    expect(saved.messages[1]).toMatchObject({
      status: "failed",
      content: "部分回答",
      stats: expect.objectContaining({
        generatedTokens: expect.any(Number),
        tokensPerSecond: expect.any(Number),
      }),
    });
    expect(saved.messages[1].stats?.generatedTokens ?? 0).toBeGreaterThan(0);
  });

  it("persists usage stats when stream deltas include usage", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async ({ onDelta }) => {
      onDelta?.({ contentDelta: "最终答案", reasoningDelta: "" });
      // Usage is typically emitted as a trailing delta without text.
      onDelta?.({
        contentDelta: "",
        reasoningDelta: "",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      });
    });
    const { result, saveConversation } = setupHook();

    await act(async () => {
      await result.current.sendMessage({ text: "你好", attachments: [] });
    });

    const saved = lastSavedConversation(saveConversation);
    expect(saved.messages[1]).toMatchObject({
      role: "assistant",
      status: "complete",
      content: "最终答案",
      stats: expect.objectContaining({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        generatedTokens: 20,
      }),
    });
  });

  it("marks the assistant message as cancelled when generation is aborted", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(
      ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const { result, saveConversation } = setupHook();

    await act(async () => {
      const pending = result.current.sendMessage({ text: "你好", attachments: [] });
      result.current.cancelGeneration();
      await pending;
    });

    const saved = lastSavedConversation(saveConversation);
    expect(saved.messages[1]).toMatchObject({ status: "cancelled" });
  });

  it("compresses older messages before streaming when the request is over the trigger ratio", async () => {
    const longText = "重要设定 ".repeat(400);
    const active = conversation({
      compression: { enabled: true, triggerRatio: 0.01, preserveRecentTurns: 1, maxSummaryTokens: 321 },
      messages: [
        message("m1", "user", longText),
        message("m2", "assistant", "早期回答"),
        message("m3", "user", "最新问题"),
      ],
    });
    const { result, saveConversation } = setupHook({ conversation: active, contextSize: 4096 });

    await act(async () => {
      await result.current.sendMessage({ text: "继续", attachments: [] });
    });

    expect(vi.mocked(completeChatCompletion).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(streamChatCompletion).mock.invocationCallOrder[0],
    );
    expect(completeChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 8080,
        sampling: expect.objectContaining({
          temperature: expect.any(Number),
          maxTokens: 321,
        }),
      }),
    );
    expect(vi.mocked(completeChatCompletion).mock.calls[0][0].sampling.temperature).toBeLessThanOrEqual(0.2);
    expect(saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: expect.objectContaining({
          summary: "压缩后的长期记忆",
          compressedThroughMessageId: "m3",
          compressedMessageCount: 3,
        }),
      }),
    );
    expect(vi.mocked(streamChatCompletion).mock.calls[0][0].messages[1]).toMatchObject({
      role: "system",
      content: expect.stringContaining("长期对话记忆：\n压缩后的长期记忆"),
    });
  });

  it("compresses when prompt budget ratio exceeds the trigger even if total context ratio does not", async () => {
    const active = conversation({
      compression: { enabled: true, triggerRatio: 0.82, preserveRecentTurns: 1 },
      messages: [
        message("m1", "user", "重要设定 ".repeat(600)),
        message("m2", "assistant", "早期回答"),
        message("m3", "user", "最新问题"),
      ],
    });
    const { result } = setupHook({ conversation: active, contextSize: 4096 });

    await act(async () => {
      await result.current.sendMessage({ text: "继续", attachments: [] });
    });

    expect(completeChatCompletion).toHaveBeenCalledTimes(1);
    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("does not compress when the estimated request is under the trigger ratio", async () => {
    const active = conversation({
      compression: { enabled: true, triggerRatio: 0.99, preserveRecentTurns: 1 },
      messages: [message("m1", "user", "短问题")],
    });
    const { result } = setupHook({ conversation: active });

    await act(async () => {
      await result.current.sendMessage({ text: "继续", attachments: [] });
    });

    expect(completeChatCompletion).not.toHaveBeenCalled();
    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("includes memory summary in request messages", async () => {
    const active = conversation({
      memory: { summary: "用户正在写赛博朋克小说。" },
    });
    const { result } = setupHook({ conversation: active });

    await act(async () => {
      await result.current.sendMessage({ text: "继续上一章", attachments: [] });
    });

    expect(vi.mocked(streamChatCompletion).mock.calls[0][0].messages[1]).toMatchObject({
      role: "system",
      content: "长期对话记忆：\n用户正在写赛博朋克小说。",
    });
  });

  it("includes the assistant profile system prompt in request messages", async () => {
    const active = conversation({
      assistantMode: "coding",
      systemPrompt: "回答保持简短。",
    });
    const { result } = setupHook({ conversation: active });

    await act(async () => {
      await result.current.sendMessage({ text: "解释这个错误", attachments: [] });
    });

    expect(vi.mocked(streamChatCompletion).mock.calls[0][0].messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("你是本地代码助手"),
    });
    expect(vi.mocked(streamChatCompletion).mock.calls[0][0].messages[0].content).toContain(
      "用户自定义指令：\n回答保持简短。",
    );
  });

  it("does not send the streaming assistant placeholder back to the model", async () => {
    const { result } = setupHook();

    await act(async () => {
      await result.current.sendMessage({ text: "你好", attachments: [] });
    });

    expect(vi.mocked(streamChatCompletion).mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user", content: "你好" }),
    ]);
  });

  it("does not advance compression memory when the summarizer returns only reasoning content", async () => {
    vi.mocked(completeChatCompletion).mockResolvedValue({
      content: "",
      reasoningContent: "内部推理不应保存为长期记忆",
    });
    const active = conversation({
      compression: { enabled: true, triggerRatio: 0.01, preserveRecentTurns: 1, maxSummaryTokens: 321 },
      messages: [
        message("m1", "user", "重要设定 ".repeat(400)),
        message("m2", "assistant", "早期回答"),
        message("m3", "user", "最新问题"),
      ],
    });
    const { result, saveConversation } = setupHook({ conversation: active, contextSize: 4096 });

    await act(async () => {
      await result.current.sendMessage({ text: "继续", attachments: [] });
    });

    expect(completeChatCompletion).toHaveBeenCalledTimes(1);
    expect(streamChatCompletion).toHaveBeenCalledTimes(1);
    expect(saveConversation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        memory: expect.objectContaining({
          compressedThroughMessageId: expect.any(String),
        }),
      }),
    );
    expect(vi.mocked(streamChatCompletion).mock.calls[0][0].messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("内部推理"),
        }),
      ]),
    );
  });

  it("does not run compression in browser preview mode", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const active = conversation({
      compression: { enabled: true, triggerRatio: 0.01, preserveRecentTurns: 1 },
      messages: [
        message("m1", "user", "旧内容 ".repeat(400)),
        message("m2", "assistant", "旧回答"),
      ],
    });
    const { result } = setupHook({ conversation: active });

    await act(async () => {
      await result.current.sendMessage({ text: "继续", attachments: [] });
    });

    expect(completeChatCompletion).not.toHaveBeenCalled();
    expect(streamChatCompletion).not.toHaveBeenCalled();
  });

  it("manually compresses the active conversation without streaming a visible assistant answer", async () => {
    const active = conversation({
      compression: { enabled: true, preserveRecentTurns: 1, maxSummaryTokens: 123 },
      messages: [
        message("m1", "user", "旧设定 ".repeat(20)),
        message("m2", "assistant", "旧回答"),
        message("m3", "user", "保留的问题"),
        message("m4", "assistant", "保留的回答"),
      ],
    });
    const { result, saveConversation } = setupHook({ conversation: active });

    await act(async () => {
      await result.current.compressActiveConversation();
    });

    expect(completeChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 8080,
        messages: [
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("旧设定"),
          }),
        ],
        sampling: expect.objectContaining({
          maxTokens: 123,
        }),
      }),
    );
    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: active.messages,
        memory: expect.objectContaining({
          summary: "压缩后的长期记忆",
          compressedThroughMessageId: "m2",
          compressedMessageCount: 2,
        }),
      }),
    );
  });

  it("does not manually compress when there is no eligible message", async () => {
    const active = conversation({
      compression: { enabled: true, preserveRecentTurns: 1 },
      messages: [message("m1", "user", "太近了"), message("m2", "assistant", "保留")],
    });
    const { result, saveConversation } = setupHook({ conversation: active });

    await act(async () => {
      await result.current.compressActiveConversation();
    });

    expect(completeChatCompletion).not.toHaveBeenCalled();
    expect(streamChatCompletion).not.toHaveBeenCalled();
    expect(saveConversation).not.toHaveBeenCalled();
  });
});
