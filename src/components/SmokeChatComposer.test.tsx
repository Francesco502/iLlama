import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SmokeChatComposer } from "./SmokeChatComposer";

describe("SmokeChatComposer layout contract", () => {
  it("keeps both tool buttons before the flexible message input column", () => {
    const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    const rowRule = styles.match(/\.chat-composer-row\s*{(?<body>[^}]+)}/)?.groups?.body ?? "";

    expect(rowRule).toContain("grid-template-columns: 34px 34px minmax(0, 1fr)");
  });

  it("disables every attachment entry point when the runtime is unavailable", () => {
    render(
      <SmokeChatComposer
        disabled
        disabledReason="runtime"
        streaming={false}
        imagePersistence="memory"
        onSend={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "添加图片或文本附件" })).toBeDisabled();
    expect(screen.getByLabelText("选择图片或文本附件")).toBeDisabled();
  });
});
