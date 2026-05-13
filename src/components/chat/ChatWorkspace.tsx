import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatHistorySettings } from "../../api/tauri";
import type { ChatConversation, ChatConversationSummary, PendingChatMessage } from "../../types/chat";
import type { ModelEntry, RuntimeMetrics, RuntimeStatus } from "../../types/domain";
import { suggestMaxOutputTokensHint } from "../../lib/contextBudget";
import { conversationMatchesDateRange, type ConversationDateRangePreset } from "../../lib/conversationDateFilter";
import { estimateFullRequestTokens } from "../../lib/conversationTokenEstimate";
import { AssistantModeSelector } from "./AssistantModeSelector";
import { ChatComposer } from "./ChatComposer";
import { ChatPrivacyPanel } from "./ChatPrivacyPanel";
import { ChatThread } from "./ChatThread";
import { ConversationMemoryPanel } from "./ConversationMemoryPanel";
import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationTitleBar } from "./ConversationTitleBar";
import { SystemPromptEditor } from "./SystemPromptEditor";
import { WritingActionBar } from "./WritingActionBar";
import { ErrorBoundary } from "../ErrorBoundary";

export interface ChatWorkspaceProps {
  runtimeStatus: RuntimeStatus;
  selectedModel: ModelEntry | null;
  /** Used with KV 告警 to suggest a safer maxTokens upper bound. */
  ctxSize: number;
  samplingMaxTokens: number;
  conversations: ChatConversationSummary[];
  activeConversation: ChatConversation | null;
  historyLoading?: boolean;
  searchHaystacks?: Record<string, string>;
  chatHistory: ChatHistorySettings;
  streaming: boolean;
  streamTokensPerSecond: number | null;
  runtimeMetrics: RuntimeMetrics;
  onCreateConversation: () => Promise<ChatConversation>;
  onSelectConversation: (id: string) => void | Promise<void>;
  onSaveConversation: (conversation: ChatConversation) => void | Promise<void>;
  onCompressNow?: () => void | Promise<void>;
  onRenameConversation: (id: string, title: string) => void | Promise<void>;
  onSetPinned: (id: string, pinned: boolean) => void | Promise<void>;
  onSetArchived: (id: string, archived: boolean) => void | Promise<void>;
  onDeleteConversation: (id: string) => void | Promise<void>;
  onDeleteMessage: (messageId: string) => void | Promise<void>;
  onBranchFromMessage: (messageId: string) => void | Promise<ChatConversation | null>;
  onSend: (message: PendingChatMessage) => void | Promise<void>;
  onCancel: () => void;
  onRegenerate: (messageId: string) => void | Promise<void>;
  onEditAndResend: (messageId: string, text: string) => void | Promise<void>;
  onContinueAssistant: (assistantMessageId: string) => void | Promise<void>;
  onOpenSamplingTab: () => void;
  onChatHistoryChange: (settings: ChatHistorySettings) => void | Promise<void>;
  onClearHistory: () => void | Promise<void>;
  onExportConversation: (
    format: "markdown" | "json",
    includeReasoning: boolean,
    conversationId?: string,
  ) => void | Promise<void>;
  /** When KV 告警给出建议上限，一键写入采样 maxTokens（仍可在配置中再改）。 */
  onApplySuggestedMaxTokens?: (maxTokens: number) => void;
}

