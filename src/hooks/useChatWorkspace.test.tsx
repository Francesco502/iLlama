import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteChatConversation,
  loadChatConversation,
  loadChatHistoryIndex,
  saveChatConversation,
} from "../api/chatHistory";
import type { ChatConversation, ChatConversationSummary } from "../types/chat";
import { useChatWorkspace } from "./useChatWorkspace";

vi.mock("../api/chatHistory", () => ({
  deleteChatConversation: vi.fn(),
  loadChatConversation: vi.fn(),
  loadChatHistoryIndex: vi.fn(),
  saveChatConversation: vi.fn(),
}));

const summary: ChatConversationSummary = {
  id: "conversation-1",
  title: "已有对话",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:01:00.000Z",
  pinned: false,
  archived: false,
  messageCount: 1,
  lastMessagePreview: "你好",
  modelPath: "/models/qwen.gguf",
  modelName: "qwen.gguf",
};

const conversation: ChatConversation = {
  ...summary,
  schemaVersion: 1,
  systemPrompt: "",
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "你好",
      createdAt: "2026-05-09T00:00:00.000Z",
      status: "complete",
    },
  ],
};

describe("useChatWorkspace", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.mocked(loadChatHistoryIndex).mockResolvedValue({
      schemaVersion: 1,
      conversations: [summary],
    });
    vi.mocked(loadChatConversation).mockResolvedValue(conversation);
    vi.mocked(saveChatConversation).mockImplementation(async (next) => ({
      schemaVersion: 1,
      conversations: [
        {
          id: next.id,
          title: next.title,
          createdAt: next.createdAt,
          updatedAt: next.updatedAt,
          pinned: next.pinned,
          archived: next.archived,
          messageCount: next.messages.length,
          lastMessagePreview: next.lastMessagePreview,
          modelPath: next.modelPath,
          modelName: next.modelName,
        },
      ],
    }));
    vi.mocked(deleteChatConversation).mockResolvedValue({
      schemaVersion: 1,
      conversations: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("loads the conversation index on mount", async () => {
    const { result } = renderHook(() => useChatWorkspace({ historyEnabled: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loadChatHistoryIndex).toHaveBeenCalled();
    expect(result.current.conversations).toEqual([summary]);
  });

  it("creates and selects a new conversation", async () => {
    const { result } = renderHook(() =>
      useChatWorkspace({
        historyEnabled: true,
        modelPath: "/models/qwen.gguf",
        modelName: "qwen.gguf",
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created!: ChatConversation;
    await act(async () => {
      created = await result.current.createConversation();
    });

    expect(created.title).toBe("新对话");
    expect(result.current.activeConversation?.id).toBe(created.id);
    expect(saveChatConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: created.id,
        modelPath: "/models/qwen.gguf",
        modelName: "qwen.gguf",
      }),
    );
  });

  it("renames the active conversation", async () => {
    const { result } = renderHook(() => useChatWorkspace({ historyEnabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.selectConversation("conversation-1");
    });

    await act(async () => {
      await result.current.renameConversation("conversation-1", "新标题");
    });

    expect(result.current.activeConversation?.title).toBe("新标题");
    expect(saveChatConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "conversation-1", title: "新标题" }),
    );
  });

  it("uses in-memory mode when history is disabled", async () => {
    const { result } = renderHook(() => useChatWorkspace({ historyEnabled: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createConversation();
    });

    expect(loadChatHistoryIndex).not.toHaveBeenCalled();
    expect(saveChatConversation).not.toHaveBeenCalled();
    expect(result.current.conversations).toHaveLength(1);
  });

  it("deletes the active conversation and clears selection when no conversations remain", async () => {
    const { result } = renderHook(() => useChatWorkspace({ historyEnabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.selectConversation("conversation-1");
    });

    await act(async () => {
      await result.current.deleteConversation("conversation-1");
    });

    expect(deleteChatConversation).toHaveBeenCalledWith("conversation-1");
    expect(result.current.conversations).toEqual([]);
    expect(result.current.activeConversation).toBeNull();
  });
});
