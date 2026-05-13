import { describe, expect, it } from "vitest";
import { assistantProfiles, buildAssistantSystemPrompt } from "./assistantProfiles";
import type { ChatAssistantMode } from "../types/chat";

describe("assistant profiles", () => {
  it("defines the expected built-in modes", () => {
    expect(Object.keys(assistantProfiles)).toEqual([
      "general",
      "novel",
      "analysis",
      "coding",
      "translation",
    ]);
  });

  it("defines complete metadata for every mode", () => {
    Object.values(assistantProfiles).forEach((profile) => {
      expect(profile.id).toBeTruthy();
      expect(profile.label).toBeTruthy();
      expect(profile.description).toBeTruthy();
      expect(profile.systemPrompt).toBeTruthy();
    });
  });

  it("keeps profile ids aligned with their mode keys", () => {
    (Object.keys(assistantProfiles) as ChatAssistantMode[]).forEach((mode) => {
      expect(assistantProfiles[mode].id).toBe(mode);
    });
  });

  it("builds a local-first novel writing prompt", () => {
    const prompt = buildAssistantSystemPrompt("novel", "保持克制、悬疑的文风。");

    expect(prompt).toContain("小说写作助手");
    expect(prompt).toContain("用户自定义指令");
    expect(prompt).toContain("保持克制、悬疑的文风。");
    expect(prompt).toContain("不要声称访问云端");
  });

  it("returns the built-in prompt without an empty custom prompt", () => {
    const prompt = buildAssistantSystemPrompt("general", "  ");

    expect(prompt).toBe(assistantProfiles.general.systemPrompt);
  });
});
