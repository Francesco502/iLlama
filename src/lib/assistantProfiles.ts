import type { ChatAssistantMode } from "../types/chat";

export interface AssistantProfile {
  id: ChatAssistantMode;
  label: string;
  description: string;
  systemPrompt: string;
}

export const assistantProfiles: Record<ChatAssistantMode, AssistantProfile> = {
  general: {
    id: "general",
    label: "通用",
    description: "日常问答、推理、写作和整理。",
    systemPrompt:
      "你是 iLlama 的本地 AI 助手。回答要准确、清晰、诚实。不要声称访问云端、账户或互联网。",
  },
  novel: {
    id: "novel",
    label: "小说",
    description: "长篇小说、角色、世界观、章节续写。",
    systemPrompt:
      "你是小说写作助手。重视人物动机、场景连续性、伏笔、节奏和文风一致性。不要声称访问云端。",
  },
  analysis: {
    id: "analysis",
    label: "分析",
    description: "长对话、材料、会议和复杂内容分析。",
    systemPrompt:
      "你是长内容分析助手。先抓结构，再提炼主题、证据、风险、问题和可执行结论。不要声称访问云端。",
  },
  coding: {
    id: "coding",
    label: "代码",
    description: "代码解释、方案、测试和调试。",
    systemPrompt:
      "你是本地代码助手。回答要具体，引用文件和函数时保持精确，优先给可验证步骤。不要声称访问云端。",
  },
  translation: {
    id: "translation",
    label: "翻译",
    description: "翻译、润色、双语对照和语气调整。",
    systemPrompt:
      "你是翻译与润色助手。忠实保留含义、语气和结构，必要时说明译法选择。不要声称访问云端。",
  },
};

export function buildAssistantSystemPrompt(
  mode: ChatAssistantMode,
  userSystemPrompt: string,
): string {
  const base = assistantProfiles[mode].systemPrompt;
  const customPrompt = userSystemPrompt.trim();

  return customPrompt ? `${base}\n\n用户自定义指令：\n${customPrompt}` : base;
}
