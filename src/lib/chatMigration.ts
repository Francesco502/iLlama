import type {
  ChatAttachment,
  ChatAttachmentPersistence,
  ChatAssistantMode,
  ChatCompressionSettings,
  ChatConversation,
  ChatConversationSchemaVersion,
  ChatConversationMemory,
  ChatConversationV2,
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
} from "../types/chat";

export const defaultCompressionSettings: ChatCompressionSettings = {
  enabled: true,
  triggerRatio: 0.82,
  preserveRecentTurns: 6,
  maxSummaryTokens: 700,
};

export const emptyConversationMemory: ChatConversationMemory = {
  summary: "",
  updatedAt: null,
  compressedMessageCount: 0,
  compressedThroughMessageId: null,
};

const assistantModes = new Set<ChatAssistantMode>([
  "general",
  "novel",
  "analysis",
  "coding",
  "translation",
]);

const messageRoles = new Set<ChatMessageRole>(["system", "user", "assistant"]);
const messageStatuses = new Set<ChatMessageStatus>(["complete", "streaming", "cancelled", "failed"]);
const attachmentPersistences = new Set<ChatAttachmentPersistence>(["memory", "thumbnail", "full"]);

type LegacyChatAttachmentInput = Partial<Omit<ChatAttachment, "persistence">> & {
  persistence?: ChatAttachmentPersistence | null;
};

type LegacyChatMessageInput = Partial<Omit<ChatMessage, "attachments">> & {
  role?: ChatMessageRole | string | null;
  status?: ChatMessageStatus | string | null;
  attachments?: LegacyChatAttachmentInput[] | null;
};

export type LegacyChatConversationInput = Partial<
  Omit<ChatConversationV2, "schemaVersion" | "assistantMode" | "compression" | "memory" | "messages">
> & {
  id: string;
  schemaVersion?: ChatConversationSchemaVersion;
  assistantMode?: ChatAssistantMode | string | null;
  compression?: Partial<ChatCompressionSettings> | null;
  memory?: Partial<ChatConversationMemory> | null;
  messages?: LegacyChatMessageInput[] | null;
};

export function normalizeChatConversation(conversation: LegacyChatConversationInput): ChatConversation {
  const createdAt = conversation.createdAt ?? new Date().toISOString();
  const messages = normalizeMessages(conversation.messages, createdAt);

  return {
    id: conversation.id,
    schemaVersion: 2,
    title: conversation.title?.trim() || "新对话",
    createdAt,
    updatedAt: conversation.updatedAt ?? createdAt,
    pinned: conversation.pinned ?? false,
    archived: conversation.archived ?? false,
    messageCount: conversation.messageCount ?? messages.length,
    lastMessagePreview: conversation.lastMessagePreview ?? "",
    modelPath: conversation.modelPath ?? null,
    modelName: conversation.modelName ?? null,
    assistantMode: isAssistantMode(conversation.assistantMode) ? conversation.assistantMode : "general",
    systemPrompt: conversation.systemPrompt ?? "",
    compression: {
      ...defaultCompressionSettings,
      ...(conversation.compression ?? {}),
    },
    memory: {
      ...emptyConversationMemory,
      ...(conversation.memory ?? {}),
    },
    messages,
  };
}

function normalizeMessages(messages: LegacyChatMessageInput[] | null | undefined, createdAt: string): ChatMessage[] {
  return (messages ?? []).map((message, index) => ({
    id: message.id ?? `message-${index + 1}`,
    role: isMessageRole(message.role) ? message.role : "user",
    content: message.content ?? "",
    reasoningContent: message.reasoningContent,
    attachments: message.attachments ? normalizeAttachments(message.attachments) : undefined,
    createdAt: message.createdAt ?? createdAt,
    updatedAt: message.updatedAt,
    status: isMessageStatus(message.status) ? message.status : "complete",
    error: message.error,
    finishReason:
      typeof message.finishReason === "string" || message.finishReason === null
        ? message.finishReason
        : undefined,
    stats: message.stats,
    modelSnapshot: message.modelSnapshot,
  }));
}

function normalizeAttachments(attachments: LegacyChatAttachmentInput[]): ChatAttachment[] {
  return attachments.map((attachment, index) => ({
    id: attachment.id ?? `attachment-${index + 1}`,
    name: attachment.name ?? "attachment",
    mimeType: attachment.mimeType ?? "application/octet-stream",
    sizeBytes: attachment.sizeBytes ?? 0,
    dataUrl: attachment.dataUrl ?? "",
    thumbnailUrl: attachment.thumbnailUrl,
    persistedPath: attachment.persistedPath,
    persistence: isAttachmentPersistence(attachment.persistence) ? attachment.persistence : "memory",
  }));
}

function isAssistantMode(mode: unknown): mode is ChatAssistantMode {
  return typeof mode === "string" && assistantModes.has(mode as ChatAssistantMode);
}

function isMessageRole(role: unknown): role is ChatMessageRole {
  return typeof role === "string" && messageRoles.has(role as ChatMessageRole);
}

function isMessageStatus(status: unknown): status is ChatMessageStatus {
  return typeof status === "string" && messageStatuses.has(status as ChatMessageStatus);
}

function isAttachmentPersistence(persistence: unknown): persistence is ChatAttachmentPersistence {
  return typeof persistence === "string" && attachmentPersistences.has(persistence as ChatAttachmentPersistence);
}
