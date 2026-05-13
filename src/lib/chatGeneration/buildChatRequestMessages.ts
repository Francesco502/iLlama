import type { ChatRequestMessage } from "../../api/chat";
import { buildAssistantSystemPrompt } from "../assistantProfiles";
import { buildContextWindow } from "../contextBudget";
import { getRequestCandidateMessages } from "../conversationTokenEstimate";
import type { ChatConversation } from "../../types/chat";

export const CONTINUATION_USER_PROMPT =
  "请从上面助手最后一条回复的末尾继续输出，不要复述已经写过的内容；若上一条被中途取消，请接着把未尽部分写完。";

export function buildRequestMessages(
  conversation: ChatConversation,
  contextSize: number,
  maxTokens: number,
): ChatRequestMessage[] {
  const systemPrompt = buildAssistantSystemPrompt(conversation.assistantMode, conversation.systemPrompt);
  const memoryPrompt = conversation.memory.summary.trim()
    ? `长期对话记忆：\n${conversation.memory.summary}`
    : "";
  const window = buildContextWindow({
    systemPrompt: [systemPrompt, memoryPrompt].filter(Boolean).join("\n\n"),
    messages: getRequestCandidateMessages(conversation).filter((message) => {
      if (message.role === "assistant") {
        return message.status === "complete";
      }
      return true;
    }),
    contextSize,
    maxTokens,
  });

  const requestMessages: ChatRequestMessage[] = [];
  if (systemPrompt.trim().length > 0) {
    requestMessages.push({ role: "system", content: systemPrompt });
  }
  if (memoryPrompt.length > 0) {
    requestMessages.push({ role: "system", content: memoryPrompt });
  }
  for (const message of window.messages) {
    if (message.role === "system") {
      continue;
    }
    requestMessages.push({
      role: message.role,
      content: message.content,
      attachments: message.role === "user" ? message.attachments : undefined,
    });
  }
  return requestMessages;
}

export function buildContinueRequestMessages(
  conversation: ChatConversation,
  includeThroughIndex: number,
  contextSize: number,
  maxTokens: number,
  continuationUserText: string,
  mode: "assistant-tail" | "user-merged" = "assistant-tail",
): ChatRequestMessage[] {
  if (mode === "assistant-tail") {
    const tweakedMessages = conversation.messages.slice(0, includeThroughIndex + 1).map((message, index) =>
      index === includeThroughIndex && message.role === "assistant"
        ? { ...message, status: "complete" as const }
        : message,
    );
    const conv: ChatConversation = { ...conversation, messages: tweakedMessages };
    const base = buildRequestMessages(conv, contextSize, maxTokens);
    return [...base, { role: "user", content: continuationUserText }];
  }

  const assistant = conversation.messages[includeThroughIndex];
  if (!assistant || assistant.role !== "assistant") {
    return buildContinueRequestMessages(
      conversation,
      includeThroughIndex,
      contextSize,
      maxTokens,
      continuationUserText,
      "assistant-tail",
    );
  }

  const prefixMessages = conversation.messages.slice(0, includeThroughIndex);
  const convMerged: ChatConversation = { ...conversation, messages: prefixMessages };
  const reasoning = assistant.reasoningContent?.trim();
  const assistantBody = [assistant.content, reasoning ? `[推理片段]\n${reasoning}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const mergedUser = `${continuationUserText}\n\n---\n以下为本轮助手已生成内容（请从末尾续写，勿重复上文）：\n${assistantBody}`;
  const baseMerged = buildRequestMessages(convMerged, contextSize, maxTokens);
  return [...baseMerged, { role: "user", content: mergedUser }];
}
