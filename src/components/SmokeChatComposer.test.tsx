import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("SmokeChatComposer layout contract", () => {
  it("keeps both tool buttons before the flexible message input column", () => {
    const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    const rowRule = styles.match(/\.chat-composer-row\s*{(?<body>[^}]+)}/)?.groups?.body ?? "";

    expect(rowRule).toContain("grid-template-columns: 34px 34px minmax(0, 1fr)");
  });
});
