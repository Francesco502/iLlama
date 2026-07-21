import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelEntry } from "../types/domain";
import { ModelList } from "./ModelList";

const model = (overrides: Partial<ModelEntry>): ModelEntry => ({
  path: "/models/ready.gguf",
  fileName: "ready.gguf",
  directory: "/models",
  sizeBytes: 10,
  modifiedAt: "2026-07-21T00:00:00Z",
  metadataStatus: "ready",
  available: true,
  mmprojCandidates: [],
  ...overrides,
});

describe("ModelList", () => {
  it("exposes listbox options and their selected state", () => {
    render(
      <ModelList
        models={[
          model({}),
          model({ path: "/models/limited.gguf", fileName: "limited.gguf", metadataStatus: "limited" }),
        ]}
        selectedPath="/models/limited.gguf"
        sort="name"
        onSortChange={vi.fn()}
        onSelect={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: /ready\.gguf/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: /limited\.gguf/ })).toHaveAttribute("aria-selected", "true");
  });

  it("disables invalid models, shows their reason, and warns for limited metadata", () => {
    const onSelect = vi.fn();
    render(
      <ModelList
        models={[
          model({
            path: "/models/limited.gguf",
            fileName: "limited.gguf",
            metadataStatus: "limited",
            metadataError: "metadata truncated",
          }),
          model({
            path: "/models/invalid.gguf",
            fileName: "invalid.gguf",
            metadataStatus: "invalid",
            metadataError: "unsupported GGUF version 99",
            available: false,
          }),
        ]}
        selectedPath={null}
        sort="name"
        onSortChange={vi.fn()}
        onSelect={onSelect}
        search=""
        onSearchChange={vi.fn()}
      />,
    );

    const invalid = screen.getByRole("option", { name: /invalid\.gguf/ });
    expect(invalid).toBeDisabled();
    expect(screen.getByText(/unsupported GGUF version 99/)).toBeVisible();
    expect(screen.getByText(/元数据受限.*metadata truncated/)).toBeVisible();
    fireEvent.click(invalid);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
