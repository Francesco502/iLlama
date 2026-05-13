import { useCallback, useRef, useState } from "react";
import {
  completeChatCompletion,
  isLengthLikeFinishReason,
  streamChatCompletion,
  type ChatRequestMessage,
  type ChatStreamDelta,
} from "../api/chat";
import { isTauriRuntime } from "../api/tauri";
import { createConversationTitle } from "../lib/chatTitle";
import {
  buildContinueRequestMessages,
  buildRequestMessages,
  CONTINUATION_USER_PROMPT,
} from "../lib/chatGeneration/buildChatRequestMessages";
import { inferLikelyLengthFinishReason } from "../lib/chatFinishReason";
import { getAdaptiveSafetyFactor } from "../lib/contextBudget";
import { estimateFullRequestTokens } from "../lib/conversationTokenEstimate";
import {
  buildCompressionPrompt,
  mergeConversationMemory,
  selectMessagesForCompression,
} from "../lib/conversationCompression";
import { createId } from "../lib/ids";
import { splitThinkTags } from "../lib/reasoning";
import { calculateTokensPerSecond, estimateDeltaTokens } from "../lib/runtimeMetrics";
import type {
  ChatConversation,
  ChatGenerationStats,
  ChatMessage,
  PendingChatMessage,
} from "../types/chat";
import type { SamplingParameters } from "../types/domain";

const STREAM_SAVE_THROTTLE_MS = 250;

interface RunGenerationOptions {
  /** When set, skip `buildRequestMessages` and send this array (e.g. continue-output with injected user turn). */
  requestMessages?: ChatRequestMessage[];
  /** Seed completion token counter for TPS / stats when appending to an existing assistant message. */
  initialCompletionTokens?: number;
}

export type RunGenerationOutcome = "complete" | "failed" | "cancelled";

