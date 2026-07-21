import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommandPreview, formatCommandForShell } from "./CommandPreview";

describe("formatCommandForShell", () => {
  it("shows capability warnings next to the exact preview", () => {
    render(
      <CommandPreview
        {...({
          args: ["/bin/llama-server", "--model", "/models/a.gguf"],
          warnings: ["当前 llama-server 不支持 --metrics，已省略。"],
        } as React.ComponentProps<typeof CommandPreview> & { warnings: string[] })}
      />,
    );

    expect(screen.getByText("当前 llama-server 不支持 --metrics，已省略。")).toBeInTheDocument();
  });
  it("quotes paths with spaces for POSIX shells", () => {
    expect(
      formatCommandForShell(
        ["/Applications/llama server", "--model", "/Models/My Model.gguf"],
        "posix",
      ),
    ).toBe("'/Applications/llama server' \\\n  --model \\\n  '/Models/My Model.gguf'");
  });

  it("quotes paths with spaces for PowerShell", () => {
    expect(
      formatCommandForShell(
        ["C:\\Program Files\\llama-server.exe", "--model", "C:\\Models\\My Model.gguf"],
        "powershell",
      ),
    ).toBe("& 'C:\\Program Files\\llama-server.exe' `\n  --model `\n  'C:\\Models\\My Model.gguf'");
  });
});
