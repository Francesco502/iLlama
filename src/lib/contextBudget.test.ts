import { describe, expect, it } from "vitest";
import { getAdaptiveSafetyFactor } from "./contextBudget";

describe("context budget helpers", () => {
  it("uses conservative safety factors as context grows", () => {
    expect(getAdaptiveSafetyFactor(0)).toBe(0.85);
    expect(getAdaptiveSafetyFactor(4096)).toBe(0.8);
    expect(getAdaptiveSafetyFactor(8192)).toBe(0.83);
    expect(getAdaptiveSafetyFactor(32768)).toBe(0.86);
  });

});
