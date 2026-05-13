import { describe, expect, it } from "vitest";
import { calculateTokensPerSecond, countStreamToken, estimateDeltaTokens } from "./runtimeMetrics";

describe("runtime metrics helpers", () => {
  it("counts non-empty stream deltas as generated tokens", () => {
    expect(countStreamToken("你好")).toBe(1);
    expect(countStreamToken(" ")).toBe(0);
  });

  it("estimates stream delta tokens incrementally", () => {
    expect(estimateDeltaTokens(" ")).toBe(0);
    expect(estimateDeltaTokens("hello world")).toBeGreaterThan(0);
    expect(estimateDeltaTokens("你好世界")).toBeGreaterThan(0);
    // Stable behavior: trimming should not change non-empty estimate.
    expect(estimateDeltaTokens("  hello  ")).toBe(estimateDeltaTokens("hello"));
  });

  it("calculates approximate token throughput", () => {
    expect(calculateTokensPerSecond(12, 1_000, 4_000)).toBe(4);
    expect(calculateTokensPerSecond(0, 1_000, 4_000)).toBeNull();
  });
});
