import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearChatHistory,
  deleteChatConversation,
  loadChatConversation,
  loadChatHistoryIndex,
  saveChatConversation,
} from "../api/chatHistory";
import { isTauriRuntime, type ChatHistorySettings } from "../api/tauri";
import {
  defaultCompressionSettings,
  emptyConversationMemory,
  type LegacyChatConversationInput,
  normalizeChatConversation,
} from "../lib/chatMigration";
import { buildSearchHaystack } from "../lib/conversationSearchHaystack";
import { createId } from "../lib/ids";
import type { ChatAttachment, ChatConversation, ChatConversationSummary } from "../types/chat";

const CONVERSATION_CACHE_MAX_ENTRIES = 48;

function rememberConversationInCache(
  cache: Map<string, ChatConversation>,
  conversation: ChatConversation,
  ...alsoKeep: Array<string | null | undefined>
): void {
  const keep = new Set<string>([conversation.id]);
  for (const id of alsoKeep) {
    if (id) keep.add(id);
  }
  // Delete before set so this id becomes most-recent in Map iteration order (LRU eviction from the oldest).
  cache.delete(conversation.id);
  cache.set(conversation.id, conversation);
  while (cache.size > CONVERSATION_CACHE_MAX_ENTRIES) {
    let removed = false;
    for (const id of cache.keys()) {
      if (!keep.has(id)) {
        cache.delete(id);
        removed = true;
        break;
      }
    }
    if (!removed) {
      break;
    }
  }
}

interface UseChatWorkspaceOptions {
  historyEnabled: boolean;
  imagePersistence?: ChatHistorySettings["imagePersistence"];
  maxConversations?: number;
  modelPath?: string | null;
  modelName?: string | null;
}

export interface UseChatWorkspaceResult {
  conversations: ChatConversationSummary[];
  activeConversation: ChatConversation | null;
  searchHaystacks: Record<string, string>;
  loading: boolean;
  error: string | null;
  createConversation: () => Promise<ChatConversation>;
  selectConversation: (id: string) => Promise<void>;
  saveConversation: (conversation: LegacyChatConversationInput) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  deleteMessagePair: (messageId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  branchFromMessage: (messageId: string) => Promise<ChatConversation | null>;
}

export function useChatWorkspace({
  historyEnabled,
  imagePersistence = "thumbnail",
  maxConversations = 0,
  modelPath = null,
  modelName = null,
}: UseChatWorkspaceOptions): UseChatWorkspaceResult {
  const tauriAvailable = isTauriRuntime();
  const historyAvailable = historyEnabled && tauriAvailable;
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);
  const [searchHaystacks, setSearchHaystacks] = useState<Record<string, string>>({});

  const indexHaystack = useCallback((conversation: ChatConversation) => {
    setSearchHaystacks((prev) => ({
      ...prev,
      [conversation.id]: buildSearchHaystack(conversation),
    }));
  }, []);

