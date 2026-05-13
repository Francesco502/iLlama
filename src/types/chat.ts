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

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  messageCount: number;
  lastMessagePreview: string;
  modelPath: string | null;
  modelName: string | null;
}

export type ChatConversationSchemaVersion = 1 | 2;

export type ChatAssistantMode = "general" | "novel" | "analysis" | "coding" | "translation";

export interface ChatCompressionSettings {
  enabled: boolean;
  triggerRatio: number;
  preserveRecentTurns: number;
  maxSummaryTokens: number;
}

export interface ChatConversationMemory {
  summary: string;
  updatedAt: string | null;
  compressedMessageCount: number;
  compressedThroughMessageId: string | null;
}

export interface ChatConversationV2 extends ChatConversationSummary {
  schemaVersion: 2;
  assistantMode: ChatAssistantMode;
  systemPrompt: string;
  compression: ChatCompressionSettings;
  memory: ChatConversationMemory;
  messages: ChatMessage[];
}

export type ChatConversation = ChatConversationV2;

export interface PendingChatMessage {
  text: string;
  attachments: ChatAttachment[];
}
