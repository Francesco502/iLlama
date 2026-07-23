import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { RuntimeSnapshot } from "../api/tauri";
import { defaultSampling } from "../lib/parameterSchema";
import { resolvedStartupParametersFixture } from "../test/resolvedStartupParameters";
import { assistantMessageText, RuntimeSmokeChat } from "./RuntimeSmokeChat";

const healthySnapshot: RuntimeSnapshot = {
  status: "healthy",
  pid: 42,
  startedAt: "2026-07-21T00:00:00Z",
  activeModelPath: "/models/qwen.gguf",
  activeLaunch: {
    binaryPath: "/bin/llama-server",
    modelPath: "/models/qwen.gguf",
    host: "127.0.0.1",
    port: 8080,
    parameters: resolvedStartupParametersFixture({
      ctxSize: 4096,
      threads: "auto",
      threadsBatch: "auto",
      gpuLayers: "all",
      batchSize: 512,
      ubatchSize: 128,
      flashAttention: "auto",
      mmap: true,
      mlock: false,
      metrics: true,
      idleSleepSeconds: 0,
      mmprojPath: null,
      mmprojOffload: true,
    }),
    commandArgs: [],
    prometheusHints: {
      kvSubstrings: [],
      promptSubstrings: [],
      generationAnyOf: [],
      generationRequired: [],
    },
    startedAt: "2026-07-21T00:00:00Z",
    modelId: "runtime-qwen",
    serverCapabilities: null,
  },
  lastError: null,
  metrics: {
    cpuPercent: null,
    memoryBytes: null,
    tokensPerSecond: null,
    promptTokensPerSecond: null,
    kvCacheUsageRatio: null,
  },
  logs: [],
};

describe("RuntimeSmokeChat", () => {
  it("renders reasoning-only llama.cpp responses instead of an empty bubble", () => {
    expect(assistantMessageText({
      id: "reasoning-only",
      role: "assistant",
      content: "",
      reasoningContent: "模型推理输出",
      createdAt: "2026-07-23T00:00:00Z",
      status: "complete",
    })).toBe("模型推理输出");
  });

  it("renders as a transient smoke test instead of a conversation workspace", () => {
    render(
      <RuntimeSmokeChat
        snapshot={healthySnapshot}
        sampling={defaultSampling}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "测试" })).toBeInTheDocument();
    expect(screen.getByText("仅用于验证当前模型是否能回复，不保存历史。")).toBeInTheDocument();
    expect(screen.getByText("runtime-qwen")).toBeInTheDocument();
    expect(screen.queryByText("新建对话")).not.toBeInTheDocument();
    expect(screen.queryByText("写作动作")).not.toBeInTheDocument();
  });

  it("disables the composer until llama-server is healthy", () => {
    render(
      <RuntimeSmokeChat
        snapshot={{ ...healthySnapshot, status: "idle", pid: null, activeLaunch: null }}
        sampling={defaultSampling}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByPlaceholderText("启动模型后即可发送")).toBeDisabled();
  });

  it("shows image attachments after they are sent in the smoke-test thread", async () => {
    const user = userEvent.setup();
    render(
      <RuntimeSmokeChat
        snapshot={healthySnapshot}
        sampling={defaultSampling}
        appendSystemLog={() => undefined}
      />,
    );

    const image = new File(["image-bytes"], "scene.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("选择图片或文本附件"), image);

    await screen.findByText("scene.png");
    await waitFor(() => expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByAltText("scene.png")).toBeInTheDocument();
  });

  it("uses the immutable active launch instead of draft model or port values", () => {
    render(
      <RuntimeSmokeChat
        snapshot={healthySnapshot}
        sampling={defaultSampling}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByText("runtime-qwen")).toBeInTheDocument();
    expect(screen.getByText("8080")).toBeInTheDocument();
    expect(screen.queryByText("9090")).not.toBeInTheDocument();
  });

  it("disables sending while the active service has no discovered model ID", () => {
    render(
      <RuntimeSmokeChat
        snapshot={{
          ...healthySnapshot,
          activeLaunch: { ...healthySnapshot.activeLaunch!, modelId: null },
        }}
        sampling={defaultSampling}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByPlaceholderText("等待服务返回可用模型 ID…")).toBeDisabled();
  });
});
