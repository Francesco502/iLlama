import type { ChatAttachment, ChatMessage } from "../types/chat";
import type { SamplingParameters } from "../types/domain";

export interface ChatRequestMessage {
  role: ChatMessage["role"];
  content: string;
  attachments?: ChatAttachment[];
}

interface ChatCompletionBodyOptions {
  modelId: string;
  messages: ChatRequestMessage[];
  sampling: SamplingParameters;
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatStreamDelta {
  contentDelta: string;
  reasoningDelta: string;
  usage?: ChatTokenUsage | null;
  /** Present only on chunks where the server sets `choices[0].finish_reason` (non-empty string). */
  finishReason?: string;
}

export interface ChatTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionMessage {
  content: string;
  reasoningContent: string;
  usage?: ChatTokenUsage | null;
  finishReason?: string | null;
}

export interface RuntimeCapabilities {
  multimodal: boolean | null;
}

interface ChatCompletionOptions {
  host: string;
  port: number;
  modelId: string;
  messages: ChatRequestMessage[];
  sampling: SamplingParameters;
  signal?: AbortSignal;
}

interface StreamChatOptions extends ChatCompletionOptions {
  onToken?: (token: string) => void;
  onDelta?: (delta: ChatStreamDelta) => void;
}

const CHAT_REQUEST_TIMEOUT_MS = 120_000;
const MODELS_REQUEST_TIMEOUT_MS = 5_000;

export async function streamChatCompletion(options: StreamChatOptions): Promise<void> {
  const timed = createTimedSignal(options.signal, CHAT_REQUEST_TIMEOUT_MS, "聊天请求超过 120 秒未完成。");
  try {
    await streamChatCompletionRequest({ ...options, signal: timed.signal });
  } finally {
    timed.dispose();
  }
}

async function streamChatCompletionRequest({
  host,
  port,
  modelId,
  messages,
  sampling,
  signal,
  onToken,
  onDelta,
}: StreamChatOptions): Promise<void> {
  await assertImageInputSupported({ host, port, messages, signal });

  const response = await fetch(`http://${host}:${port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildChatCompletionBody({ modelId, messages, sampling, stream: true })),
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

      const delta = parseDeltaEvent(payload);
      if (
        delta.contentDelta ||
        delta.reasoningDelta ||
        delta.usage !== undefined ||
        delta.finishReason !== undefined
      ) {
        onDelta?.(delta);
      }
      if (delta.contentDelta || delta.reasoningDelta) {
        onToken?.(delta.contentDelta || delta.reasoningDelta);
      }
    }
  }
}

export async function completeChatCompletion(
  options: ChatCompletionOptions,
): Promise<ChatCompletionMessage> {
  const timed = createTimedSignal(options.signal, CHAT_REQUEST_TIMEOUT_MS, "聊天请求超过 120 秒未完成。");
  try {
    return await completeChatCompletionRequest({ ...options, signal: timed.signal });
  } finally {
    timed.dispose();
  }
}

async function completeChatCompletionRequest({
  host,
  port,
  modelId,
  messages,
  sampling,
  signal,
}: ChatCompletionOptions): Promise<ChatCompletionMessage> {
  await assertImageInputSupported({ host, port, messages, signal });

  const response = await fetch(`http://${host}:${port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildChatCompletionBody({ modelId, messages, sampling, stream: false })),
    signal,
  });

  if (!response.ok) {
    throw new Error(`聊天请求失败：HTTP ${response.status}`);
  }

  return parseCompletionMessage(await response.json());
}

