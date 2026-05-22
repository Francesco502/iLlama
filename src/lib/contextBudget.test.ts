import { describe, expect, it } from "vitest";
import { clampInt, getAdaptiveSafetyFactor } from "./contextBudget";

describe("context budget helpers", () => {
  it("uses conservative safety factors as context grows", () => {
    expect(getAdaptiveSafetyFactor(0)).toBe(0.85);
    expect(getAdaptiveSafetyFactor(4096)).toBe(0.8);
    expect(getAdaptiveSafetyFactor(8192)).toBe(0.83);
    expect(getAdaptiveSafetyFactor(32768)).toBe(0.86);
  });

  it("clamps and floors numeric parameter values", () => {
    expect(clampInt(Number.NaN, 4, 16)).toBe(4);
    expect(clampInt(2, 4, 16)).toBe(4);
    expect(clampInt(18, 4, 16)).toBe(16);
    expect(clampInt(9.8, 4, 16)).toBe(9);
  });
});
