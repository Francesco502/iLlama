import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelDirectoryPicker } from "./ModelDirectoryPicker";

describe("ModelDirectoryPicker", () => {
  it("shows directory progress and errors and can rescan one directory", () => {
    const onRescanDirectory = vi.fn();
    render(
      <ModelDirectoryPicker
        directories={[
          {
            path: "/models/live",
            status: "scanning",
            progress: { filesScanned: 12, modelsFound: 3 },
          },
          { path: "/models/missing", status: "missing", lastError: "permission denied" },
        ]}
        scanning
        onAddDirectory={vi.fn()}
        onRemoveDirectory={vi.fn()}
        onRefresh={vi.fn()}
        onRescanDirectory={onRescanDirectory}
      />,
    );

    expect(screen.getByText("已扫描 12，发现 3")).toBeVisible();
    expect(screen.getByText("permission denied")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新扫描 /models/missing" }));
    expect(onRescanDirectory).toHaveBeenCalledWith("/models/missing");
  });
});