export interface RunGenerationResult {
  outcome: RunGenerationOutcome;
  conversation: ChatConversation;
}

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
    async (
      conversationWithUser: ChatConversation,
      assistantId: string,
      options?: RunGenerationOptions,
    ): Promise<RunGenerationResult> => {
      let working = conversationWithUser;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setStreaming(true);
      setStreamTokensPerSecond(null);
      let generatedTokens = options?.initialCompletionTokens ?? 0;
      const streamStartedAt = performance.now();
      let outcome: RunGenerationOutcome;

      if (!isTauriRuntime()) {
        const hasAttachments = working.messages.some((message) => message.attachments?.length);
        working = updateAssistantMessage(working, assistantId, (message) => ({
          ...message,
          content: hasAttachments
            ? "这是浏览器预览模式的模拟回复；真实多模态输入会在 Tauri 应用中发送给 llama-server。"
            : "这是浏览器预览模式的模拟回复。",
          status: "complete",
          stats: completeStats(message.stats, 0, null),
        }));
        working = touchConversation(working);
        await saveConversation(working);
        setStreaming(false);
        abortControllerRef.current = null;
        return { outcome: "complete", conversation: working };
      }

      let lastSaveAt = 0;
      let pendingSave = false;
      const flushSave = () => {
        if (!pendingSave) return;
        pendingSave = false;
        lastSaveAt = performance.now();
        void saveConversation(working);
      };

      try {
        working = await compressConversationIfNeeded({
          conversation: working,
          port,
          sampling,
          contextSize,
          signal: controller.signal,
          saveConversation,
        });

        if (cancelRequestedRef.current) {
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        }
        await streamChatCompletion({
          host: "127.0.0.1",
          port,
          messages:
            options?.requestMessages ?? buildRequestMessages(working, contextSize, sampling.maxTokens),
          sampling,
          signal: controller.signal,
          onDelta: (delta) => {
            if (delta.usage) {
              generatedTokens = delta.usage.completionTokens;
            } else {
              generatedTokens += estimateDeltaTokens(delta.contentDelta || delta.reasoningDelta);
            }
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
            pendingSave = true;
            // Throttle streaming writes: persist no more often than every
            // STREAM_SAVE_THROTTLE_MS, and always flush on completion below.
            const now = performance.now();
            if (now - lastSaveAt >= STREAM_SAVE_THROTTLE_MS) {
              flushSave();
            }
          },
        });
        flushSave();

        working = touchConversation(
          updateAssistantMessage(working, assistantId, (message) => {
            const completionTok =
              message.stats?.completionTokens ?? message.stats?.generatedTokens ?? generatedTokens;
            const hadReason = message.finishReason != null && String(message.finishReason).trim() !== "";
            const nextReason = inferLikelyLengthFinishReason(
              message.finishReason,
              completionTok,
              sampling.maxTokens,
            );
            const resolvedReason = nextReason ?? message.finishReason;
            if (!hadReason && nextReason === "length") {
              appendSystemLog(
                "已在流结束后推断 finish_reason=length（流式最后一包未带 reason，且 completion≈maxTokens）。",
              );
            } else if (
              !hadReason &&
              (!resolvedReason || String(resolvedReason).trim() === "") &&
              completionTok >= 8 &&
              sampling.maxTokens > 64 &&
              completionTok < sampling.maxTokens - 2
            ) {
              appendSystemLog(
                "流结束未收到 finish_reason；本次生成未打满 maxTokens，多为 stop 或 server 未上报该字段。",
              );
            }
            return {
              ...message,
              status: "complete",
              finishReason: resolvedReason ?? message.finishReason,
              stats: completeStats(
                message.stats,
                generatedTokens,
                calculateTokensPerSecond(generatedTokens, streamStartedAt, performance.now()),
              ),
            };
          }),
        );
        await saveConversation(working);
        outcome = "complete";
      } catch (error) {
        const aborted = controller.signal.aborted;
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!aborted) {
          appendSystemLog(errorMessage);
        }
        const currentTokensPerSecond = getCurrentTokensPerSecond(
          working,
          assistantId,
          generatedTokens,
          streamStartedAt,
        );
        working = touchConversation(
          updateAssistantMessage(working, assistantId, (message) => ({
            ...message,
            status: aborted ? "cancelled" : "failed",
            error: aborted ? undefined : errorMessage,
            finishReason: aborted ? undefined : message.finishReason,
            stats: completeStats(message.stats, generatedTokens, currentTokensPerSecond),
          })),
        );
        pendingSave = true;
        flushSave();
        outcome = aborted ? "cancelled" : "failed";
      } finally {
        setStreaming(false);
        abortControllerRef.current = null;
        cancelRequestedRef.current = false;
      }

      return { outcome, conversation: working };
    },
    [appendSystemLog, contextSize, port, sampling, saveConversation],
  );

  const sendMessage = useCallback(
    async (payload: PendingChatMessage) => {
      if (!activeConversation) {
        return;
      }

      const userMessage = createUserMessage(payload);
      const assistantId = createMessageId();
      const assistantMessage = createAssistantMessage(assistantId, port, sampling, modelPath, modelName);
      const isFirstUserTurn = activeConversation.messages.every((message) => message.role !== "user");
      const shouldAutoTitle =
        isFirstUserTurn &&
        (activeConversation.title.trim() === "" || activeConversation.title === "新对话") &&
        payload.text.trim().length > 0;
      const nextConversation = touchConversation({
        ...activeConversation,
        title: shouldAutoTitle ? createConversationTitle(payload.text) : activeConversation.title,
        messages: [...activeConversation.messages, userMessage, assistantMessage],
      });
      await saveConversation(nextConversation);
      await runGeneration(nextConversation, assistantId);
    },
    [activeConversation, modelName, modelPath, port, runGeneration, sampling, saveConversation],
  );

  const continueFromAssistantMessage = useCallback(
    async (assistantMessageId: string) => {
      if (!activeConversation || abortControllerRef.current) {
        return;
      }
      const assistantIndex = activeConversation.messages.findIndex((m) => m.id === assistantMessageId);
      if (assistantIndex < 0) {
        return;
      }
      const assistant = activeConversation.messages[assistantIndex];
      if (assistant.role !== "assistant") {
        return;
      }
      const canContinue =
        assistant.status === "cancelled" ||
        (assistant.status === "complete" && isLengthLikeFinishReason(assistant.finishReason));
      if (!canContinue) {
        return;
      }

      const priorTokensRaw = assistant.stats?.completionTokens ?? assistant.stats?.generatedTokens ?? 0;
      const priorTokens = Number.isFinite(priorTokensRaw) ? priorTokensRaw : 0;
      const priorContentLen =
        assistant.content.length +
        (assistant.reasoningContent?.trim() ? assistant.reasoningContent.trim().length : 0);
      const primaryMessages = buildContinueRequestMessages(
        activeConversation,
        assistantIndex,
        contextSize,
        sampling.maxTokens,
        CONTINUATION_USER_PROMPT,
        "assistant-tail",
      );

      const nextConversation = touchConversation(
        updateAssistantMessage(activeConversation, assistantMessageId, (message) => ({
          ...message,
          status: "streaming",
          finishReason: undefined,
          error: undefined,
          stats: message.stats
            ? {
                ...message.stats,
                completedAt: null,
                tokensPerSecond: null,
              }
            : createEmptyStats(),
        })),
      );
      await saveConversation(nextConversation);

      const attemptMergedRetry = async (baseConv: ChatConversation, logLine: string) => {
        const assistantIndexAfter = baseConv.messages.findIndex((m) => m.id === assistantMessageId);
        if (assistantIndexAfter < 0) {
          return;
        }
        const mergedMessages = buildContinueRequestMessages(
          baseConv,
          assistantIndexAfter,
          contextSize,
          sampling.maxTokens,
          CONTINUATION_USER_PROMPT,
          "user-merged",
        );
        const convRetry = touchConversation(
          updateAssistantMessage(baseConv, assistantMessageId, (message) => ({
            ...message,
            status: "streaming",
            error: undefined,
            finishReason: undefined,
            stats: message.stats
              ? {
                  ...message.stats,
                  completedAt: null,
                  tokensPerSecond: null,
                }
              : createEmptyStats(),
          })),
        );
        await saveConversation(convRetry);
        appendSystemLog(logLine);
        await runGeneration(convRetry, assistantMessageId, {
          requestMessages: mergedMessages,
          initialCompletionTokens: priorTokens,
        });
      };

      const first = await runGeneration(nextConversation, assistantMessageId, {
        requestMessages: primaryMessages,
        initialCompletionTokens: priorTokens,
      });

      if (first.outcome === "failed") {
        await attemptMergedRetry(
          first.conversation,
          "续写首轮请求失败，已降级为「将已生成助手正文并入末条 user」后重试（兼容不允许末条为 assistant 的 llama-server 构建）。",
        );
        return;
      }

      if (first.outcome === "complete") {
        const afterMsg = first.conversation.messages.find((m) => m.id === assistantMessageId);
        if (!afterMsg || afterMsg.role !== "assistant") {
          return;
        }
        const afterLen =
          afterMsg.content.length +
          (afterMsg.reasoningContent?.trim() ? afterMsg.reasoningContent.trim().length : 0);
        const afterTokRaw = afterMsg.stats?.completionTokens ?? afterMsg.stats?.generatedTokens ?? priorTokens;
        const afterTok = Number.isFinite(afterTokRaw) ? afterTokRaw : priorTokens;
        const noProgress = afterLen === priorContentLen && afterTok <= priorTokens;
        if (noProgress) {
          await attemptMergedRetry(
            first.conversation,
            "续写首轮未产生新内容或 completion 未增长，已降级为「将已生成助手正文并入末条 user」后重试（兼容部分 llama-server 构建）。",
          );
        }
      }
    },
    [activeConversation, appendSystemLog, contextSize, runGeneration, sampling, saveConversation],
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

  const compressActiveConversation = useCallback(async () => {
    if (!activeConversation || !isTauriRuntime()) {
      return;
    }

    const controller = new AbortController();
    try {
      await compressConversationMessages({
        conversation: activeConversation,
        port,
        sampling,
        signal: controller.signal,
        saveConversation,
      });
    } catch (error) {
      appendSystemLog(error instanceof Error ? error.message : String(error));
    }
  }, [activeConversation, appendSystemLog, port, sampling, saveConversation]);

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
    continueFromAssistantMessage,
    compressActiveConversation,
  };
}

