import type { ChatAssistantMode } from "../types/chat";

export type WritingActionId =
  | "brainstorm-premise"
  | "create-outline"
  | "character-bible"
  | "draft-chapter"
  | "continue-scene"
  | "rewrite"
  | "expand"
  | "consistency-check"
  | "conversation-summary"
  | "extract-decisions"
  | "extract-open-questions"
  | "extract-timeline";

export interface WritingAction {
  id: WritingActionId;
  label: string;
  modeHint: ChatAssistantMode[];
}

export interface WritingActionPromptInput {
  mode: ChatAssistantMode;
  selectedText: string;
  conversationTitle: string;
}

export const writingActions: WritingAction[] = [
  { id: "brainstorm-premise", label: "灵感", modeHint: ["novel"] },
  { id: "create-outline", label: "大纲", modeHint: ["novel"] },
  { id: "character-bible", label: "角色表", modeHint: ["novel"] },
  { id: "draft-chapter", label: "章节", modeHint: ["novel"] },
  { id: "continue-scene", label: "续写", modeHint: ["novel"] },
  { id: "rewrite", label: "改写", modeHint: ["novel", "translation", "general"] },
  { id: "expand", label: "扩写", modeHint: ["novel", "general"] },
  { id: "consistency-check", label: "一致性", modeHint: ["novel", "analysis"] },
  { id: "conversation-summary", label: "总结", modeHint: ["analysis", "general"] },
  { id: "extract-decisions", label: "决策", modeHint: ["analysis"] },
  { id: "extract-open-questions", label: "问题", modeHint: ["analysis"] },
  { id: "extract-timeline", label: "时间线", modeHint: ["analysis", "novel"] },
];

export function buildWritingActionPrompt(
  actionId: WritingActionId,
  input: WritingActionPromptInput,
): string {
  const selectedText = input.selectedText.trim() || "请基于当前对话上下文执行。";
  const title = input.conversationTitle.trim() || "当前对话";
  const modeLine = `当前助手模式：${input.mode}`;
  const material = `素材：\n${selectedText}`;
  const templates: Record<WritingActionId, string> = {
    "brainstorm-premise": `围绕《${title}》提出 8 个有冲突、有钩子的小说创意。\n${modeLine}\n${material}`,
    "create-outline": `为《${title}》创建三幕式或多章节大纲，包含主要冲突、转折和结局。\n${modeLine}\n${material}`,
    "character-bible": `为《${title}》创建角色设定表，包含目标、恐惧、秘密、关系和弧光。\n${modeLine}\n${material}`,
    "draft-chapter": `为《${title}》请直接产出章节正文。要求有场景、动作、心理、对白和推进。\n${modeLine}\n${material}`,
    "continue-scene": `延续《${title}》当前场景，保持既有文风和人物动机，不重述前文。\n${modeLine}\n${material}`,
    rewrite: `改写下面内容，提升表达、节奏和画面感，同时保留原意。\n${modeLine}\n${material}`,
    expand: `扩写下面内容，增加细节、冲突和感官描写，避免空泛解释。\n${modeLine}\n${material}`,
    "consistency-check": `检查《${title}》中的人物、时间线、设定和语气一致性，列出矛盾和修复建议。\n${modeLine}\n${material}`,
    "conversation-summary": `总结当前对话，输出主题、关键结论、重要上下文和下一步建议。\n${modeLine}\n${material}`,
    "extract-decisions": `从当前对话提取已经做出的决策，按“决策 / 原因 / 影响 / 后续动作”输出。\n${modeLine}\n${material}`,
    "extract-open-questions": `从当前对话提取未解决问题，按优先级排序并说明需要哪些信息。\n${modeLine}\n${material}`,
    "extract-timeline": `从当前对话提取时间线，按发生顺序列出事件、人物和因果关系。\n${modeLine}\n${material}`,
  };

  return templates[actionId];
}
