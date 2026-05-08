import type { ChatImageAttachment, ChatMessage, SamplingParameters } from "../types/domain";

export interface ChatRequestMessage {
  role: ChatMessage["role"];
  content: string;
  attachments?: ChatImageAttachment[];
}

interface ChatCompletionBodyOptions {
  messages: ChatRequestMessage[];
  sampling: SamplingParameters;
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface StreamChatOptions {
  host: string;
  port: number;
  messages: ChatRequestMessage[];
  sampling: SamplingParameters;
  signal?: AbortSignal;
  onToken: (token: string) => void;
}

export async function streamChatCompletion({
  host,
  port,
  messages,
  sampling,
  signal,
  onToken,
}: StreamChatOptions): Promise<void> {
  const response = await fetch(`http://${host}:${port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildChatCompletionBody({ messages, sampling, stream: true })),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`聊天请求失败：HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        return;
      }

      const token = parseDeltaToken(payload);
      if (token) {
        onToken(token);
      }
    }
  }
}

export function buildChatCompletionBody({
  messages,
  sampling,
  stream = false,
}: ChatCompletionBodyOptions & { stream?: boolean }) {
  return {
    model: "local",
    stream,
    messages: messages.map((message) => ({
      role: message.role,
      content: buildMessageContent(message),
    })),
    temperature: sampling.temperature,
    top_p: sampling.topP,
    top_k: sampling.topK,
    min_p: sampling.minP,
    repeat_penalty: sampling.repeatPenalty,
    repeat_last_n: sampling.repeatLastN,
    seed: sampling.seed ?? undefined,
    max_tokens: sampling.maxTokens,
    stop: sampling.stop.length > 0 ? sampling.stop : undefined,
  };
}

function buildMessageContent(message: ChatRequestMessage): string | ChatContentPart[] {
  // Only include attachments that still have their full data URL
  // (historical messages have dataUrl stripped to save memory).
  const attachments = (message.attachments ?? []).filter((a) => a.dataUrl.length > 0);
  if (attachments.length === 0) {
    return message.content;
  }

  const parts: ChatContentPart[] = [];
  if (message.content.trim().length > 0) {
    parts.push({ type: "text", text: message.content });
  }

  for (const attachment of attachments) {
    parts.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
  }

  return parts;
}

export function parseDeltaToken(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
    };
    return parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.delta?.reasoning_content ?? "";
  } catch {
    return "";
  }
}
