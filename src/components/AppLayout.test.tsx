import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import type { LogEntry, RuntimeMetrics } from "../types/domain";
import { useState } from "react";

const logs: LogEntry[] = [
  {
    id: "1",
    timestamp: "09:16:03",
    stream: "system",
    message: "等待选择模型并启动 llama-server",
  },
];

const runtimeMetrics: RuntimeMetrics = {
  cpuPercent: null,
  memoryBytes: null,
  tokensPerSecond: null,
  promptTokensPerSecond: null,
  kvCacheUsageRatio: null,
};

function renderLayout(options?: { runtimeStatus?: "idle" | "failed"; canStop?: boolean }) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();

  function Host() {
    const [activeTab, setActiveTab] = useState<"run" | "connect" | "test">("run");
    const [logOpen, setLogOpen] = useState(false);
    const [logHeight, setLogHeight] = useState(180);
    return (
      <AppLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        sidebar={<div>模型列表</div>}
        runContent={<div>运行内容</div>}
        connectionContent={<div>连接内容</div>}
        testContent={<div>测试内容</div>}
        logs={logs}
        runtimeStatus={options?.runtimeStatus ?? "idle"}
        canStop={options?.canStop ?? false}
        runtimeMetrics={runtimeMetrics}
        onStop={vi.fn()}
        logOpen={logOpen}
        logHeight={logHeight}
        onLogOpenChange={setLogOpen}
        onLogHeightChange={setLogHeight}
      />
    );
  }
  return render(<Host />);
}

describe("AppLayout", () => {
  it("restores controlled log visibility and height and reports toggles", () => {
    const onLogOpenChange = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    render(
      <AppLayout
        {...({
          activeTab: "run",
          onTabChange: vi.fn(),
          sidebar: <div />,
          runContent: <div />,
          connectionContent: <div />,
          testContent: <div />,
          logs,
          runtimeStatus: "idle",
          runtimeMetrics,
          canStop: false,
          onStop: vi.fn(),
          logOpen: true,
          logHeight: 300,
          onLogOpenChange,
          onLogHeightChange: vi.fn(),
        } as React.ComponentProps<typeof AppLayout> & {
          logOpen: boolean;
          logHeight: number;
          onLogOpenChange: (open: boolean) => void;
          onLogHeightChange: (height: number) => void;
        })}
      />,
    );

    expect(screen.getByRole("region", { name: "日志面板" })).toHaveStyle({ height: "300px" });
    fireEvent.click(screen.getByRole("button", { name: /日志 1/ }));
    expect(onLogOpenChange).toHaveBeenCalledWith(false);
  });

  it("lets users resize the log drawer by dragging its top edge", () => {
    renderLayout();

    fireEvent.click(screen.getByRole("button", { name: /日志 1/ }));
    const drawer = screen.getByRole("region", { name: "日志面板" });
    const handle = screen.getByLabelText("调整日志面板高度");

    fireEvent.mouseDown(handle, { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 420 });
    fireEvent.mouseUp(window);

    expect(drawer).toHaveStyle({ height: "260px" });
  });

  it("keeps the bottom status bar on one line on narrow screens", () => {
    const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    const statusBarRule = styles.match(/\.status-bar\s*{(?<body>[^}]+)}/)?.groups?.body ?? "";
    const statusMetricRule = styles.match(/\.status-metric\s*{(?<body>[^}]+)}/)?.groups?.body ?? "";

    expect(statusBarRule).toContain("white-space: nowrap");
    expect(statusMetricRule).toContain("flex: 0 0 auto");
  });

  it("keeps the stop action available whenever the backend still has a process", () => {
    renderLayout({ runtimeStatus: "failed", canStop: true });

    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
  });

  it("restores an independent scroll position for each tab", () => {
    renderLayout();
    const panel = screen.getByRole("tabpanel");
    panel.scrollTop = 140;

    fireEvent.click(screen.getByRole("tab", { name: "连接" }));
    expect(panel.scrollTop).toBe(0);
    panel.scrollTop = 55;

    fireEvent.click(screen.getByRole("tab", { name: "运行" }));
    expect(panel.scrollTop).toBe(140);
    fireEvent.click(screen.getByRole("tab", { name: "连接" }));
    expect(panel.scrollTop).toBe(55);
  });

  it("focuses, closes and restores focus for the shortcuts dialog", () => {
    renderLayout();
    const trigger = screen.getByRole("button", { name: "查看快捷键" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "快捷键" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "快捷键" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
