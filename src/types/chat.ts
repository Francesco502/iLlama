import type { SamplingParameters } from "./domain";

export type ChatMessageRole = "system" | "user" | "assistant";

export type ChatMessageStatus = "complete" | "streaming" | "cancelled" | "failed";

export type ChatAttachmentPersistence = "memory" | "thumbnail" | "full";

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  thumbnailUrl?: string;
  persistedPath?: string;
  persistence: ChatAttachmentPersistence;
}

export interface ChatGenerationStats {
  startedAt: string;
  completedAt: string | null;
  generatedTokens: number;
  tokensPerSecond: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  reasoningStartedAt?: string;
  reasoningCompletedAt?: string;
}

export interface ChatModelSnapshot {
  modelPath: string | null;
  modelName: string | null;
  port: number;
  sampling: SamplingParameters;
}

/** OpenAI / llama-server `finish_reason` (e.g. `stop`, `length`, `max_tokens`). */
export type ChatFinishReason = string | null;

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  reasoningContent?: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  updatedAt?: string;
  status: ChatMessageStatus;
  error?: string;
  /** Set when the server reports `finish_reason` (streaming last chunk or non-streaming). */
  finishReason?: ChatFinishReason;
  stats?: ChatGenerationStats;
  modelSnapshot?: ChatModelSnapshot;
}

export interface PendingChatMessage {
  text: string;
  attachments: ChatAttachment[];
}