export function ChatWorkspace({
  runtimeStatus,
  selectedModel,
  ctxSize,
  samplingMaxTokens,
  conversations,
  activeConversation,
  historyLoading = false,
  searchHaystacks,
  chatHistory,
  streaming,
  streamTokensPerSecond,
  runtimeMetrics,
  onCreateConversation,
  onSelectConversation,
  onSaveConversation,
  onCompressNow,
  onRenameConversation,
  onSetPinned,
  onSetArchived,
  onDeleteConversation,
  onDeleteMessage,
  onBranchFromMessage,
  onSend,
  onCancel,
  onRegenerate,
  onEditAndResend,
  onContinueAssistant,
  onOpenSamplingTab,
  onChatHistoryChange,
  onClearHistory,
  onExportConversation,
  onApplySuggestedMaxTokens,
}: ChatWorkspaceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [filterByCurrentModel, setFilterByCurrentModel] = useState(false);
  const [dateRangePreset, setDateRangePreset] = useState<ConversationDateRangePreset>("all");
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autoPrepareConversationRef = useRef(false);
  const disabledReason =
    runtimeStatus !== "healthy"
      ? "runtime"
      : streaming
        ? "streaming"
        : !activeConversation
          ? "conversation"
          : undefined;
  const disabled = Boolean(disabledReason);
  const activeId = activeConversation?.id ?? null;
  const composerDraft = activeId ? (composerDrafts[activeId] ?? "") : "";

  const setComposerDraft = useCallback(
    (next: string) => {
      if (!activeId) return;
      setComposerDrafts((prev) => ({ ...prev, [activeId]: next }));
    },
    [activeId],
  );

  const clearActiveDraft = useCallback(() => {
    if (!activeId) return;
    setComposerDrafts((prev) => {
      if (!(activeId in prev)) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
  }, [activeId]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const modelPath = selectedModel?.path ?? null;
    const base = conversations.filter((conversation) => {
      if (!conversationMatchesDateRange(conversation, dateRangePreset)) {
        return false;
      }
      if (!showArchived && conversation.archived) {
        return false;
      }
      if (filterByCurrentModel && modelPath) {
        return conversation.modelPath === modelPath;
      }
      return true;
    });
    if (!query) {
      return base;
    }
    return base.filter((conversation) => {
      const inSummary = `${conversation.title} ${conversation.lastMessagePreview}`
        .toLowerCase()
        .includes(query);
      if (inSummary) return true;
      const haystack = searchHaystacks?.[conversation.id];
      return Boolean(haystack && haystack.includes(query));
    });
  }, [conversations, searchHaystacks, searchQuery, showArchived, filterByCurrentModel, selectedModel?.path, dateRangePreset]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const target = event.target instanceof HTMLElement ? event.target : null;
      const insideComposer = Boolean(target?.closest(".chat-composer"));

      if (meta && key === "k" && !insideComposer) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (meta && event.shiftKey && key === "o") {
        event.preventDefault();
        void onCreateConversation();
        return;
      }

      if (event.key === "Escape" && streaming) {
        event.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, onCreateConversation, streaming]);

  useEffect(() => {
    if (
      runtimeStatus !== "healthy" ||
      activeConversation ||
      historyLoading ||
      autoPrepareConversationRef.current
    ) {
      return;
    }

    autoPrepareConversationRef.current = true;
    const firstConversation = conversations.find((conversation) => !conversation.archived);

    void (async () => {
      try {
        if (firstConversation) {
          await onSelectConversation(firstConversation.id);
        } else {
          await onCreateConversation();
        }
      } finally {
        autoPrepareConversationRef.current = false;
      }
    })();
  }, [
    activeConversation,
    conversations,
    historyLoading,
    onCreateConversation,
    onSelectConversation,
    runtimeStatus,
  ]);

  const kvRatio = runtimeMetrics.kvCacheUsageRatio;
  const kvWarn =
    runtimeStatus === "healthy" && kvRatio != null && Number.isFinite(kvRatio) && kvRatio >= 0.9;
  const kvCritical = kvWarn && kvRatio >= 0.95;

  const suggestedMaxForKv = useMemo(() => {
    if (!activeConversation || !kvWarn) {
      return null;
    }
    const est = estimateFullRequestTokens(activeConversation);
    return suggestMaxOutputTokensHint({
      contextSize: ctxSize,
      estimatedPromptTokens: est,
      currentMaxTokens: samplingMaxTokens,
    });
  }, [activeConversation, ctxSize, kvWarn, samplingMaxTokens]);

  return (
    <div className="chat-workspace">
      <ConversationSidebar
        conversations={filteredConversations}
        activeConversationId={activeConversation?.id ?? null}
        searchQuery={searchQuery}
        searchInputRef={searchInputRef}
        showArchived={showArchived}
        filterByCurrentModel={filterByCurrentModel}
        onFilterByCurrentModelChange={setFilterByCurrentModel}
        modelFilterEnabled={Boolean(selectedModel?.path)}
        dateRangePreset={dateRangePreset}
        onDateRangePresetChange={setDateRangePreset}
        onSearchQueryChange={setSearchQuery}
        onToggleShowArchived={setShowArchived}
        onCreate={onCreateConversation}
        onSelect={onSelectConversation}
        onRename={onRenameConversation}
        onTogglePin={onSetPinned}
        onToggleArchive={onSetArchived}
        onDelete={onDeleteConversation}
        onExportBeforeDelete={(id, format) =>
          onExportConversation(format, chatHistory.includeReasoningInExportDefault, id)
        }
      />
      <section className="chat-main" aria-label="对话工作区">
        {kvWarn && (
          <div className="kv-cache-warning" data-level={kvCritical ? "critical" : "warn"} role="status">
            <span>
              KV 缓存占用已达 {Math.round((kvRatio ?? 0) * 100)}%，接近上限时生成可能变慢或停滞。可尝试压缩历史对话，或到「配置」里降低 maxTokens / 提高 ctxSize。
              {suggestedMaxForKv != null &&
                suggestedMaxForKv < samplingMaxTokens &&
                Number.isFinite(samplingMaxTokens) &&
                samplingMaxTokens > 0 && (
                  <>
                    {" "}
                    粗略估算下，将 maxTokens 暂调至 ≤ <strong>{suggestedMaxForKv}</strong> 可减轻 KV 压力（仅供参考，请在「配置」中确认后保存）。
                  </>
                )}
            </span>
            <div className="kv-cache-warning-actions">
              {onCompressNow && (
                <button className="ghost-button compact" type="button" onClick={() => void onCompressNow()}>
                  压缩对话
                </button>
              )}
              <button className="ghost-button compact" type="button" onClick={onOpenSamplingTab}>
                调整采样
              </button>
              {onApplySuggestedMaxTokens &&
                suggestedMaxForKv != null &&
                suggestedMaxForKv < samplingMaxTokens &&
                Number.isFinite(samplingMaxTokens) &&
                samplingMaxTokens > 0 && (
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={() => onApplySuggestedMaxTokens(suggestedMaxForKv)}
                  >
                    采用建议 maxTokens（{suggestedMaxForKv}）
                  </button>
                )}
            </div>
          </div>
        )}
        <ConversationTitleBar
          conversation={activeConversation}
          selectedModel={selectedModel}
          streamTokensPerSecond={streamTokensPerSecond}
          assistantModeControl={
            <AssistantModeSelector conversation={activeConversation} onSaveConversation={onSaveConversation} />
          }
          memoryStatus={
            <span className="conversation-memory-badge">
              记忆 {activeConversation?.memory.compressedMessageCount ?? 0}
            </span>
          }
        />
        <SystemPromptEditor
          conversation={activeConversation}
          onSaveConversation={onSaveConversation}
        />
        <ConversationMemoryPanel
          conversation={activeConversation}
          compressDisabled={runtimeStatus !== "healthy" || !onCompressNow}
          onCompressNow={onCompressNow}
          onSaveConversation={onSaveConversation}
        />
        <ErrorBoundary variant="inline" title="消息列表渲染出错">
          <ChatThread
            conversation={activeConversation}
            streaming={streaming}
            onBranchFromMessage={onBranchFromMessage}
            onEditAndResend={onEditAndResend}
            onRegenerate={onRegenerate}
            onDeleteMessage={onDeleteMessage}
            onContinueAssistant={onContinueAssistant}
            onOpenSamplingTab={onOpenSamplingTab}
          />
        </ErrorBoundary>
        <ChatPrivacyPanel
          chatHistory={chatHistory}
          exportDisabled={!activeConversation}
          onChatHistoryChange={onChatHistoryChange}
          onClearHistory={onClearHistory}
          onExportConversation={onExportConversation}
        />
        <ErrorBoundary variant="inline" title="写作动作栏渲染出错">
          <WritingActionBar
            conversation={activeConversation}
            selectedText={composerDraft}
            onInsertPrompt={setComposerDraft}
          />
        </ErrorBoundary>
        <ErrorBoundary variant="inline" title="输入区渲染出错">
          <ChatComposer
            disabled={disabled}
            disabledReason={disabledReason}
            streaming={streaming}
            imagePersistence={chatHistory.imagePersistence === "none" ? "memory" : chatHistory.imagePersistence}
            draftText={composerDraft}
            onDraftTextChange={setComposerDraft}
            onCancel={onCancel}
            onSend={async (payload) => {
              await onSend(payload);
              clearActiveDraft();
            }}
          />
        </ErrorBoundary>
      </section>
    </div>
  );
}
