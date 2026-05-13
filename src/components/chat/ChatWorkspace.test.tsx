import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatHistorySettings } from "../../api/tauri";
import { normalizeChatConversation } from "../../lib/chatMigration";
import type { ChatConversation, ChatConversationSummary } from "../../types/chat";
import type { ModelEntry, RuntimeMetrics } from "../../types/domain";
import { ChatWorkspace } from "./ChatWorkspace";

const idleMetrics: RuntimeMetrics = {
  cpuPercent: null,
  memoryBytes: null,
  tokensPerSecond: null,
  promptTokensPerSecond: null,
  kvCacheUsageRatio: null,
};

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

const activeConversation: ChatConversation = normalizeChatConversation({
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
});

const chatHistory: ChatHistorySettings = {
  enabled: true,
  imagePersistence: "thumbnail",
  includeReasoningInExportDefault: false,
  maxConversations: 200,
};

function renderWorkspace(overrides: Partial<Parameters<typeof ChatWorkspace>[0]> = {}) {
  const props: Parameters<typeof ChatWorkspace>[0] = {
    runtimeStatus: "healthy",
    selectedModel,
    ctxSize: 4096,
    samplingMaxTokens: 512,
    conversations: summaries,
    activeConversation,
    chatHistory,
    streaming: false,
    streamTokensPerSecond: null,
    runtimeMetrics: idleMetrics,
    onCreateConversation: vi.fn(async () => activeConversation),
    onSelectConversation: vi.fn(),
    onSaveConversation: vi.fn(),
    onCompressNow: undefined,
    onRenameConversation: vi.fn(),
    onSetPinned: vi.fn(),
    onSetArchived: vi.fn(),
    onDeleteConversation: vi.fn(),
    onDeleteMessage: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onRegenerate: vi.fn(),
    onEditAndResend: vi.fn(),
    onContinueAssistant: vi.fn(),
    onOpenSamplingTab: vi.fn(),
    onChatHistoryChange: vi.fn(),
    onClearHistory: vi.fn(),
    onExportConversation: vi.fn(),
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

  it("shows KV cache warning when usage ratio is high", () => {
    renderWorkspace({
      runtimeMetrics: {
        ...idleMetrics,
        kvCacheUsageRatio: 0.93,
      },
    });
    expect(screen.getByText(/KV 缓存占用/)).toBeInTheDocument();
  });

  it("offers apply suggested maxTokens when KV is high and suggestion is below current", () => {
    const onApplySuggestedMaxTokens = vi.fn();
    renderWorkspace({
      runtimeMetrics: {
        ...idleMetrics,
        kvCacheUsageRatio: 0.93,
      },
      samplingMaxTokens: 8192,
      ctxSize: 4096,
      onApplySuggestedMaxTokens,
    });
    const btn = screen.getByRole("button", { name: /采用建议 maxTokens/ });
    expect(btn).toBeInTheDocument();
  });

  it("hides KV cache warning when ratio is below threshold", () => {
    renderWorkspace({
      runtimeMetrics: {
        ...idleMetrics,
        kvCacheUsageRatio: 0.5,
      },
    });
    expect(screen.queryByText(/KV 缓存占用/)).not.toBeInTheDocument();
  });

  it("filters conversations by search query", async () => {
    const { user } = renderWorkspace();

    await user.type(screen.getByLabelText("搜索对话"), "前端");

    const sidebar = within(screen.getByLabelText("历史对话"));
    expect(sidebar.queryByText("Rust 存储方案")).not.toBeInTheDocument();
    expect(sidebar.getByText("前端界面")).toBeInTheDocument();
  });

  it("filters conversations by date range preset", async () => {
    const now = Date.now();
    const oldIso = new Date(now - 10 * 86400000).toISOString();
    const recentIso = new Date(now - 1 * 86400000).toISOString();
    const { user } = renderWorkspace({
      conversations: [
        { ...summaries[0], updatedAt: oldIso },
        { ...summaries[1], updatedAt: recentIso },
      ],
    });

    await user.selectOptions(screen.getByLabelText("按更新时间筛选对话"), "7d");

    const sidebar = within(screen.getByLabelText("历史对话"));
    expect(sidebar.queryByText("Rust 存储方案")).not.toBeInTheDocument();
    expect(sidebar.getByText("前端界面")).toBeInTheDocument();
  });

  it("selects a conversation from the sidebar", async () => {
    const { user, props } = renderWorkspace();

    await user.click(screen.getByRole("button", { name: "前端界面" }));

    expect(props.onSelectConversation).toHaveBeenCalledWith("conversation-2");
  });

  it("offers export before deleting a conversation", async () => {
    const onExportConversation = vi.fn();
    const onDeleteConversation = vi.fn();
    const { user } = renderWorkspace({ onExportConversation, onDeleteConversation });

    await user.click(screen.getByRole("button", { name: "删除 前端界面" }));
    await user.click(screen.getByRole("button", { name: "删除前导出 Markdown" }));
    await user.click(screen.getByRole("button", { name: "确认删除 前端界面" }));

    expect(onExportConversation).toHaveBeenCalledWith("markdown", false, "conversation-2");
    expect(onDeleteConversation).toHaveBeenCalledWith("conversation-2");
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

  it("prepares a new conversation when chat becomes ready without an active thread", async () => {
    const onCreateConversation = vi.fn(async () => activeConversation);
    renderWorkspace({
      conversations: [],
      activeConversation: null,
      runtimeStatus: "healthy",
      onCreateConversation,
    });

    await waitFor(() => expect(onCreateConversation).toHaveBeenCalledTimes(1));
  });

  it("creates a fresh thread instead of auto-opening archived history", async () => {
    const onCreateConversation = vi.fn(async () => activeConversation);
    const onSelectConversation = vi.fn();
    renderWorkspace({
      conversations: summaries.map((conversation) => ({ ...conversation, archived: true })),
      activeConversation: null,
      runtimeStatus: "healthy",
      onCreateConversation,
      onSelectConversation,
    });

    await waitFor(() => expect(onCreateConversation).toHaveBeenCalledTimes(1));
    expect(onSelectConversation).not.toHaveBeenCalled();
  });

  it("sends with platform submit shortcut", async () => {
    const onSend = vi.fn();
    const { user } = renderWorkspace({ onSend });

    await user.type(screen.getByLabelText("输入消息"), "你好{Meta>}{Enter}{/Meta}");

    expect(onSend).toHaveBeenCalledWith({ text: "你好", attachments: [] });
  });

  it("sends with Enter and keeps Shift+Enter for line breaks", async () => {
    const onSend = vi.fn();
    const { user } = renderWorkspace({ onSend });
    const input = screen.getByLabelText("输入消息");

    await user.type(input, "第一行{Shift>}{Enter}{/Shift}第二行");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("第一行\n第二行");

    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith({ text: "第一行\n第二行", attachments: [] });
  });

  it("shows a concise empty conversation prompt", () => {
    renderWorkspace({
      activeConversation: {
        ...activeConversation,
        messages: [],
      },
    });

    expect(screen.getByText("输入第一条消息开始对话")).toBeInTheDocument();
  });

  it("inserts a novel chapter action prompt into the composer draft", async () => {
    const novelConversation: ChatConversation = {
      ...activeConversation,
      assistantMode: "novel",
      title: "长夜列车",
    };
    const { user } = renderWorkspace({ activeConversation: novelConversation });

    await user.click(screen.getByRole("button", { name: "章节" }));

    expect((screen.getByLabelText("输入消息") as HTMLTextAreaElement).value).toContain(
      "请直接产出章节正文",
    );
  });

  it("shows analysis writing actions for summary and decisions", () => {
    renderWorkspace({
      activeConversation: {
        ...activeConversation,
        assistantMode: "analysis",
      },
    });

    const actionBar = screen.getByLabelText("写作与分析工具");
    expect(within(actionBar).getByRole("button", { name: "总结" })).toBeInTheDocument();
    expect(within(actionBar).getByRole("button", { name: "决策" })).toBeInTheDocument();
    expect(within(actionBar).queryByRole("button", { name: "章节" })).not.toBeInTheDocument();
  });

  it("sends an inserted writing action prompt from the composer", async () => {
    const onSend = vi.fn();
    const { user } = renderWorkspace({
      onSend,
      activeConversation: {
        ...activeConversation,
        assistantMode: "novel",
      },
    });

    await user.click(screen.getByRole("button", { name: "章节" }));
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(onSend).toHaveBeenCalledWith({
      text: expect.stringContaining("请直接产出章节正文"),
      attachments: [],
    });
    expect(screen.getByLabelText("输入消息")).toHaveValue("");
  });

  it("sends image attachments from the composer", async () => {
    const onSend = vi.fn();
    const { user } = renderWorkspace({ onSend });
    const image = new File(["fake image"], "screenshot.png", { type: "image/png" });

    await user.upload(screen.getByLabelText("选择图片或文本附件"), image);
    expect(await screen.findByText("screenshot.png")).toBeInTheDocument();
    await user.type(screen.getByLabelText("输入消息"), "看一下");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(onSend).toHaveBeenCalledWith({
      text: "看一下",
      attachments: [
        expect.objectContaining({
          name: "screenshot.png",
          mimeType: "image/png",
          persistence: "thumbnail",
          dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        }),
      ],
    });
  });

  it("edits a user message and resends from the message item", async () => {
    const onEditAndResend = vi.fn();
    const { user } = renderWorkspace({ onEditAndResend });

    await user.click(screen.getByRole("button", { name: "编辑消息" }));
    const editor = screen.getByLabelText("编辑用户消息");
    await user.clear(editor);
    await user.type(editor, "换个问法");
    await user.click(screen.getByRole("button", { name: "保存并重新发送" }));

    expect(onEditAndResend).toHaveBeenCalledWith("message-1", "换个问法");
  });

  it("routes message deletion to the selected message", async () => {
    const onDeleteMessage = vi.fn();
    const { user } = renderWorkspace({ onDeleteMessage });
    const assistantMessage = screen.getByLabelText("助手消息");

    await user.click(within(assistantMessage).getByRole("button", { name: "删除消息" }));

    expect(onDeleteMessage).toHaveBeenCalledWith("message-2");
  });

  it("exports the active conversation with the selected reasoning preference", async () => {
    const onExportConversation = vi.fn();
    const { user } = renderWorkspace({ onExportConversation });

    await user.click(screen.getByRole("button", { name: "导出 Markdown" }));
    await user.click(screen.getByLabelText("导出时包含思考过程"));
    await user.click(screen.getByRole("button", { name: "导出 JSON" }));

    expect(onExportConversation).toHaveBeenNthCalledWith(1, "markdown", false);
    expect(onExportConversation).toHaveBeenNthCalledWith(2, "json", true);
  });

  it("updates privacy settings and can clear local history", async () => {
    const onChatHistoryChange = vi.fn();
    const onClearHistory = vi.fn();
    const { user } = renderWorkspace({ onChatHistoryChange, onClearHistory });

    await user.click(screen.getByLabelText("保存本地历史"));
    await user.selectOptions(screen.getByLabelText("图片保存方式"), "full");
    await user.click(screen.getByRole("button", { name: "清空本地历史" }));

    expect(onChatHistoryChange).toHaveBeenCalledWith({ ...chatHistory, enabled: false });
    expect(onChatHistoryChange).toHaveBeenCalledWith({
      ...chatHistory,
      imagePersistence: "full",
    });
    expect(onClearHistory).toHaveBeenCalled();
  });

  it("saves the active conversation when switching assistant mode", async () => {
    const onSaveConversation = vi.fn();
    const { user } = renderWorkspace({ onSaveConversation });

    await user.selectOptions(screen.getByLabelText("助手模式"), "novel");

    expect(onSaveConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "conversation-1",
        assistantMode: "novel",
      }),
    );
  });

  it("shows compressed memory and saves empty memory when clearing it", async () => {
    const onSaveConversation = vi.fn();
    const conversationWithMemory: ChatConversation = {
      ...activeConversation,
      memory: {
        summary: "用户正在设计本地聊天历史。",
        updatedAt: "2026-05-09T00:03:00.000Z",
        compressedMessageCount: 6,
        compressedThroughMessageId: "message-2",
      },
    };
    const { user } = renderWorkspace({
      activeConversation: conversationWithMemory,
      onSaveConversation,
    });

    const memoryPanel = screen.getByLabelText("长期对话记忆");
    expect(within(memoryPanel).getByText("用户正在设计本地聊天历史。")).toBeInTheDocument();
    expect(within(memoryPanel).getByText("已压缩 6 条消息")).toBeInTheDocument();

    await user.click(within(memoryPanel).getByRole("button", { name: "清除压缩记忆" }));

    expect(onSaveConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "conversation-1",
        memory: {
          summary: "",
          updatedAt: null,
          compressedMessageCount: 0,
          compressedThroughMessageId: null,
        },
      }),
    );
  });

  it("shows empty memory copy and disables clearing when there is no memory", () => {
    renderWorkspace();

    const memoryPanel = screen.getByLabelText("长期对话记忆");
    expect(within(memoryPanel).getByText("当前对话尚未压缩。")).toBeInTheDocument();
    expect(within(memoryPanel).getByRole("button", { name: "清除压缩记忆" })).toBeDisabled();
  });

  it("disables manual compression when no compression handler is available", () => {
    renderWorkspace();

    const memoryPanel = screen.getByLabelText("长期对话记忆");
    const compressButton = within(memoryPanel).getByRole("button", { name: "压缩当前对话（稍后可用）" });

    expect(compressButton).toBeDisabled();
    expect(compressButton).toHaveAttribute("title", "手动压缩稍后可用");
  });

  it("calls the compression handler when manual compression is available", async () => {
    const onCompressNow = vi.fn();
    const { user } = renderWorkspace({ onCompressNow });

    const memoryPanel = screen.getByLabelText("长期对话记忆");
    await user.click(within(memoryPanel).getByRole("button", { name: "压缩当前对话" }));

    expect(onCompressNow).toHaveBeenCalled();
  });

  it("handles workspace keyboard shortcuts", async () => {
    const onCreateConversation = vi.fn(async () => activeConversation);
    const onCancel = vi.fn();
    const { user } = renderWorkspace({
      streaming: true,
      onCreateConversation,
      onCancel,
    });

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByLabelText("搜索对话")).toHaveFocus();

    await user.keyboard("{Meta>}{Shift>}O{/Shift}{/Meta}");
    expect(onCreateConversation).toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });
});