async function compressConversationIfNeeded({
  conversation,
  port,
  sampling,
  contextSize,
  signal,
  saveConversation,
}: {
  conversation: ChatConversation;
  port: number;
  sampling: SamplingParameters;
  contextSize: number;
  signal: AbortSignal;
  saveConversation: (conversation: ChatConversation) => Promise<void>;
}): Promise<ChatConversation> {
  if (!conversation.compression.enabled) {
    return conversation;
  }

  const requestRatio = calculatePromptBudgetUsageRatio(
    estimateFullRequestTokens(conversation),
    contextSize,
    sampling.maxTokens,
  );
  const adaptiveTriggerRatio = getAdaptiveCompressionTriggerRatio({
    baseTriggerRatio: conversation.compression.triggerRatio,
    contextSize,
    assistantMode: conversation.assistantMode,
  });
  if (requestRatio <= adaptiveTriggerRatio) {
    return conversation;
  }

  const selected = selectMessagesForCompression(conversation);
  if (selected.compress.length === 0) {
    return conversation;
  }

  return compressSelectedConversationMessages({
    conversation,
    compressMessages: selected.compress,
    port,
    sampling,
    signal,
    saveConversation,
  });
}

async function compressConversationMessages({
  conversation,
  port,
  sampling,
  signal,
  saveConversation,
}: {
  conversation: ChatConversation;
  port: number;
  sampling: SamplingParameters;
  signal: AbortSignal;
  saveConversation: (conversation: ChatConversation) => Promise<void>;
}): Promise<ChatConversation> {
  const selected = selectMessagesForCompression(conversation);
  if (selected.compress.length === 0) {
    return conversation;
  }

  return compressSelectedConversationMessages({
    conversation,
    compressMessages: selected.compress,
    port,
    sampling,
    signal,
    saveConversation,
  });
}

