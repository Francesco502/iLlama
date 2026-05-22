import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportLegacyChatHistory } from "./legacyChatExport";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("legacy V2 chat export API", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invokes the explicit legacy export command", async () => {
    vi.mocked(invoke).mockResolvedValue("/tmp/legacy-chat-history.json");

    await expect(exportLegacyChatHistory()).resolves.toBe("/tmp/legacy-chat-history.json");
    expect(invoke).toHaveBeenCalledWith("export_legacy_chat_history_command");
  });
});
