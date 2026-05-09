import { useCallback, useRef, useState } from "react";
import { streamChatCompletion, type ChatRequestMessage, type ChatStreamDelta } from "../api/chat";
import { isTauriRuntime } from "../api/tauri";
import { buildContextWindow } from "../lib/contextBudget";
import { splitThinkTags } from "../lib/reasoning";
import { calculateTokensPerSecond, countStreamToken } from "../lib/runtimeMetrics";
import type {
  ChatConversation,
  ChatGenerationStats,
  ChatMessage,
  PendingChatMessage,
} from "../types/chat";
import type { SamplingParameters } from "../types/domain";

interface UseChatGenerationOptions {
  port: number;
  sampling: SamplingParameters;
  contextSize: number;
  modelPath: string | null;
  modelName: string | null;
  activeConversation: ChatConversation | null;
  saveConversation: (conversation: ChatConversation) => Promise<void>;
  appendSystemLog: (message: string) => void;
}

export function useChatGeneration({
  port,
  sampling,
  contextSize,
  modelPath,
  modelName,
  activeConversation,
  saveConversation,
  appendSystemLog,
}: UseChatGenerationOptions) {
  const [streaming, setStreaming] = useState(false);
  const [streamTokensPerSecond, setStreamTokensPerSecond] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);

  const runGeneration = useCallback(
    async (conversationWithUser: ChatConversation, assistantId: string) => {
      let working = conversationWithUser;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setStreaming(true);
      setStreamTokensPerSecond(null);
      let generatedTokens = 0;
      const streamStartedAt = performance.now();

      if (!isTauriRuntime()) {
        const hasAttachments = working.messages.some((message) => message.attachments?.length);
        working = updateAssistantMessage(working, assistantId, (message) => ({
          ...message,
          content: hasAttachments
            ? "这是浏览器预览模式的模拟回复；真实多模态输入会在 Tauri 应用中发送给 llama-server。"
            : "这是浏览器预览模式的模拟回复。",
          status: "complete",
          streaming: false,
          stats: completeStats(message.stats, 0, null),
        }));
        await saveConversation(touchConversation(working));
        setStreaming(false);
        abortControllerRef.current = null;
        return;
      }

      try {
        if (cancelRequestedRef.current) {
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        }
        await streamChatCompletion({
          host: "127.0.0.1",
          port,
          messages: buildRequestMessages(working, contextSize, sampling.maxTokens),
          sampling,
          signal: controller.signal,
          onDelta: (delta) => {
            generatedTokens += countStreamToken(delta.contentDelta || delta.reasoningDelta);
            const tokensPerSecond = calculateTokensPerSecond(
              generatedTokens,
              streamStartedAt,
              performance.now(),
            );
            setStreamTokensPerSecond(tokensPerSecond);
            working = touchConversation(
              updateAssistantMessage(working, assistantId, (message) =>
                applyDelta(message, delta, tokensPerSecond, generatedTokens),
              ),
            );
            void saveConversation(working);
          },
        });

        working = touchConversation(
          updateAssistantMessage(working, assistantId, (message) => ({
            ...message,
            status: "complete",
            streaming: false,
            stats: completeStats(
              message.stats,
              generatedTokens,
              calculateTokensPerSecond(generatedTokens, streamStartedAt, performance.now()),
            ),
          })),
        );
        await saveConversation(working);
      } catch (error) {
        const aborted = controller.signal.aborted;
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!aborted) {
          appendSystemLog(errorMessage);
        }
        working = touchConversation(
          updateAssistantMessage(working, assistantId, (message) => ({
            ...message,
            status: aborted ? "cancelled" : "failed",
            streaming: false,
            error: aborted ? undefined : errorMessage,
            stats: completeStats(message.stats, generatedTokens, streamTokensPerSecond),
          })),
        );
        await saveConversation(working);
      } finally {
        setStreaming(false);
        abortControllerRef.current = null;
        cancelRequestedRef.current = false;
      }
    },
    [appendSystemLog, contextSize, port, sampling, saveConversation, streamTokensPerSecond],
  );

  const sendMessage = useCallback(
    async (payload: PendingChatMessage) => {
      if (!activeConversation) {
        return;
      }

      const userMessage = createUserMessage(payload);
      const assistantId = createMessageId();
      const assistantMessage = createAssistantMessage(assistantId, port, sampling, modelPath, modelName);
      const nextConversation = touchConversation({
        ...activeConversation,
        messages: [...activeConversation.messages, userMessage, assistantMessage],
      });
      await saveConversation(nextConversation);
      await runGeneration(nextConversation, assistantId);
    },
    [activeConversation, modelName, modelPath, port, runGeneration, sampling, saveConversation],
  );

  const regenerateFromMessage = useCallback(
    async (assistantMessageId: string) => {
      if (!activeConversation) {
        return;
      }
      const assistantIndex = activeConversation.messages.findIndex(
        (message) => message.id === assistantMessageId,
      );
      if (assistantIndex <= 0) {
        return;
      }
      const userMessage = [...activeConversation.messages.slice(0, assistantIndex)]
        .reverse()
        .find((message) => message.role === "user");
      if (!userMessage) {
        return;
      }
      const assistantId = createMessageId();
      const nextConversation = touchConversation({
        ...activeConversation,
        messages: [
          ...activeConversation.messages.slice(0, assistantIndex),
          createAssistantMessage(assistantId, port, sampling, modelPath, modelName),
        ],
      });
      await saveConversation(nextConversation);
      await runGeneration(nextConversation, assistantId);
    },
    [activeConversation, modelName, modelPath, port, runGeneration, sampling, saveConversation],
  );

  const editUserMessageAndResend = useCallback(
    async (userMessageId: string, text: string) => {
      if (!activeConversation) {
        return;
      }
      const userIndex = activeConversation.messages.findIndex((message) => message.id === userMessageId);
      if (userIndex < 0) {
        return;
      }
      const assistantId = createMessageId();
      const editedUser: ChatMessage = {
        ...activeConversation.messages[userIndex],
        content: text,
        updatedAt: new Date().toISOString(),
      };
      const nextConversation = touchConversation({
        ...activeConversation,
        messages: [
          ...activeConversation.messages.slice(0, userIndex),
          editedUser,
          createAssistantMessage(assistantId, port, sampling, modelPath, modelName),
        ],
      });
      await saveConversation(nextConversation);
      await runGeneration(nextConversation, assistantId);
    },
    [activeConversation, modelName, modelPath, port, runGeneration, sampling, saveConversation],
  );

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    } else {
      cancelRequestedRef.current = true;
    }
  }, []);

  return {
    streaming,
    streamTokensPerSecond,
    sendMessage,
    cancelGeneration,
    regenerateFromMessage,
    editUserMessageAndResend,
  };
}

