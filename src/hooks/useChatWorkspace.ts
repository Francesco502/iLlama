import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteChatConversation,
  loadChatConversation,
  loadChatHistoryIndex,
  saveChatConversation,
} from "../api/chatHistory";
import { isTauriRuntime } from "../api/tauri";
import type { ChatConversation, ChatConversationSummary } from "../types/chat";

interface UseChatWorkspaceOptions {
  historyEnabled: boolean;
  modelPath?: string | null;
  modelName?: string | null;
}

export interface UseChatWorkspaceResult {
  conversations: ChatConversationSummary[];
  activeConversation: ChatConversation | null;
  loading: boolean;
  error: string | null;
  createConversation: () => Promise<ChatConversation>;
  selectConversation: (id: string) => Promise<void>;
  saveConversation: (conversation: ChatConversation) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  branchFromMessage: (messageId: string) => Promise<ChatConversation | null>;
}

export function useChatWorkspace({
  historyEnabled,
  modelPath = null,
  modelName = null,
}: UseChatWorkspaceOptions): UseChatWorkspaceResult {
  const historyAvailable = historyEnabled && isTauriRuntime();
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);
  const [loading, setLoading] = useState(historyAvailable);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, ChatConversation>>(new Map());

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
    async (conversation: ChatConversation) => {
      const next = normalizeConversation(conversation);
      cacheRef.current.set(next.id, next);
      setActiveConversation((current) => (current?.id === next.id ? next : current));

      if (historyAvailable) {
        const index = await saveChatConversation(next);
        setConversations(sortSummaries(index.conversations));
      } else {
        setConversations((current) => upsertSummary(current, summarizeConversation(next)));
      }
    },
    [historyAvailable],
  );

  const createConversation = useCallback(async () => {
    const createdAt = new Date().toISOString();
    const conversation: ChatConversation = {
      id: createConversationId(),
      schemaVersion: 1,
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
      messages: [],
    };

    cacheRef.current.set(conversation.id, conversation);
    setActiveConversation(conversation);
    await saveConversation(conversation);
    return conversation;
  }, [modelName, modelPath, saveConversation]);

  const selectConversation = useCallback(
    async (id: string) => {
      const cached = cacheRef.current.get(id);
      if (cached) {
        setActiveConversation(cached);
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

      cacheRef.current.set(loaded.id, loaded);
      setActiveConversation(loaded);
      setError(null);
    },
    [historyAvailable],
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

  const deleteConversation = useCallback(
    async (id: string) => {
      cacheRef.current.delete(id);

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
    [activeConversation?.id, conversations, historyAvailable, selectConversation],
  );

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

      cacheRef.current.set(branch.id, branch);
      setActiveConversation(branch);
      await saveConversation(branch);
      return branch;
    },
    [activeConversation, saveConversation],
  );

  return {
    conversations,
    activeConversation,
    loading,
    error,
    createConversation,
    selectConversation,
    saveConversation,
    renameConversation,
    deleteConversation,
    branchFromMessage,
  };
}

function normalizeConversation(conversation: ChatConversation): ChatConversation {
  const summary = summarizeConversation(conversation);
  return {
    ...conversation,
    ...summary,
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

function createConversationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}
