import { describe, expect, it } from "vitest";
import { calculateTokensPerSecond, countStreamToken } from "./runtimeMetrics";

describe("runtime metrics helpers", () => {
  it("counts non-empty stream deltas as generated tokens", () => {
    expect(countStreamToken("你好")).toBe(1);
    expect(countStreamToken(" ")).toBe(0);
  });

  it("calculates approximate token throughput", () => {
    expect(calculateTokensPerSecond(12, 1_000, 4_000)).toBe(4);
    expect(calculateTokensPerSecond(0, 1_000, 4_000)).toBeNull();
  });
});
