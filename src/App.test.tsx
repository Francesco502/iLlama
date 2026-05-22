import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("renders the native-style launcher workflow", () => {
    const { container } = render(<App />);

    expect(screen.getByRole("heading", { name: "iLlama" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /选择模型目录/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /刷新/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /启动/ })).toBeInTheDocument();
    expect(screen.getByText("参数配置")).toBeInTheDocument();
    expect(screen.getByText("命令预览")).toBeInTheDocument();
    expect(screen.getByText("空闲")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /运行/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /连接/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /测试/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /对话/ })).not.toBeInTheDocument();
    expect(container.querySelector(".traffic-lights")).not.toBeInTheDocument();
  });
});
