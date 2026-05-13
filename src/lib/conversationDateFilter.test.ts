import { describe, expect, it, vi, afterEach } from "vitest";
import { conversationMatchesDateRange } from "./conversationDateFilter";
import type { ChatConversationSummary } from "../types/chat";

const base: ChatConversationSummary = {
  id: "1",
  title: "t",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-10T12:00:00.000Z",
  pinned: false,
  archived: false,
  messageCount: 1,
  lastMessagePreview: "",
  modelPath: null,
  modelName: null,
};

describe("conversationMatchesDateRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true for all", () => {
    expect(conversationMatchesDateRange(base, "all")).toBe(true);
  });

  it("excludes very old conversations for 7d preset", () => {
    vi.useFakeTimers({ now: new Date("2026-05-10T12:00:00.000Z") });
    try {
      expect(conversationMatchesDateRange({ ...base, updatedAt: "2019-01-01T00:00:00.000Z" }, "7d")).toBe(
        false,
      );
      expect(conversationMatchesDateRange({ ...base, updatedAt: "2026-05-09T12:00:00.000Z" }, "7d")).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