export function buildChatCompletionBody({
  modelId,
  messages,
  sampling,
  stream = false,
}: ChatCompletionBodyOptions & { stream?: boolean }) {
  return {
    model: modelId,
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

async function assertImageInputSupported({
  host,
  port,
  messages,
  signal,
}: Pick<ChatCompletionOptions, "host" | "port" | "messages" | "signal">): Promise<void> {
  if (!hasImageAttachments(messages)) {
    return;
  }

  const capabilities = await fetchRuntimeCapabilities(host, port, signal);
  if (capabilities.multimodal === false) {
    throw new Error("当前 llama-server 未启用多模态能力；请为视觉模型选择对应的 mmproj projector 后重启。");
  }
}

function hasImageAttachments(messages: ChatRequestMessage[]): boolean {
  return messages.some((message) =>
    (message.attachments ?? []).some(
      (attachment) =>
        attachment.dataUrl.length > 0 && attachment.mimeType.toLowerCase().startsWith("image/"),
    ),
  );
}

async function fetchRuntimeCapabilities(
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<RuntimeCapabilities> {
  const timed = createTimedSignal(signal, MODELS_REQUEST_TIMEOUT_MS, "模型能力检测超过 5 秒未完成。");
  try {
    const response = await fetch(`http://${host}:${port}/v1/models`, { signal: timed.signal });
    if (!response.ok) {
      return { multimodal: null };
    }
    return parseRuntimeCapabilities(await response.json());
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return { multimodal: null };
  } finally {
    timed.dispose();
  }
}

function createTimedSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  message: string,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException(message, "TimeoutError")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

export function parseRuntimeCapabilities(payload: unknown): RuntimeCapabilities {
  const models = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [payload];
  let sawTextOnlyCapabilities = false;

  for (const model of models) {
    const detected = detectModelMultimodalCapability(model);
    if (detected === true) {
      return { multimodal: true };
    }
    if (detected === false) {
      sawTextOnlyCapabilities = true;
    }
  }

  return { multimodal: sawTextOnlyCapabilities ? false : null };
}

function detectModelMultimodalCapability(model: unknown): boolean | null {
  if (!isRecord(model)) {
    return null;
  }

  const direct = detectBooleanCapabilityFields(model);
  if (direct !== null) {
    return direct;
  }

  for (const key of ["capabilities", "modalities", "features"]) {
    if (key in model) {
      const detected = inspectCapabilityValue(model[key], true);
      if (detected !== null) {
        return detected;
      }
    }
  }

  for (const key of ["meta", "metadata"]) {
    if (key in model) {
      const detected = detectModelMultimodalCapability(model[key]);
      if (detected !== null) {
        return detected;
      }
    }
  }

  return null;
}

function inspectCapabilityValue(value: unknown, textOnlyIfKnown: boolean): boolean | null {
  if (Array.isArray(value)) {
    const normalized = value.filter((item): item is string => typeof item === "string").map(normalizeCapability);
    if (normalized.some(isMultimodalCapabilityName)) {
      return true;
    }
    return textOnlyIfKnown && normalized.length > 0 ? false : null;
  }

  if (typeof value === "string") {
    return isMultimodalCapabilityName(normalizeCapability(value))
      ? true
      : textOnlyIfKnown
        ? false
        : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const direct = detectBooleanCapabilityFields(value);
  if (direct !== null) {
    return direct;
  }

  for (const key of ["capabilities", "modalities", "features"]) {
    if (key in value) {
      const detected = inspectCapabilityValue(value[key], true);
      if (detected !== null) {
        return detected;
      }
    }
  }

  return textOnlyIfKnown && Object.keys(value).length > 0 ? false : null;
}

function detectBooleanCapabilityFields(value: Record<string, unknown>): boolean | null {
  let sawExplicitFalse = false;
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = normalizeCapability(key);
    if (!isMultimodalCapabilityName(normalizedKey)) {
      continue;
    }
    if (raw === true) {
      return true;
    }
    if (raw === false) {
      sawExplicitFalse = true;
    }
  }
  return sawExplicitFalse ? false : null;
}

function normalizeCapability(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isMultimodalCapabilityName(value: string): boolean {
  return (
    value === "multimodal" ||
    value === "vision" ||
    value === "image" ||
    value === "images" ||
    value === "image_input" ||
    value === "input_image"
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

function buildMessageContent(message: ChatRequestMessage): string | ChatContentPart[] {
  // Only include attachments that still have their full data URL
  // (historical messages have dataUrl stripped to save memory).
  const attachments = (message.attachments ?? []).filter((a) => a.dataUrl.length > 0);
  if (attachments.length === 0) {
    return message.content;
  }

  const imageAttachments = attachments.filter((a) => a.mimeType.toLowerCase().startsWith("image/"));
  const textAttachments = attachments.filter(
    (a) => !a.mimeType.toLowerCase().startsWith("image/") && isTextLikeAttachmentMime(a.mimeType, a.name),
  );

  if (imageAttachments.length === 0 && textAttachments.length === 0) {
    return message.content;
  }

  let mergedText = message.content.trimEnd();
  for (const attachment of textAttachments) {
    const body = decodeAttachmentPlainText(attachment.dataUrl);
    if (body == null) {
      continue;
    }
    const block = `\n\n---\n[附件: ${attachment.name}]\n${body}`;
    mergedText = mergedText ? `${mergedText}${block}` : block.trimStart();
  }

  if (imageAttachments.length === 0) {
    return mergedText;
  }

  const parts: ChatContentPart[] = [];
  if (mergedText.length > 0) {
    parts.push({ type: "text", text: mergedText });
  }

  for (const attachment of imageAttachments) {
    parts.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
  }

  if (parts.length === 1 && parts[0]!.type === "text") {
    return parts[0].text;
  }
  return parts;
}

function isTextLikeAttachmentMime(mimeType: string, name: string): boolean {
  const m = mimeType.toLowerCase();
  if (m.startsWith("text/")) return true;
  if (m === "application/json" || m.includes("json")) return true;
  if (m.includes("xml") || m.includes("yaml") || m.includes("csv") || m.includes("markdown")) return true;
  return /\.(txt|md|mdx|json|csv|ts|tsx|js|jsx|mjs|cjs|rs|py|go|java|kt|toml|yaml|yml|html|css|sh|bash)$/i.test(
    name,
  );
}

/** Decode data URL body as UTF-8 text (for composer "snippet" attachments). */
export function decodeAttachmentPlainText(dataUrl: string): string | null {
  const trimmed = dataUrl.trim();
  const base64Match = /^data:[^;]*;base64,(.+)$/i.exec(trimmed);
  if (base64Match) {
    try {
      return decodeBase64Utf8(base64Match[1].replace(/\s/g, ""));
    } catch {
      return null;
    }
  }
  const comma = trimmed.indexOf(",");
  if (comma < 0) {
    return null;
  }
  const meta = trimmed.slice(0, comma);
  if (!/^data:/i.test(meta)) {
    return null;
  }
  const payload = trimmed.slice(comma + 1);
  try {
    return decodeURIComponent(payload.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function parseCompletionMessage(payload: unknown): ChatCompletionMessage {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return emptyCompletionMessage();
  }

  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    return emptyCompletionMessage();
  }

  const base: ChatCompletionMessage = {
    content: typeof choice.message.content === "string" ? choice.message.content : "",
    reasoningContent:
      typeof choice.message.reasoning_content === "string" ? choice.message.reasoning_content : "",
  };

  if ("finish_reason" in choice) {
    const fr = choice.finish_reason;
    base.finishReason = typeof fr === "string" && fr.length > 0 ? fr : null;
  }

  // Align usage semantics with streaming:
  // - undefined: server did not include `usage`
  // - null: server included `usage` but we couldn't parse it
  // - object: valid usage
  if ("usage" in payload) {
    base.usage = parseUsage(payload);
  }
  return base;
}

export function parseUsage(payload: unknown): ChatTokenUsage | null {
  if (!isRecord(payload) || !isRecord(payload.usage)) {
    return null;
  }
  const usage = payload.usage;

  const promptTokens = toFiniteNonNegativeInt(usage.prompt_tokens);
  const completionTokens = toFiniteNonNegativeInt(usage.completion_tokens);
  const totalTokens = toFiniteNonNegativeInt(usage.total_tokens);

  if (promptTokens === null || completionTokens === null || totalTokens === null) {
    return null;
  }
  return { promptTokens, completionTokens, totalTokens };
}

export function parseDeltaEvent(payload: string): ChatStreamDelta {
  try {
    const parsed = JSON.parse(payload) as unknown;
    const parsedRecord = isRecord(parsed) ? parsed : null;
    const usage = parsedRecord && "usage" in parsedRecord ? parseUsage(parsedRecord) : undefined;

    const parsedChoices = parsedRecord?.choices;
    const choices = Array.isArray(parsedChoices) ? parsedChoices : undefined;
    const choice0 = choices?.[0];
    const delta = isRecord(choice0) && isRecord(choice0.delta) ? choice0.delta : null;

    let finishReason: string | undefined = undefined;
    if (isRecord(choice0) && "finish_reason" in choice0) {
      const fr = choice0.finish_reason;
      if (typeof fr === "string" && fr.length > 0) {
        finishReason = fr;
      }
    }

    const base: Omit<ChatStreamDelta, "usage"> = {
      contentDelta: typeof delta?.content === "string" ? delta.content : "",
      reasoningDelta: typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "",
      ...(finishReason !== undefined ? { finishReason } : {}),
    };
    return usage === undefined ? base : { ...base, usage };
  } catch {
    return { contentDelta: "", reasoningDelta: "" };
  }
}

export function parseDeltaToken(payload: string): string {
  const delta = parseDeltaEvent(payload);
  return delta.contentDelta || delta.reasoningDelta;
}

function emptyCompletionMessage(): ChatCompletionMessage {
  return { content: "", reasoningContent: "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0) {
    return null;
  }
  return Math.floor(value);
}

/** True when the model stopped because output hit `max_tokens` / context output cap. */
export function isLengthLikeFinishReason(reason: string | null | undefined): boolean {
  if (reason == null || typeof reason !== "string") {
    return false;
  }
  const normalized = reason.trim().toLowerCase();
  return normalized === "length" || normalized === "max_tokens";
}
