import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildRuntimeConnection, checkRuntimeConnection } from "../lib/externalClients";
import { ConnectionPanel } from "./ConnectionPanel";

vi.mock("../lib/externalClients", async () => {
  const actual = await vi.importActual<typeof import("../lib/externalClients")>(
    "../lib/externalClients",
  );
  return { ...actual, checkRuntimeConnection: vi.fn() };
});

describe("ConnectionPanel", () => {
  it("shows OpenAI-compatible connection fields for external clients", () => {
    render(
      <ConnectionPanel
        connection={buildRuntimeConnection({
          port: 8080,
          modelName: "qwen.gguf",
          healthy: true,
        })}
        onOpenTest={() => undefined}
        trayEnabled={false}
        onTrayToggle={() => undefined}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "连接" })).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:8080/v1")).toBeInTheDocument();
    expect(screen.getByText("llama")).toBeInTheDocument();
    expect(screen.getByText("qwen.gguf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制连接信息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检测连接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开测试" })).toBeInTheDocument();
  });

  it("lists external client profiles instead of conversation management", () => {
    render(
      <ConnectionPanel
        connection={buildRuntimeConnection({
          port: 9090,
          modelName: null,
          healthy: false,
        })}
        onOpenTest={() => undefined}
        trayEnabled={false}
        onTrayToggle={() => undefined}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByText("Chatbox")).toBeInTheDocument();
    expect(screen.getByText("Cherry Studio")).toBeInTheDocument();
    expect(screen.getByText("Open WebUI")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Chatbox 官网/ })).toHaveAttribute("target", "_blank");
    expect(screen.queryByText("新建对话")).not.toBeInTheDocument();
    expect(screen.queryByText("导出对话")).not.toBeInTheDocument();
  });

  it("shows browser preview copy and a legacy export action", () => {
    render(
      <ConnectionPanel
        connection={buildRuntimeConnection({
          port: 8080,
          modelName: "qwen.gguf",
          healthy: true,
        })}
        runningInTauri={false}
        onOpenTest={() => undefined}
        trayEnabled={false}
        onTrayToggle={() => undefined}
        onExportLegacyHistory={() => undefined}
        appendSystemLog={() => undefined}
      />,
    );

    expect(screen.getByText("浏览器预览模式")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 V2 历史" })).toBeInTheDocument();
  });

  it("clears a completed check when health or model identity changes on the same port", async () => {
    vi.mocked(checkRuntimeConnection).mockResolvedValue({
      ok: true,
      healthOk: true,
      modelsOk: true,
      models: ["model-a"],
      message: "连接可用，发现 1 个模型。",
    });
    const user = userEvent.setup();
    const commonProps = {
      onOpenTest: () => undefined,
      trayEnabled: false,
      onTrayToggle: () => undefined,
      appendSystemLog: () => undefined,
    };
    const { rerender } = render(
      <ConnectionPanel
        {...commonProps}
        connection={buildRuntimeConnection({ port: 8080, modelName: "model-a", healthy: true })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "检测连接" }));
    expect(await screen.findByText("检测通过")).toBeInTheDocument();

    rerender(
      <ConnectionPanel
        {...commonProps}
        connection={buildRuntimeConnection({ port: 8080, modelName: "model-b", healthy: false })}
      />,
    );

    expect(screen.queryByText("检测通过")).not.toBeInTheDocument();
  });
});
