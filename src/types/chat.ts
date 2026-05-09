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
  /**
   * Optional during the v1-to-v2 component migration. New persisted v2
   * conversations should always set this explicitly.
   */
  persistence?: ChatAttachmentPersistence;
}

export interface ChatGenerationStats {
  startedAt: string;
  completedAt: string | null;
  generatedTokens: number;
  tokensPerSecond: number | null;
  reasoningStartedAt?: string;
  reasoningCompletedAt?: string;
}

export interface ChatModelSnapshot {
  modelPath: string | null;
  modelName: string | null;
  port: number;
  sampling: SamplingParameters;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  reasoningContent?: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  updatedAt?: string;
  /**
   * Optional until the legacy in-memory chat panel is replaced by the v2
   * workspace. New v2 messages should always set a status.
   */
  status?: ChatMessageStatus;
  /**
   * Legacy streaming marker used by the v1 chat panel during migration.
   */
  streaming?: boolean;
  error?: string;
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

export interface ChatConversation extends ChatConversationSummary {
  schemaVersion: 1;
  systemPrompt: string;
  messages: ChatMessage[];
}

export interface PendingChatMessage {
  text: string;
  attachments: ChatAttachment[];
}
