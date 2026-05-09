import type { ChatMessage } from "../types/chat";

export interface ContextWindowInput {
  systemPrompt: string;
  messages: ChatMessage[];
  contextSize: number;
  maxTokens: number;
}

export interface ContextWindowResult {
  messages: ChatMessage[];
  estimatedPromptTokens: number;
  trimmedMessageCount: number;
  overBudget: boolean;
}

export function estimateTokenCount(text: string): number {
  const asciiWords = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
  const otherChars = text.replace(/[A-Za-z0-9_\s\u3400-\u9FFF\uF900-\uFAFF]/g, "").length;
  return Math.ceil(asciiWords * 1.3 + cjkChars * 1.1 + otherChars * 0.5);
}

export function buildContextWindow({
  systemPrompt,
  messages,
  contextSize,
  maxTokens,
}: ContextWindowInput): ContextWindowResult {
  if (messages.length === 0) {
    return {
      messages: [],
      estimatedPromptTokens: estimateTokenCount(systemPrompt),
      trimmedMessageCount: 0,
      overBudget: false,
    };
  }

  const answerReserve = Math.max(0, maxTokens);
  const promptBudget = Math.max(0, Math.floor((contextSize - answerReserve) * 0.85));
  const systemTokens = estimateTokenCount(systemPrompt);
  const messageBudget = Math.max(0, promptBudget - systemTokens);
  const newestMessage = messages[messages.length - 1];
  const keptReversed: ChatMessage[] = [newestMessage];
  let estimatedMessageTokens = estimateMessageTokens(newestMessage);

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    const tokens = estimateMessageTokens(message);
    if (estimatedMessageTokens + tokens > messageBudget) {
      continue;
    }
    keptReversed.push(message);
    estimatedMessageTokens += tokens;
  }

  const keptIds = new Set(keptReversed.map((message) => message.id));
  const trimmedMessageCount = messages.filter((message) => !keptIds.has(message.id)).length;

  return {
    messages: keptReversed.reverse(),
    estimatedPromptTokens: systemTokens + estimatedMessageTokens,
    trimmedMessageCount,
    overBudget: trimmedMessageCount > 0 || estimatedMessageTokens > messageBudget,
  };
}

function estimateMessageTokens(message: ChatMessage): number {
  const attachmentTokens = (message.attachments?.length ?? 0) * 256;
  return estimateTokenCount(message.content) + attachmentTokens;
}
