import { describe, expect, it } from "vitest";
import { finishReasonUserHint, inferLikelyLengthFinishReason } from "./chatFinishReason";

describe("chatFinishReason", () => {
  it("infers length when finish_reason missing but completion hit maxTokens", () => {
    expect(inferLikelyLengthFinishReason(undefined, 512, 512)).toBe("length");
    expect(inferLikelyLengthFinishReason("", 510, 512)).toBe("length");
  });

  it("does not override an explicit finish_reason", () => {
    expect(inferLikelyLengthFinishReason("stop", 512, 512)).toBe("stop");
  });

  it("returns hints for uncommon finish reasons", () => {
    expect(finishReasonUserHint("tool_calls")).toContain("工具");
    expect(finishReasonUserHint("content_filter")).toContain("过滤");
  });
});
