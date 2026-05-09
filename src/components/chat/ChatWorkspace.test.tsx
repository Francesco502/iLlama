import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatConversation, ChatConversationSummary } from "../../types/chat";
import type { ModelEntry } from "../../types/domain";
import { ChatWorkspace } from "./ChatWorkspace";

const selectedModel: ModelEntry = {
  path: "/models/qwen.gguf",
  fileName: "qwen.gguf",
  directory: "/models",
  sizeBytes: 1024,
  modifiedAt: "2026-05-09T00:00:00.000Z",
  metadataStatus: "ready",
  available: true,
  mmprojCandidates: [],
};

const summaries: ChatConversationSummary[] = [
  {
    id: "conversation-1",
    title: "Rust 存储方案",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:02:00.000Z",
    pinned: false,
    archived: false,
    messageCount: 2,
    lastMessagePreview: "可以这样设计",
    modelPath: "/models/qwen.gguf",
    modelName: "qwen.gguf",
  },
  {
    id: "conversation-2",
    title: "前端界面",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:01:00.000Z",
    pinned: false,
    archived: false,
    messageCount: 1,
    lastMessagePreview: "布局建议",
    modelPath: "/models/qwen.gguf",
    modelName: "qwen.gguf",
  },
];

const activeConversation: ChatConversation = {
  ...summaries[0],
  schemaVersion: 1,
  systemPrompt: "",
  messages: [
    {
      id: "message-1",
      role: "user",
      content: "怎么做？",
      createdAt: "2026-05-09T00:00:00.000Z",
      status: "complete",
    },
    {
      id: "message-2",
      role: "assistant",
      content: "可以这样设计。",
      reasoningContent: "先分析存储边界。",
      createdAt: "2026-05-09T00:01:00.000Z",
      status: "complete",
    },
  ],
};

function renderWorkspace(overrides: Partial<Parameters<typeof ChatWorkspace>[0]> = {}) {
  const props: Parameters<typeof ChatWorkspace>[0] = {
    runtimeStatus: "healthy",
    selectedModel,
    conversations: summaries,
    activeConversation,
    streaming: false,
    streamTokensPerSecond: null,
    onCreateConversation: vi.fn(async () => activeConversation),
    onSelectConversation: vi.fn(),
    onSaveConversation: vi.fn(),
    onRenameConversation: vi.fn(),
    onDeleteConversation: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onRegenerate: vi.fn(),
    onEditAndResend: vi.fn(),
    ...overrides,
  };
  return { props, user: userEvent.setup(), ...render(<ChatWorkspace {...props} />) };
}

describe("ChatWorkspace", () => {
  it("creates a new conversation", async () => {
    const { user, props } = renderWorkspace();

    await user.click(screen.getByRole("button", { name: "新建对话" }));

    expect(props.onCreateConversation).toHaveBeenCalled();
  });

  it("filters conversations by search query", async () => {
    const { user } = renderWorkspace();

    await user.type(screen.getByLabelText("搜索对话"), "前端");

    const sidebar = within(screen.getByLabelText("历史对话"));
    expect(sidebar.queryByText("Rust 存储方案")).not.toBeInTheDocument();
    expect(sidebar.getByText("前端界面")).toBeInTheDocument();
  });

  it("selects a conversation from the sidebar", async () => {
    const { user, props } = renderWorkspace();

    await user.click(screen.getByRole("button", { name: "前端界面" }));

    expect(props.onSelectConversation).toHaveBeenCalledWith("conversation-2");
  });

  it("toggles assistant reasoning visibility", async () => {
    const { user } = renderWorkspace();

    expect(screen.queryByText("先分析存储边界。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /思考过程/ }));

    expect(screen.getByText("先分析存储边界。")).toBeInTheDocument();
  });

  it("disables the composer when runtime is stopped", () => {
    renderWorkspace({ runtimeStatus: "stopped" });

    expect(screen.getByLabelText("输入消息")).toBeDisabled();
  });

  it("sends with platform submit shortcut", async () => {
    const onSend = vi.fn();
    const { user } = renderWorkspace({ onSend });

    await user.type(screen.getByLabelText("输入消息"), "你好{Meta>}{Enter}{/Meta}");

    expect(onSend).toHaveBeenCalledWith({ text: "你好", attachments: [] });
  });
});
