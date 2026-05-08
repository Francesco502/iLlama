import { useCallback, useRef, useState } from "react";
import { streamChatCompletion } from "../api/chat";
import { isTauriRuntime } from "../api/tauri";
import { calculateTokensPerSecond, countStreamToken } from "../lib/runtimeMetrics";
import type {
  ChatImageAttachment,
  ChatMessage,
  PendingChatMessage,
  SamplingParameters,
} from "../types/domain";

const now = new Date().toISOString();

const welcomeMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "模型启动并通过健康检查后，可以在这里直接对话。",
    createdAt: now,
  },
];

interface UseChatSessionOptions {
  port: number;
  sampling: SamplingParameters;
  appendSystemLog: (message: string) => void;
}

export function useChatSession({ port, sampling, appendSystemLog }: UseChatSessionOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>(welcomeMessages);
  const [streaming, setStreaming] = useState(false);
  const [streamTokensPerSecond, setStreamTokensPerSecond] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSendMessage = useCallback(
    async (payload: PendingChatMessage) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: payload.text,
        attachments: payload.attachments,
        createdAt: new Date().toISOString(),
      };
      const assistantId = crypto.randomUUID();

      setMessages((current) => [
        ...stripOldAttachmentData(current),
        userMessage,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          streaming: true,
        },
      ]);

      if (!isTauriRuntime()) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content:
                    payload.attachments.length > 0
                      ? "这是浏览器预览模式的模拟回复；真实多模态输入会在 Tauri 应用中发送给 llama-server。"
                      : "这是浏览器预览模式的模拟回复。",
                  streaming: false,
                }
              : message,
          ),
        );
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setStreaming(true);
      setStreamTokensPerSecond(null);
      let generatedTokens = 0;
      const streamStartedAt = performance.now();

      try {
        const requestMessages = [...stripOldAttachmentData(messages), userMessage].map(
          (message) => ({
            role: message.role,
            content: message.content,
            attachments: message.attachments,
          }),
        );

        await streamChatCompletion({
          host: "127.0.0.1",
          port,
          messages: requestMessages,
          sampling,
          signal: controller.signal,
          onToken: (token) => {
            generatedTokens += countStreamToken(token);
            setStreamTokensPerSecond(
              calculateTokensPerSecond(generatedTokens, streamStartedAt, performance.now()),
            );
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${token}`, streaming: true }
                  : message,
              ),
            );
          },
        });
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, streaming: false } : message,
          ),
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!controller.signal.aborted) {
          appendSystemLog(errorMessage);
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: controller.signal.aborted ? message.content : errorMessage,
                  streaming: false,
                }
              : message,
          ),
        );
      } finally {
        setStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [messages, port, sampling, appendSystemLog],
  );

  const handleCancelGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    setStreaming(false);
    appendSystemLog("已取消当前生成。");
  }, [appendSystemLog]);

  const handleClearChat = useCallback(() => {
    setMessages(welcomeMessages);
    setStreamTokensPerSecond(null);
    appendSystemLog("已清空对话历史。");
  }, [appendSystemLog]);

  return {
    messages,
    streaming,
    streamTokensPerSecond,
    handleSendMessage,
    handleCancelGeneration,
    handleClearChat,
  };
}

function stripOldAttachmentData(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (!message.attachments || message.attachments.length === 0) {
      return message;
    }
    return {
      ...message,
      attachments: message.attachments.map(
        (attachment): ChatImageAttachment => ({
          ...attachment,
          dataUrl: "",
        }),
      ),
    };
  });
}
