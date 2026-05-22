import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultSampling } from "../lib/parameterSchema";
import type { ModelEntry } from "../types/domain";
import { RuntimeSmokeChat } from "./RuntimeSmokeChat";

const selectedModel: ModelEntry = {
  path: "/models/qwen.gguf",
  fileName: "qwen.gguf",
  directory: "/models",
  sizeBytes: 1024,
  modifiedAt: "2026-05-15T00:00:00.000Z",
  architecture: "qwen2",
  quantization: "Q4_K_M",
  contextLength: 32768,
  metadataStatus: "ready",
  available: true,
  mmprojCandidates: [],
};

describe("RuntimeSmokeChat", () => {
  it("renders as a transient smoke test instead of a conversation workspace", () => {
    render(
      <RuntimeSmokeChat
        runtimeStatus="healthy"
        selectedModel={selectedModel}
        port={8080}
        sampling={defaultSampling}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "测试" })).toBeInTheDocument();
    expect(screen.getByText("仅用于验证当前模型是否能回复，不保存历史。")).toBeInTheDocument();
    expect(screen.getByText("qwen.gguf")).toBeInTheDocument();
    expect(screen.queryByText("新建对话")).not.toBeInTheDocument();
    expect(screen.queryByText("写作动作")).not.toBeInTheDocument();
  });

  it("disables the composer until llama-server is healthy", () => {
    render(
      <RuntimeSmokeChat
        runtimeStatus="idle"
        selectedModel={selectedModel}
        port={8080}
        sampling={defaultSampling}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByPlaceholderText("启动模型后即可发送")).toBeDisabled();
  });
});
