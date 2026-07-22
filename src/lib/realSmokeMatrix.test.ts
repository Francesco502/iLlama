import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("real GGUF matrix source contract", () => {
  it("delegates every entry to the native Tauri controller", () => {
    const source = readFileSync(resolve("scripts/real-smoke-matrix.mjs"), "utf8");

    expect(source).toContain("runNativeTauriAcceptance");
    expect(source).toContain("ensureAppBundle");
  });

  it("does not directly spawn llama-server or accept an eight-byte GGUF header", () => {
    const source = readFileSync(resolve("scripts/real-smoke-matrix.mjs"), "utf8");

    expect(source).not.toMatch(/spawn\s*\(\s*binary/);
    expect(source).not.toContain("readUInt32LE");
    expect(source).not.toContain("Buffer.alloc(8)");
    expect(source).not.toContain("inspectGguf");
  });
});
