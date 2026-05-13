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

export function estimateMessageTokens(message: ChatMessage): number {
  const attachmentTokens = (message.attachments ?? []).reduce((sum, attachment) => {
    return sum + estimateAttachmentTokens(attachment.mimeType, attachment.sizeBytes, attachment.name);
  }, 0);
  return estimateTokenCount(message.content) + attachmentTokens;
}

export function getAdaptiveSafetyFactor(contextSize: number): number {
  if (!Number.isFinite(contextSize) || contextSize <= 0) {
    return 0.85;
  }
  if (contextSize <= 4096) return 0.8;
  if (contextSize <= 8192) return 0.83;
  return 0.86;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return Math.floor(value);
}

/**
 * Heuristic cap for max output tokens from estimated prompt usage + ctxSize.
 * For UI hints only (e.g. KV pressure); user confirms changes in sampling settings.
 */
export function suggestMaxOutputTokensHint(params: {
  contextSize: number;
  estimatedPromptTokens: number;
  currentMaxTokens: number;
}): number {
  const { contextSize, estimatedPromptTokens, currentMaxTokens } = params;
  if (!Number.isFinite(contextSize) || contextSize <= 0) {
    return clampInt(currentMaxTokens, 64, 8192);
  }
  const safety = getAdaptiveSafetyFactor(contextSize);
  const promptBudget = Math.ceil(Math.max(0, estimatedPromptTokens) / safety);
  const slack = Math.max(32, Math.floor(contextSize * 0.04));
  const rawHeadroom = contextSize - promptBudget - slack;
  const upper = clampInt(rawHeadroom, 64, Math.max(64, contextSize - 1));
  return Math.min(clampInt(currentMaxTokens, 64, contextSize), upper);
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
  const promptBudget = Math.max(
    0,
    Math.floor((contextSize - answerReserve) * getAdaptiveSafetyFactor(contextSize)),
  );
  const systemTokens = estimateTokenCount(systemPrompt);
  const messageBudget = Math.max(0, promptBudget - systemTokens);
  const newestUserIndex = findNewestUserMessageIndex(messages);
  const guaranteedIndex = newestUserIndex === -1 ? messages.length - 1 : newestUserIndex;
  const guaranteedMessage = messages[guaranteedIndex];

  const keptIds = new Set<string>([guaranteedMessage.id]);
  let estimatedMessageTokens = estimateMessageTokens(guaranteedMessage);

  const candidates: Array<{ message: ChatMessage; index: number; tokens: number }> = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (index === guaranteedIndex) continue;
    const message = messages[index];
    candidates.push({ message, index, tokens: estimateMessageTokens(message) });
  }

  candidates.sort((a, b) => {
    const aHasAttachments = (a.message.attachments?.length ?? 0) > 0;
    const bHasAttachments = (b.message.attachments?.length ?? 0) > 0;
    if (aHasAttachments !== bHasAttachments) return aHasAttachments ? -1 : 1;

    const aHasCodeBlock = a.message.content.includes("```");
    const bHasCodeBlock = b.message.content.includes("```");
    if (aHasCodeBlock !== bHasCodeBlock) return aHasCodeBlock ? -1 : 1;

    return b.index - a.index;
  });

  for (const candidate of candidates) {
    if (estimatedMessageTokens + candidate.tokens > messageBudget) continue;
    keptIds.add(candidate.message.id);
    estimatedMessageTokens += candidate.tokens;
  }

  const trimmedMessageCount = messages.filter((message) => !keptIds.has(message.id)).length;

  const keptMessages = messages.filter((message) => keptIds.has(message.id));

  return {
    messages: keptMessages,
    estimatedPromptTokens: systemTokens + estimatedMessageTokens,
    trimmedMessageCount,
    overBudget: trimmedMessageCount > 0 || estimatedMessageTokens > messageBudget,
  };
}

export function calculateContextUsageRatio(estimatedPromptTokens: number, contextSize: number): number {
  if (contextSize <= 0) return 1;
  return Math.min(1, estimatedPromptTokens / contextSize);
}

function estimateAttachmentTokens(mimeType: string, sizeBytes: number, name?: string): number {
  const safeSizeBytes = Number.isFinite(sizeBytes) ? Math.max(0, sizeBytes) : 0;
  const nameTokens = name ? Math.min(24, estimateTokenCount(name)) : 0;
  if (safeSizeBytes === 0) return nameTokens;

  const lowerMime = mimeType.toLowerCase();
  const sizeKb = safeSizeBytes / 1024;

  if (lowerMime.startsWith("image/")) {
    // Image understanding is relatively expensive vs raw bytes; approximate by size with sane caps.
    // Keep this estimate conservative enough that typical screenshots don't crowd out nearby context.
    // We still cap hard for very large images to avoid runaway budgets.
    return nameTokens + clampInt(Math.round(180 + sizeKb * 0.08), 192, 2048);
  }

  if (lowerMime === "application/pdf") {
    return nameTokens + clampInt(Math.round(300 + sizeKb * 2.0), 256, 8192);
  }

  const looksTextish =
    lowerMime.startsWith("text/") ||
    lowerMime.includes("json") ||
    lowerMime.includes("xml") ||
    lowerMime.includes("yaml") ||
    lowerMime.includes("markdown") ||
    lowerMime.includes("csv");

  if (looksTextish) {
    // Roughly 4-6 chars/token; use 6 bytes/token as a conservative proxy.
    return nameTokens + clampInt(Math.round(120 + safeSizeBytes / 6), 128, 8192);
  }

  // Generic binary: cheaper than text; still not free.
  return nameTokens + clampInt(Math.round(160 + safeSizeBytes / 16), 128, 4096);
}

function findNewestUserMessageIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}