  const dropHaystack = useCallback((id: string) => {
    setSearchHaystacks((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);
  const [loading, setLoading] = useState(historyAvailable);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, ChatConversation>>(new Map());
  const activeConversationRef = useRef<ChatConversation | null>(null);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  useEffect(() => {
    let cancelled = false;
    async function loadIndex() {
      if (!historyAvailable) {
        setLoading(false);
        setConversations([]);
        setActiveConversation(null);
        cacheRef.current.clear();
        return;
      }

      setLoading(true);
      try {
        const index = await loadChatHistoryIndex();
        if (cancelled) return;
        setConversations(sortSummaries(index.conversations));
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadIndex();
    return () => {
      cancelled = true;
    };
  }, [historyAvailable]);

  const saveConversation = useCallback(
    async (conversation: LegacyChatConversationInput) => {
      const next = normalizeConversation(conversation);
      rememberConversationInCache(cacheRef.current, next, activeConversationRef.current?.id);
      indexHaystack(next);
      setActiveConversation((current) => (current?.id === next.id ? next : current));

      if (historyAvailable) {
        const index = await saveChatConversation(
          sanitizeConversationForPersistence(next, imagePersistence),
        );
        const sorted = sortSummaries(index.conversations);
        const trimmedIds = collectIdsToTrim(sorted, maxConversations);
        if (trimmedIds.length > 0) {
          for (const id of trimmedIds) {
            try {
              await deleteChatConversation(id);
              cacheRef.current.delete(id);
            } catch {
              // best-effort; continue
            }
          }
          const refreshed = await loadChatHistoryIndex();
          setConversations(sortSummaries(refreshed.conversations));
        } else {
          setConversations(sorted);
        }
      } else {
        setConversations((current) => {
          const merged = upsertSummary(current, summarizeConversation(next));
          const trimmedIds = collectIdsToTrim(merged, maxConversations);
          if (trimmedIds.length === 0) return merged;
          for (const id of trimmedIds) cacheRef.current.delete(id);
          return merged.filter((summary) => !trimmedIds.includes(summary.id));
        });
      }
    },
    [historyAvailable, imagePersistence, indexHaystack, maxConversations],
  );

  const createConversation = useCallback(async () => {
    const createdAt = new Date().toISOString();
    const conversation = normalizeConversation({
      id: createConversationId(),
      schemaVersion: 2,
      assistantMode: "general",
      title: "新对话",
      createdAt,
      updatedAt: createdAt,
      pinned: false,
      archived: false,
      messageCount: 0,
      lastMessagePreview: "",
      modelPath,
      modelName,
      systemPrompt: "",
      compression: { ...defaultCompressionSettings },
      memory: { ...emptyConversationMemory },
      messages: [],
    });

    rememberConversationInCache(cacheRef.current, conversation, activeConversationRef.current?.id);
    setActiveConversation(conversation);
    await saveConversation(conversation);
    return conversation;
  }, [modelName, modelPath, saveConversation]);

  const selectConversation = useCallback(
    async (id: string) => {
      const cached = cacheRef.current.get(id);
      if (cached) {
        const next = normalizeConversation(cached);
        rememberConversationInCache(cacheRef.current, next, activeConversationRef.current?.id);
        indexHaystack(next);
        setActiveConversation(next);
        return;
      }

      if (!historyAvailable) {
        setActiveConversation(null);
        return;
      }

      const loaded = await loadChatConversation(id);
      if (!loaded) {
        setError("对话不存在。");
        return;
      }

      const next = normalizeConversation(loaded);
      rememberConversationInCache(cacheRef.current, next, activeConversationRef.current?.id);
      indexHaystack(next);
      setActiveConversation(next);
      setError(null);
    },
    [historyAvailable, indexHaystack],
  );

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const target = cacheRef.current.get(id) ?? activeConversation;
      if (!target || target.id !== id) {
        return;
      }
      await saveConversation({
        ...target,
        title: title.trim() || "新对话",
        updatedAt: new Date().toISOString(),
      });
    },
    [activeConversation, saveConversation],
  );

  const setPinned = useCallback(
    async (id: string, pinned: boolean) => {
      const target = cacheRef.current.get(id) ?? activeConversation;
      if (!target || target.id !== id) {
        return;
      }
      await saveConversation({
        ...target,
        pinned,
        updatedAt: new Date().toISOString(),
      });
    },
    [activeConversation, saveConversation],
  );

  const setArchived = useCallback(
    async (id: string, archived: boolean) => {
      const target = cacheRef.current.get(id) ?? activeConversation;
      if (!target || target.id !== id) {
        return;
      }
      await saveConversation({
        ...target,
        archived,
        updatedAt: new Date().toISOString(),
      });
    },
    [activeConversation, saveConversation],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      cacheRef.current.delete(id);
      dropHaystack(id);

      if (historyAvailable) {
        const index = await deleteChatConversation(id);
        const nextSummaries = sortSummaries(index.conversations);
        setConversations(nextSummaries);
        if (activeConversation?.id === id) {
          setActiveConversation(null);
          const next = nextSummaries[0];
          if (next) {
            await selectConversation(next.id);
          }
        }
        return;
      }

      const nextSummaries = conversations.filter((conversation) => conversation.id !== id);
      setConversations(nextSummaries);
      if (activeConversation?.id === id) {
        setActiveConversation(null);
      }
    },
    [activeConversation?.id, conversations, dropHaystack, historyAvailable, selectConversation],
  );

  const deleteMessagePair = useCallback(
    async (messageId: string) => {
      if (!activeConversation) {
        return;
      }

      const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        return;
      }

      const message = activeConversation.messages[messageIndex];
      const deleteIndexes = new Set<number>([messageIndex]);
      if (message.role === "user" && activeConversation.messages[messageIndex + 1]?.role === "assistant") {
        deleteIndexes.add(messageIndex + 1);
      }
      if (message.role === "assistant" && activeConversation.messages[messageIndex - 1]?.role === "user") {
        deleteIndexes.add(messageIndex - 1);
      }

      await saveConversation({
        ...activeConversation,
        messages: activeConversation.messages.filter((_item, index) => !deleteIndexes.has(index)),
        updatedAt: new Date().toISOString(),
      });
    },
    [activeConversation, saveConversation],
  );

  const clearHistory = useCallback(async () => {
    if (tauriAvailable) {
      await clearChatHistory();
    }
    cacheRef.current.clear();
    setSearchHaystacks({});
    setConversations([]);
    setActiveConversation(null);
  }, [tauriAvailable]);

  const branchFromMessage = useCallback(
    async (messageId: string) => {
      if (!activeConversation) {
        return null;
      }

      const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        return null;
      }

      const createdAt = new Date().toISOString();
      const branch: ChatConversation = normalizeConversation({
        ...activeConversation,
        id: createConversationId(),
        title: `${activeConversation.title} 分支`,
        createdAt,
        updatedAt: createdAt,
        pinned: false,
        messages: activeConversation.messages.slice(0, messageIndex + 1),
      });

      rememberConversationInCache(cacheRef.current, branch, activeConversationRef.current?.id);
      indexHaystack(branch);
      setActiveConversation(branch);
      await saveConversation(branch);
      return branch;
    },
    [activeConversation, indexHaystack, saveConversation],
  );

