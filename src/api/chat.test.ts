import { describe, expect, it } from "vitest";
import { buildChatCompletionBody, parseDeltaToken } from "./chat";

describe("chat streaming parser", () => {
  it("reads normal content deltas", () => {
    const token = parseDeltaToken('{"choices":[{"delta":{"content":"你好"}}]}');

    expect(token).toBe("你好");
  });

  it("reads reasoning content deltas from thinking models", () => {
    const token = parseDeltaToken('{"choices":[{"delta":{"reasoning_content":"思考"}}]}');

    expect(token).toBe("思考");
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
            },
          ],
        },
      ],
      sampling: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        minP: 0.05,
        repeatPenalty: 1.1,
        repeatLastN: 64,
        seed: null,
        maxTokens: 256,
        stop: [],
      },
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
});
