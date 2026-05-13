import type { ChatRequestMessage } from "../api/chat";
import type { ChatConversation, ChatMessage } from "../types/chat";

export interface CompressionSelection {
  compress: ChatMessage[];
  preserve: ChatMessage[];
}

export function selectMessagesForCompression(conversation: ChatConversation): CompressionSelection {
  const throughId = conversation.memory.compressedThroughMessageId;
  const throughIndex = throughId ? conversation.messages.findIndex((message) => message.id === throughId) : -1;
  const startIndex = throughIndex >= 0 ? throughIndex + 1 : 0;
  const preserveCount = Math.max(2, conversation.compression.preserveRecentTurns * 2);
  const eligibleEnd = Math.max(startIndex, conversation.messages.length - preserveCount);
  const compress = conversation.messages
    .slice(startIndex, eligibleEnd)
    .filter((message) => message.status === "complete" && message.content.trim().length > 0);
  const preserve = conversation.messages.slice(eligibleEnd);

  return { compress, preserve };
}

export function buildCompressionPrompt(conversation: ChatConversation, messages: ChatMessage[]): string {
  const previousSummary = conversation.memory.summary.trim() || "无";
  const transcript = messages.map((message) => `${roleLabel(message.role)}：${message.content}`).join("\n\n") || "无";

  return [
    "你是对话记忆压缩器。请把以下长对话片段压缩为可继续用于后续对话的长期记忆。",
    "目标：在不丢失关键信息的前提下尽量短；优先保留可行动信息与长期有用信息。",
    "保留：事实/决定/人物与设定/未解决问题/用户偏好（尤其输出格式与写作风格）/后续任务/关键约束与边界条件。",
    "删除：寒暄、重复内容、模型推理过程；不包含模型推理过程、隐藏思考或推理链。",
    "格式要求（必须严格遵循）：输出中文 Markdown，且只能包含以下 5 个二级标题（##）：",
    "## 核心事实\n## 用户偏好\n## 人物/设定\n## 未解决问题\n## 下一步",
    "每个标题下用项目符号（- ）列出要点；不要写大段散文；不要添加额外标题。",
    `已有长期记忆：\n${previousSummary}`,
    `新增对话片段：\n${transcript}`,
  ].join("\n\n");
}

export function mergeConversationMemory(
  conversation: ChatConversation,
  summary: string,
  compressedThroughMessageId: string,
  compressedMessageCount: number,
): ChatConversation {
  return {
    ...conversation,
    memory: {
      summary: summary.trim(),
      updatedAt: new Date().toISOString(),
      compressedMessageCount: conversation.memory.compressedMessageCount + compressedMessageCount,
      compressedThroughMessageId,
    },
  };
}

export function buildCompressedRequestMessages(
  conversation: ChatConversation,
  preservedMessages: ChatMessage[],
): ChatRequestMessage[] {
  const messages: ChatRequestMessage[] = [];

  if (conversation.memory.summary.trim().length > 0) {
    messages.push({
      role: "system",
      content: `长期对话记忆：\n${conversation.memory.summary}`,
    });
  }

  for (const message of preservedMessages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "assistant" && message.status !== "complete") {
      continue;
    }
    messages.push({
      role: message.role,
      content: message.content,
      attachments: message.role === "user" ? message.attachments : undefined,
    });
  }

  return messages;
}

function roleLabel(role: ChatMessage["role"]): string {
  if (role === "user") return "用户";
  if (role === "assistant") return "助手";
  return "系统";
}
