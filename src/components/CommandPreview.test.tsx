import { describe, expect, it } from "vitest";
import { formatCommandForShell } from "./CommandPreview";

describe("formatCommandForShell", () => {
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