async function compressSelectedConversationMessages({
  conversation,
  compressMessages,
  port,
  sampling,
  signal,
  saveConversation,
}: {
  conversation: ChatConversation;
  compressMessages: ChatMessage[];
  port: number;
  sampling: SamplingParameters;
  signal: AbortSignal;
  saveConversation: (conversation: ChatConversation) => Promise<void>;
}): Promise<ChatConversation> {
  const completion = await completeChatCompletion({
    host: "127.0.0.1",
    port,
    messages: [
      {
        role: "user",
        content: buildCompressionPrompt(conversation, compressMessages),
      },
    ],
    sampling: {
      ...sampling,
      temperature: Math.min(sampling.temperature, 0.2),
      maxTokens: conversation.compression.maxSummaryTokens,
    },
    signal,
  });
  const summary = completion.content.trim();
  if (summary.length === 0) {
    return conversation;
  }

  const compressedThroughMessageId = compressMessages[compressMessages.length - 1].id;
  const compressed = touchConversation(
    mergeConversationMemory(
      conversation,
      summary,
      compressedThroughMessageId,
      compressMessages.length,
    ),
  );
  await saveConversation(compressed);
  return compressed;
}

function calculatePromptBudgetUsageRatio(
  estimatedPromptTokens: number,
  contextSize: number,
  maxTokens: number,
): number {
  const promptBudget = Math.max(0, Math.floor((contextSize - maxTokens) * getAdaptiveSafetyFactor(contextSize)));
  if (promptBudget <= 0) {
    return 1;
  }
  return estimatedPromptTokens / promptBudget;
}

function getAdaptiveCompressionTriggerRatio({
  baseTriggerRatio,
  contextSize,
  assistantMode,
}: {
  baseTriggerRatio: number;
  contextSize: number;
  assistantMode: ChatConversation["assistantMode"];
}): number {
  const clampedBase = clampNumber(baseTriggerRatio, 0.1, 0.99);
  let adjusted = clampedBase;
  if (assistantMode === "coding") {
    adjusted = Math.max(0.1, adjusted - 0.05);
  } else if (assistantMode === "analysis") {
    adjusted = Math.max(0.1, adjusted - 0.02);
  }
  if (Number.isFinite(contextSize) && contextSize > 0) {
    if (contextSize <= 4096) adjusted = Math.max(0.1, adjusted - 0.05);
    if (contextSize >= 16384) adjusted = Math.min(0.99, adjusted + 0.03);
  }
  return clampNumber(adjusted, 0.1, 0.99);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
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

function getCurrentTokensPerSecond(
  conversation: ChatConversation,
  assistantId: string,
  generatedTokens: number,
  streamStartedAt: number,
): number | null {
  const currentStats = conversation.messages.find((message) => message.id === assistantId)?.stats;
  return (
    currentStats?.tokensPerSecond ??
    calculateTokensPerSecond(generatedTokens, streamStartedAt, performance.now())
  );
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
    finishReason: delta.finishReason !== undefined ? delta.finishReason : message.finishReason,
    stats: {
      ...(message.stats ?? createEmptyStats()),
      generatedTokens,
      tokensPerSecond,
      promptTokens: delta.usage ? delta.usage.promptTokens : message.stats?.promptTokens,
      completionTokens: delta.usage ? delta.usage.completionTokens : message.stats?.completionTokens,
      totalTokens: delta.usage ? delta.usage.totalTokens : message.stats?.totalTokens,
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
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
  };
}

const createMessageId = createId;
