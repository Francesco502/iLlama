import { useCallback, useRef, useState } from "react";
import { streamChatCompletion, type ChatRequestMessage, type ChatStreamDelta } from "../api/chat";
import { isTauriRuntime } from "../api/tauri";
import { calculateTokensPerSecond, estimateDeltaTokens } from "../lib/runtimeMetrics";
import type { ChatMessage, PendingChatMessage } from "../types/chat";
import type { SamplingParameters } from "../types/domain";

export type RuntimeSmokeMessage = ChatMessage;

interface UseRuntimeSmokeChatOptions {
  port: number;
  modelId: string | null;
  sampling: SamplingParameters;
  modelName: string | null;
  appendSystemLog: (message: string) => void;
}

export function useRuntimeSmokeChat({
  port,
  modelId,
  sampling,
  modelName,
  appendSystemLog,
}: UseRuntimeSmokeChatOptions) {
  const [messages, setMessages] = useState<RuntimeSmokeMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamTokensPerSecond, setStreamTokensPerSecond] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setStreamTokensPerSecond(null);
  }, []);

  const sendMessage = useCallback(
    async (payload: PendingChatMessage) => {
      const text = payload.text.trim();
      if (streaming || (text.length === 0 && payload.attachments.length === 0)) {
        return;
      }
      if (!modelId) {
        appendSystemLog("当前服务尚未探测到可用模型 ID，无法发送测试请求。");
        return;
      }

      const userMessage: RuntimeSmokeMessage = {
        id: createSmokeMessageId(),
        role: "user",
        content: text,
        attachments: payload.attachments,
        createdAt: new Date().toISOString(),
        status: "complete",
      };
      const assistantId = createSmokeMessageId();
      const assistantMessage: RuntimeSmokeMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        reasoningContent: "",
        createdAt: new Date().toISOString(),
        status: "streaming",
        modelSnapshot: {
          modelPath: null,
          modelName,
          port,
          sampling,
        },
      };
      const requestMessages = [...messages, userMessage].map(toRequestMessage);
      const startedAtIso = new Date().toISOString();
      const startedAtMs = performance.now();
      let generatedTokens = 0;

      setMessages((current) => [...current, userMessage, assistantMessage]);
      setStreaming(true);
      setStreamTokensPerSecond(null);

      if (!isTauriRuntime()) {
        setMessages((current) =>
          updateMessage(current, assistantId, {
            content: "这是浏览器预览模式的模拟回复；真实请求会在 Tauri 应用中发送给 llama-server。",
            status: "complete",
          }),
        );
        setStreaming(false);
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        await streamChatCompletion({
          host: "127.0.0.1",
          port,
          modelId,
          messages: requestMessages,
          sampling,
          signal: controller.signal,
          onDelta: (delta) => {
            generatedTokens = delta.usage?.completionTokens ?? generatedTokens + estimateDelta(delta);
            const tokensPerSecond = calculateTokensPerSecond(
              generatedTokens,
              startedAtMs,
              performance.now(),
            );
            setStreamTokensPerSecond(tokensPerSecond);
            setMessages((current) =>
              updateMessageWithDelta(current, assistantId, delta, tokensPerSecond, generatedTokens),
            );
          },
        });
        setMessages((current) =>
          updateMessage(current, assistantId, {
            status: "complete",
            stats: {
              startedAt: startedAtIso,
              completedAt: new Date().toISOString(),
              generatedTokens,
              tokensPerSecond: calculateTokensPerSecond(generatedTokens, startedAtMs, performance.now()),
            },
          }),
        );
      } catch (error) {
        const aborted = controller.signal.aborted;
        const message = error instanceof Error ? error.message : String(error);
        if (!aborted) {
          appendSystemLog(message);
        }
        setMessages((current) =>
          updateMessage(current, assistantId, {
            status: aborted ? "cancelled" : "failed",
            error: aborted ? undefined : message,
          }),
        );
      } finally {
        abortControllerRef.current = null;
        setStreaming(false);
      }
    },
    [appendSystemLog, messages, modelId, modelName, port, sampling, streaming],
  );

  return {
    messages,
    streaming,
    streamTokensPerSecond,
    sendMessage,
    cancelGeneration,
    clearMessages,
  };
}

function toRequestMessage(message: RuntimeSmokeMessage): ChatRequestMessage {
  return {
    role: message.role,
    content: message.content,
    attachments: message.attachments,
  };
}

function estimateDelta(delta: ChatStreamDelta): number {
  return estimateDeltaTokens(delta.contentDelta || delta.reasoningDelta);
}

function updateMessage(
  messages: RuntimeSmokeMessage[],
  id: string,
  patch: Partial<RuntimeSmokeMessage>,
): RuntimeSmokeMessage[] {
  return messages.map((message) => (message.id === id ? { ...message, ...patch } : message));
}

function updateMessageWithDelta(
  messages: RuntimeSmokeMessage[],
  id: string,
  delta: ChatStreamDelta,
  tokensPerSecond: number | null,
  generatedTokens: number,
): RuntimeSmokeMessage[] {
  return messages.map((message) => {
    if (message.id !== id) {
      return message;
    }
    return {
      ...message,
      content: `${message.content}${delta.contentDelta}`,
      reasoningContent: `${message.reasoningContent ?? ""}${delta.reasoningDelta}`,
      finishReason: delta.finishReason ?? message.finishReason,
      stats: {
        startedAt: message.stats?.startedAt ?? message.createdAt,
        completedAt: null,
        generatedTokens,
        tokensPerSecond,
        promptTokens: delta.usage?.promptTokens ?? message.stats?.promptTokens,
        completionTokens: delta.usage?.completionTokens ?? message.stats?.completionTokens,
        totalTokens: delta.usage?.totalTokens ?? message.stats?.totalTokens,
      },
    };
  });
}

function createSmokeMessageId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
