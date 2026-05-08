import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("renders the native-style launcher workflow", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "iLlama" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /选择模型目录/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /刷新/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /启动/ })).toBeInTheDocument();
    expect(screen.getByText("参数配置")).toBeInTheDocument();
    expect(screen.getByText("命令预览")).toBeInTheDocument();
    expect(screen.getByText("空闲")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /配置/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /对话/ })).toBeInTheDocument();
  });
});