function createUserMessage(payload: PendingChatMessage): ChatMessage {
  return {
    id: createMessageId(),
    role: "user",
    content: payload.text,
    attachments: payload.attachments,
    createdAt: new Date().toISOString(),
    status: "complete",
  };
}

function createAssistantMessage(
  id: string,
  port: number,
  sampling: SamplingParameters,
  modelPath: string | null,
  modelName: string | null,
): ChatMessage {
  const now = new Date().toISOString();
  return {
    id,
    role: "assistant",
    content: "",
    reasoningContent: "",
    createdAt: now,
    status: "streaming",
    streaming: true,
    stats: {
      startedAt: now,
      completedAt: null,
      generatedTokens: 0,
      tokensPerSecond: null,
    },
    modelSnapshot: {
      modelPath,
      modelName,
      port,
      sampling,
    },
  };
}

function buildRequestMessages(
  conversation: ChatConversation,
  contextSize: number,
  maxTokens: number,
): ChatRequestMessage[] {
  const window = buildContextWindow({
    systemPrompt: conversation.systemPrompt,
    messages: conversation.messages.filter((message) => {
      if (message.role === "assistant") {
        return message.status !== "failed" && message.status !== "cancelled";
      }
      return true;
    }),
    contextSize,
    maxTokens,
  });

  const requestMessages: ChatRequestMessage[] = [];
  if (conversation.systemPrompt.trim().length > 0) {
    requestMessages.push({ role: "system", content: conversation.systemPrompt });
  }
  for (const message of window.messages) {
    if (message.role === "system") {
      continue;
    }
    requestMessages.push({
      role: message.role,
      content: message.content,
      attachments: message.role === "user" ? message.attachments : undefined,
    });
  }
  return requestMessages;
}

function applyDelta(
  message: ChatMessage,
  delta: ChatStreamDelta,
  tokensPerSecond: number | null,
  generatedTokens: number,
): ChatMessage {
  let content = `${message.content}${delta.contentDelta}`;
  let reasoningContent = `${message.reasoningContent ?? ""}${delta.reasoningDelta}`;
  if (content.includes("<think>")) {
    const split = splitThinkTags(content);
    content = split.content;
    reasoningContent = `${reasoningContent}${split.reasoning}`;
  }

  return {
    ...message,
    content,
    reasoningContent,
    status: "streaming",
    streaming: true,
    stats: {
      ...(message.stats ?? createEmptyStats()),
      generatedTokens,
      tokensPerSecond,
      reasoningStartedAt:
        reasoningContent && !message.stats?.reasoningStartedAt
          ? new Date().toISOString()
          : message.stats?.reasoningStartedAt,
    },
  };
}

function updateAssistantMessage(
  conversation: ChatConversation,
  assistantId: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.id === assistantId ? update(message) : message,
    ),
  };
}

function touchConversation(conversation: ChatConversation): ChatConversation {
  const updatedAt = new Date().toISOString();
  const lastMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.content.trim().length > 0);
  return {
    ...conversation,
    updatedAt,
    messageCount: conversation.messages.length,
    lastMessagePreview: lastMessage?.content.slice(0, 80) ?? "",
  };
}

function completeStats(
  stats: ChatGenerationStats | undefined,
  generatedTokens: number,
  tokensPerSecond: number | null,
): ChatGenerationStats {
  return {
    ...(stats ?? createEmptyStats()),
    completedAt: new Date().toISOString(),
    generatedTokens,
    tokensPerSecond,
  };
}

function createEmptyStats(): ChatGenerationStats {
  return {
    startedAt: new Date().toISOString(),
    completedAt: null,
    generatedTokens: 0,
    tokensPerSecond: null,
  };
}

function createMessageId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}
