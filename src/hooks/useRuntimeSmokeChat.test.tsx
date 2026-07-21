import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChatCompletion } from "../api/chat";
import { defaultSampling } from "../lib/parameterSchema";
import { useRuntimeSmokeChat } from "./useRuntimeSmokeChat";

vi.mock("../api/chat", async () => {
  const actual = await vi.importActual<typeof import("../api/chat")>("../api/chat");
  return {
    ...actual,
    streamChatCompletion: vi.fn(),
  };
});

describe("useRuntimeSmokeChat", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.mocked(streamChatCompletion).mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("streams a transient user and assistant exchange without persistence", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async ({ onDelta }) => {
      onDelta?.({ contentDelta: "你好", reasoningDelta: "" });
      onDelta?.({ contentDelta: "，V3", reasoningDelta: "" });
    });
    const appendSystemLog = vi.fn();
    const { result } = renderHook(() =>
      useRuntimeSmokeChat({
        modelId: "runtime-model-id",
        port: 9090,
        sampling: defaultSampling,
        modelName: "qwen.gguf",
        appendSystemLog,
      }),
    );

    await act(async () => {
      await result.current.sendMessage({ text: "ping", attachments: [] });
    });

    expect(streamChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 9090,
        modelId: "runtime-model-id",
        messages: [expect.objectContaining({ role: "user", content: "ping" })],
      }),
    );
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: "user", content: "ping" });
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      content: "你好，V3",
      status: "complete",
    });
    expect(appendSystemLog).not.toHaveBeenCalled();
  });

  it("marks the current assistant response as cancelled when aborted", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(
      ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const { result } = renderHook(() =>
      useRuntimeSmokeChat({
        modelId: "runtime-model-id",
        port: 8080,
        sampling: defaultSampling,
        modelName: "qwen.gguf",
        appendSystemLog: vi.fn(),
      }),
    );

    await act(async () => {
      const pending = result.current.sendMessage({ text: "stop", attachments: [] });
      result.current.cancelGeneration();
      await pending;
    });

    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "cancelled",
    });
  });

  it("clears the transient smoke-test transcript", async () => {
    vi.mocked(streamChatCompletion).mockImplementation(async ({ onDelta }) => {
      onDelta?.({ contentDelta: "pong", reasoningDelta: "" });
    });
    const { result } = renderHook(() =>
      useRuntimeSmokeChat({
        modelId: "runtime-model-id",
        port: 8080,
        sampling: defaultSampling,
        modelName: "qwen.gguf",
        appendSystemLog: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.sendMessage({ text: "ping", attachments: [] });
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
  });

  it("records ISO wall-clock timestamps instead of performance timestamps", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1200)
      .mockReturnValueOnce(1600);
    vi.mocked(streamChatCompletion).mockImplementation(async ({ onDelta }) => {
      onDelta?.({ contentDelta: "pong", reasoningDelta: "" });
    });
    const { result } = renderHook(() =>
      useRuntimeSmokeChat({
        modelId: "runtime-model-id",
        port: 8080,
        sampling: defaultSampling,
        modelName: "qwen.gguf",
        appendSystemLog: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.sendMessage({ text: "ping", attachments: [] });
    });

    const stats = result.current.messages.at(-1)?.stats;
    expect(stats?.startedAt).toMatch(/^20\d\d-/);
    expect(stats?.startedAt).not.toContain("1970-");
  });
});
