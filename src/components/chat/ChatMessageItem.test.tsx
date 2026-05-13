import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageItem } from "./ChatMessageItem";
import type { ChatMessage } from "../../types/chat";

const baseSampling = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.1,
  repeatLastN: 64,
  seed: null,
  maxTokens: 1024,
  stop: [],
};

const baseMessage: ChatMessage = {
  id: "m1",
  role: "assistant",
  content: "",
  reasoningContent: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "streaming",
  stats: {
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    generatedTokens: 0,
    tokensPerSecond: null,
  },
  modelSnapshot: {
    modelPath: null,
    modelName: null,
    port: 8080,
    sampling: baseSampling,
  },
};

function noop() {}
function noopText(_: string) {}

const defaultItemProps = {
  streaming: false,
  onBranch: noop,
  onDelete: noop,
  onEdit: noopText,
  onRegenerate: noop,
  onContinue: noop,
  onOpenSamplingTab: noop,
};

describe("ChatMessageItem", () => {
  it("hides empty metrics row while assistant is still streaming with no tokens", () => {
    render(
      <ChatMessageItem
        message={baseMessage}
        {...defaultItemProps}
      />,
    );

    expect(screen.queryByLabelText("消息统计")).toBeNull();
  });

  it("shows metrics row with generated tokens during streaming", () => {
    render(
      <ChatMessageItem
        message={{
          ...baseMessage,
          stats: { ...baseMessage.stats!, generatedTokens: 5 },
        }}
        {...defaultItemProps}
      />,
    );

    const metrics = screen.getByLabelText("消息统计");
    expect(metrics).toBeInTheDocument();
    expect(metrics.textContent).toContain("生成 5 tok");
  });

  it("always shows metrics once message completes, even with zero generated tokens", () => {
    render(
      <ChatMessageItem
        message={{
          ...baseMessage,
          status: "complete",
          stats: {
            ...baseMessage.stats!,
            completedAt: "2026-01-01T00:00:05.000Z",
            generatedTokens: 0,
            tokensPerSecond: 0,
            promptTokens: 12,
            completionTokens: 0,
            totalTokens: 12,
          },
        }}
        {...defaultItemProps}
      />,
    );

    const metrics = screen.getByLabelText("消息统计");
    expect(metrics).toBeInTheDocument();
    expect(metrics.textContent).toContain("提示 12 tok");
    expect(metrics.textContent).toContain("总计 12 tok");
  });

  it("renders attachment buttons that delegate to a click handler", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <ChatMessageItem
        message={{
          ...baseMessage,
          role: "user",
          status: "complete",
          content: "see image",
          stats: undefined,
          attachments: [
            {
              id: "a1",
              name: "shot.png",
              mimeType: "image/png",
              sizeBytes: 1000,
              dataUrl: "data:image/png;base64,AAAA",
              persistence: "memory",
            },
          ],
        }}
        {...defaultItemProps}
      />,
    );

    const button = screen.getByRole("button", { name: /查看图片 shot.png/ });
    button.click();
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("shows truncation banner and continue actions when finish_reason is length-like", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onOpenSampling = vi.fn();
    render(
      <ChatMessageItem
        message={{
          ...baseMessage,
          status: "complete",
          content: "partial…",
          finishReason: "length",
          stats: {
            ...baseMessage.stats!,
            completedAt: "2026-01-01T00:00:05.000Z",
            generatedTokens: 100,
            tokensPerSecond: 10,
          },
        }}
        streaming={false}
        onBranch={noop}
        onDelete={noop}
        onEdit={noopText}
        onRegenerate={noop}
        onContinue={onContinue}
        onOpenSamplingTab={onOpenSampling}
      />,
    );

    expect(screen.getByText(/输出因达到 maxTokens/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续输出" }));
    expect(onContinue).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /提高 maxTokens/ }));
    expect(onOpenSampling).toHaveBeenCalled();
  });
});