  return {
    conversations,
    activeConversation,
    searchHaystacks,
    loading,
    error,
    createConversation,
    selectConversation,
    saveConversation,
    renameConversation,
    setPinned,
    setArchived,
    deleteConversation,
    deleteMessagePair,
    clearHistory,
    branchFromMessage,
  };
}

function normalizeConversation(conversation: LegacyChatConversationInput): ChatConversation {
  const migrated = normalizeChatConversation(conversation);
  const summary = summarizeConversation(migrated);
  return {
    ...migrated,
    ...summary,
  };
}

function sanitizeConversationForPersistence(
  conversation: ChatConversation,
  imagePersistence: ChatHistorySettings["imagePersistence"],
): ChatConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (!message.attachments || message.attachments.length === 0) {
        return message;
      }

      return {
        ...message,
        attachments: message.attachments.map((attachment) =>
          sanitizeAttachmentForPersistence(attachment, imagePersistence),
        ),
      };
    }),
  };
}

function sanitizeAttachmentForPersistence(
  attachment: ChatAttachment,
  imagePersistence: ChatHistorySettings["imagePersistence"],
): ChatAttachment {
  if (imagePersistence === "full") {
    return { ...attachment, persistence: "full" };
  }

  if (imagePersistence === "thumbnail") {
    return {
      ...attachment,
      dataUrl: "",
      persistedPath: undefined,
      persistence: "thumbnail",
    };
  }

  return {
    ...attachment,
    dataUrl: "",
    thumbnailUrl: undefined,
    persistedPath: undefined,
    persistence: "memory",
  };
}

function summarizeConversation(conversation: ChatConversation): ChatConversationSummary {
  const lastMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.content.trim().length > 0);
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    pinned: conversation.pinned,
    archived: conversation.archived,
    messageCount: conversation.messages.length,
    lastMessagePreview: lastMessage?.content.slice(0, 80) ?? "",
    modelPath: conversation.modelPath,
    modelName: conversation.modelName,
  };
}

function upsertSummary(
  summaries: ChatConversationSummary[],
  next: ChatConversationSummary,
): ChatConversationSummary[] {
  return sortSummaries([...summaries.filter((summary) => summary.id !== next.id), next]);
}

function sortSummaries(summaries: ChatConversationSummary[]): ChatConversationSummary[] {
  return [...summaries].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    return right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title);
  });
}

const createConversationId = createId;

function collectIdsToTrim(
  summaries: ChatConversationSummary[],
  maxConversations: number,
): string[] {
  if (!Number.isFinite(maxConversations) || maxConversations <= 0) {
    return [];
  }
  if (summaries.length <= maxConversations) {
    return [];
  }
  // Sort by archived asc, pinned desc, updatedAt asc so the oldest non-pinned
  // (and preferring archived) entries are the first candidates to drop.
  const eligible = summaries
    .filter((summary) => !summary.pinned)
    .sort((left, right) => {
      if (left.archived !== right.archived) {
        return left.archived ? -1 : 1;
      }
      return left.updatedAt.localeCompare(right.updatedAt);
    });
  const overflow = summaries.length - maxConversations;
  return eligible.slice(0, overflow).map((summary) => summary.id);
}
