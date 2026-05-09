import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChatCompletion } from "../api/chat";
import { defaultSampling } from "../lib/parameterSchema";
import type { ChatConversation } from "../types/chat";
import { useChatGeneration } from "./useChatGeneration";

vi.mock("../api/chat", async () => {
  const actual = await vi.importActual<typeof import("../api/chat")>("../api/chat");
  return {
    ...actual,
    streamChatCompletion: vi.fn(),
  };
});

const baseConversation: ChatConversation = {
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
};

function setupHook(saveConversation = vi.fn(async () => undefined)) {
  return {
    saveConversation,
    ...renderHook(() =>
      useChatGeneration({
        port: 8080,
        sampling: defaultSampling,
        contextSize: 4096,
        modelPath: "/models/qwen.gguf",
        modelName: "qwen.gguf",
        activeConversation: baseConversation,
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

describe("useChatGeneration", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
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
});
