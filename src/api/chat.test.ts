import { afterEach, describe, expect, it, vi } from "vitest";
import { splitThinkTags } from "../lib/reasoning";
import {
  buildChatCompletionBody,
  completeChatCompletion,
  isLengthLikeFinishReason,
  parseCompletionMessage,
  parseDeltaEvent,
  parseDeltaToken,
  streamChatCompletion,
} from "./chat";

const sampling = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.1,
  repeatLastN: 64,
  seed: null,
  maxTokens: 256,
  stop: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat streaming parser", () => {
  it("reads normal content deltas", () => {
    const token = parseDeltaToken('{"choices":[{"delta":{"content":"你好"}}]}');

    expect(token).toBe("你好");
  });

  it("reads reasoning content deltas from thinking models", () => {
    const token = parseDeltaToken('{"choices":[{"delta":{"reasoning_content":"思考"}}]}');

    expect(token).toBe("思考");
  });

  it("reads visible content deltas separately from reasoning deltas", () => {
    expect(parseDeltaEvent('{"choices":[{"delta":{"content":"答案"}}]}')).toEqual({
      contentDelta: "答案",
      reasoningDelta: "",
    });
    expect(parseDeltaEvent('{"choices":[{"delta":{"reasoning_content":"推理"}}]}')).toEqual({
      contentDelta: "",
      reasoningDelta: "推理",
    });
  });

  it("parses usage from delta events (best-effort)", () => {
    expect(
      parseDeltaEvent(
        '{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}',
      ),
    ).toEqual({
      contentDelta: "",
      reasoningDelta: "",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });
  });

  it("keeps existing behavior when delta events omit usage", () => {
    expect(parseDeltaEvent('{"choices":[{"delta":{"content":"答案"}}]}')).toEqual({
      contentDelta: "答案",
      reasoningDelta: "",
    });
  });

  it("extracts completed think tags from visible content", () => {
    expect(splitThinkTags("<think>先分析</think>最终答案")).toEqual({
      reasoning: "先分析",
      content: "最终答案",
      open: false,
    });
  });
});

describe("chat request body", () => {
  it("serializes image attachments as OpenAI-compatible content parts", () => {
    const body = buildChatCompletionBody({
      messages: [
        {
          role: "user",
          content: "请描述这张图",
          attachments: [
            {
              id: "image-1",
              name: "desk.png",
              mimeType: "image/png",
              sizeBytes: 2048,
              dataUrl: "data:image/png;base64,abc123",
              persistence: "full",
            },
          ],
        },
      ],
      sampling,
    });

    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "请描述这张图" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
        ],
      },
    ]);
  });

  it("merges text-snippet attachments into plain string content", () => {
    const body = buildChatCompletionBody({
      messages: [
        {
          role: "user",
          content: "上下文",
          attachments: [
            {
              id: "t1",
              name: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 10,
              dataUrl: `data:text/plain;charset=utf-8,${encodeURIComponent("line1")}`,
              persistence: "full",
            },
          ],
        },
      ],
      sampling,
    });

    expect(body.messages[0]).toEqual({
      role: "user",
      content: "上下文\n\n---\n[附件: notes.txt]\nline1",
    });
  });

  it("combines text snippet and image as multipart content", () => {
    const body = buildChatCompletionBody({
      messages: [
        {
          role: "user",
          content: "看图",
          attachments: [
            {
              id: "t1",
              name: "hint.txt",
              mimeType: "text/plain",
              sizeBytes: 4,
              dataUrl: `data:text/plain;charset=utf-8,${encodeURIComponent("hint")}`,
              persistence: "full",
            },
            {
              id: "i1",
              name: "x.png",
              mimeType: "image/png",
              sizeBytes: 8,
              dataUrl: "data:image/png;base64,xx",
              persistence: "full",
            },
          ],
        },
      ],
      sampling,
    });

    expect(body.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "看图\n\n---\n[附件: hint.txt]\nhint" },
        { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
      ],
    });
  });
});

describe("chat completion API", () => {
  it("posts a non-streaming chat completion request and parses the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "答案", reasoning_content: "推理" } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeChatCompletion({
      host: "127.0.0.1",
      port: 8080,
      messages: [{ role: "user", content: "你好" }],
      sampling,
    });

    expect(result).toEqual({ content: "答案", reasoningContent: "推理" });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8080/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildChatCompletionBody({
          messages: [{ role: "user", content: "你好" }],
          sampling,
          stream: false,
        }),
      ),
      signal: undefined,
    });
  });

  it("throws an HTTP status error when non-streaming completion fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    await expect(
      completeChatCompletion({
        host: "127.0.0.1",
        port: 8080,
        messages: [{ role: "user", content: "你好" }],
        sampling,
      }),
    ).rejects.toThrow("聊天请求失败：HTTP 503");
  });
});

describe("chat streaming API", () => {
  it("emits usage-only delta events via onDelta", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
              "",
              "data: [DONE]",
              "",
            ].join("\n"),
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const onDelta = vi.fn();
    const onToken = vi.fn();
    await streamChatCompletion({
      host: "127.0.0.1",
      port: 8080,
      messages: [{ role: "user", content: "你好" }],
      sampling,
      onDelta,
      onToken,
    });

    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledWith({
      contentDelta: "",
      reasoningDelta: "",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
    expect(onToken).not.toHaveBeenCalled();
  });
});

describe("chat completion parser", () => {
  it("reads visible content from the first completion message", () => {
    expect(parseCompletionMessage({ choices: [{ message: { content: "答案" } }] })).toEqual({
      content: "答案",
      reasoningContent: "",
    });
  });

  it("reads reasoning content from the first completion message", () => {
    expect(parseCompletionMessage({ choices: [{ message: { reasoning_content: "推理" } }] })).toEqual({
      content: "",
      reasoningContent: "推理",
    });
  });

  it("parses usage when present on completion payloads", () => {
    expect(
      parseCompletionMessage({
        choices: [{ message: { content: "答案" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    ).toEqual({
      content: "答案",
      reasoningContent: "",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });
  });

  it("does not throw and returns undefined usage when missing", () => {
    expect(
      parseCompletionMessage({ choices: [{ message: { content: "答案" } }] }).usage,
    ).toBeUndefined();
  });

  it("returns an empty completion message for malformed payloads", () => {
    expect(parseCompletionMessage({ choices: [{ text: "oops" }] })).toEqual({
      content: "",
      reasoningContent: "",
    });
  });

  it("reads finish_reason from streaming delta chunks", () => {
    expect(
      parseDeltaEvent('{"choices":[{"delta":{},"finish_reason":"length"}]}'),
    ).toEqual({
      contentDelta: "",
      reasoningDelta: "",
      finishReason: "length",
    });
  });

  it("parses finish_reason on non-streaming completion", () => {
    expect(
      parseCompletionMessage({
        choices: [{ finish_reason: "max_tokens", message: { content: "partial" } }],
      }),
    ).toEqual({
      content: "partial",
      reasoningContent: "",
      finishReason: "max_tokens",
    });
  });
});

describe("isLengthLikeFinishReason", () => {
  it("detects length and max_tokens", () => {
    expect(isLengthLikeFinishReason("length")).toBe(true);
    expect(isLengthLikeFinishReason("MAX_TOKENS")).toBe(true);
    expect(isLengthLikeFinishReason("stop")).toBe(false);
    expect(isLengthLikeFinishReason(null)).toBe(false);
  });
});
