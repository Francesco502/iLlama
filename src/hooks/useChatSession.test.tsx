import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatSession } from "./useChatSession";
import { defaultSampling } from "../lib/parameterSchema";

describe("useChatSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("shows API failures inside the assistant message", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        body: null,
      }),
    );
    const appendSystemLog = vi.fn();
    const { result } = renderHook(() =>
      useChatSession({ port: 8080, sampling: defaultSampling, appendSystemLog }),
    );

    await act(async () => {
      await result.current.handleSendMessage({ text: "你好", attachments: [] });
    });

    expect(result.current.messages.at(-1)?.content).toContain("聊天请求失败：HTTP 500");
    expect(result.current.messages.at(-1)?.streaming).toBe(false);
    expect(appendSystemLog).toHaveBeenCalledWith("聊天请求失败：HTTP 500");
  });
});
