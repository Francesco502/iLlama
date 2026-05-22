import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import type { LogEntry, RuntimeMetrics } from "../types/domain";

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

function renderLayout() {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();

  return render(
    <AppLayout
      activeTab="run"
      onTabChange={vi.fn()}
      sidebar={<div>模型列表</div>}
      runContent={<div>运行内容</div>}
      connectionContent={<div>连接内容</div>}
      testContent={<div>测试内容</div>}
      logs={logs}
      runtimeStatus="idle"
      runtimeMetrics={runtimeMetrics}
      onStop={vi.fn()}
    />,
  );
}

describe("AppLayout", () => {
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
});
