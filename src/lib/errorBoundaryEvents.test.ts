import { describe, expect, it, vi } from "vitest";
import {
  formatErrorBoundaryLog,
  reportErrorBoundaryError,
  subscribeToErrorBoundaryReports,
} from "./errorBoundaryEvents";

describe("errorBoundaryEvents", () => {
  it("publishes ErrorBoundary reports with a normalized component stack", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToErrorBoundaryReports(listener);

    reportErrorBoundaryError(new Error("boom"), "\n    at MarkdownContent\n    at ChatMessageItem");

    expect(listener).toHaveBeenCalledWith({
      message: "boom",
      componentStack: "at MarkdownContent\nat ChatMessageItem",
    });
    unsubscribe();
  });

  it("formats ErrorBoundary reports for the system log drawer", () => {
    expect(
      formatErrorBoundaryLog({
        message: "boom",
        componentStack: "at MarkdownContent\nat ChatMessageItem",
      }),
    ).toBe("界面渲染错误：boom\n组件栈：at MarkdownContent\nat ChatMessageItem");
  });
});
