import { describe, expect, it } from "vitest";
import { buildWritingActionPrompt, writingActions } from "./writingActions";
import type { ChatAssistantMode } from "../types/chat";

describe("writing actions", () => {
  it("includes all novel and conversation analysis actions", () => {
    expect(writingActions.map((action) => action.id)).toEqual([
      "brainstorm-premise",
      "create-outline",
      "character-bible",
      "draft-chapter",
      "continue-scene",
      "rewrite",
      "expand",
      "consistency-check",
      "conversation-summary",
      "extract-decisions",
      "extract-open-questions",
      "extract-timeline",
    ]);
  });

  it("uses ChatAssistantMode arrays for action mode hints", () => {
    const knownModes: ChatAssistantMode[] = ["general", "novel", "analysis", "coding", "translation"];

    writingActions.forEach((action) => {
      expect(Array.isArray(action.modeHint)).toBe(true);
      action.modeHint.forEach((mode) => {
        expect(knownModes).toContain(mode);
      });
    });
  });

  it("builds a chapter drafting prompt from user context", () => {
    const prompt = buildWritingActionPrompt("draft-chapter", {
      mode: "novel",
      selectedText: "女主发现旧电台仍在广播。",
      conversationTitle: "海边灯塔",
    });

    expect(prompt).toContain("海边灯塔");
    expect(prompt).toContain("女主发现旧电台仍在广播。");
    expect(prompt).toContain("请直接产出章节正文");
  });

  it("uses current conversation context when selected text is empty", () => {
    const prompt = buildWritingActionPrompt("conversation-summary", {
      mode: "analysis",
      selectedText: "  ",
      conversationTitle: "",
    });

    expect(prompt).toContain("请基于当前对话上下文执行。");
  });
});
