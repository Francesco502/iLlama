import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearChatHistory,
  deleteChatConversation,
  loadChatConversation,
  loadChatHistoryIndex,
  saveChatConversation,
} from "../api/chatHistory";
import type { LegacyChatConversationInput } from "../lib/chatMigration";
import type { ChatConversation, ChatConversationSummary } from "../types/chat";
import { useChatWorkspace } from "./useChatWorkspace";

vi.mock("../api/chatHistory", () => ({
  clearChatHistory: vi.fn(),
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

const conversation = {
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
    {
      id: "message-2",
      role: "assistant",
      content: "你好，有什么可以帮你？",
      createdAt: "2026-05-09T00:01:00.000Z",
      status: "complete",
    },
  ],
} satisfies LegacyChatConversationInput;

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
    vi.mocked(loadChatConversation).mockResolvedValue(conversation as unknown as ChatConversation);
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
    vi.mocked(clearChatHistory).mockResolvedValue(undefined);
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
    expect(created.schemaVersion).toBe(2);
    expect(created.assistantMode).toBe("general");
    expect(created.compression.enabled).toBe(true);
    expect(created.memory.summary).toBe("");
    expect(result.current.activeConversation?.id).toBe(created.id);
    expect(saveChatConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: created.id,
        modelPath: "/models/qwen.gguf",
        modelName: "qwen.gguf",
      }),
    );
  });

  it("stores only thumbnails when image history is set to thumbnail mode", async () => {
    const { result } = renderHook(() =>
      useChatWorkspace({
        historyEnabled: true,
        imagePersistence: "thumbnail",
      } as Parameters<typeof useChatWorkspace>[0] & { imagePersistence: "thumbnail" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveConversation({
        ...conversation,
        messages: [
          {
            id: "image-message",
            role: "user",
            content: "看图",
            createdAt: "2026-05-09T00:00:00.000Z",
            status: "complete",
            attachments: [
              {
                id: "attachment-1",
                name: "screen.png",
                mimeType: "image/png",
                sizeBytes: 2048,
                dataUrl: "data:image/png;base64,full",
                thumbnailUrl: "data:image/webp;base64,thumb",
                persistence: "thumbnail",
              },
            ],
          },
        ],
      });
    });

    expect(saveChatConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            attachments: [
              expect.objectContaining({
                dataUrl: "",
                thumbnailUrl: "data:image/webp;base64,thumb",
                persistence: "thumbnail",
              }),
            ],
          }),
        ],
      }),
    );
    await act(async () => {
      await result.current.selectConversation("conversation-1");
    });
    expect(result.current.activeConversation?.schemaVersion).toBe(2);
    expect(result.current.activeConversation?.assistantMode).toBe("general");
    expect(result.current.activeConversation?.compression.enabled).toBe(true);
    expect(result.current.activeConversation?.memory.summary).toBe("");
    expect(result.current.activeConversation?.messages[0].attachments?.[0].dataUrl).toBe(
      "data:image/png;base64,full",
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

  it("deletes a user and its assistant response as a message pair", async () => {
    const { result } = renderHook(() => useChatWorkspace({ historyEnabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.selectConversation("conversation-1");
    });

    await act(async () => {
      await result.current.deleteMessagePair("message-1");
    });

    expect(result.current.activeConversation?.messages).toEqual([]);
    expect(saveChatConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "conversation-1",
        messageCount: 0,
        lastMessagePreview: "",
        messages: [],
      }),
    );
  });

  it("clears persisted history and in-memory cache", async () => {
    const { result } = renderHook(() => useChatWorkspace({ historyEnabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.selectConversation("conversation-1");
    });

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(clearChatHistory).toHaveBeenCalled();
    expect(result.current.conversations).toEqual([]);
    expect(result.current.activeConversation).toBeNull();
  });

  it("still clears persisted history after history has been disabled", async () => {
    const { result } = renderHook(() => useChatWorkspace({ historyEnabled: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(clearChatHistory).toHaveBeenCalled();
  });
});
