import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders github flavored markdown tables", () => {
    render(<MarkdownContent text={"| 名称 | 值 |\n| --- | --- |\n| ctx | 4096 |"} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("ctx")).toBeInTheDocument();
  });

  it("renders links with safe external attributes", () => {
    render(<MarkdownContent text={"[OpenAI](https://openai.com)"} />);

    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveAttribute("href", "https://openai.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("copies fenced code blocks", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<MarkdownContent text={"```ts\nconst answer = 42;\n```"} />);
    await user.click(screen.getByRole("button", { name: "复制代码" }));

    expect(writeText).toHaveBeenCalled();
    const arg = writeText.mock.calls[0]?.[0] as string;
    expect(arg.replace(/\s+/g, " ").trim()).toContain("const answer = 42;");
  });
});
