import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NativeAcceptanceConfig } from "../api/tauri";
import { NativeAcceptanceView } from "./NativeAcceptanceView";
import { runNativeAcceptance } from "./nativeAcceptance";

vi.mock("./nativeAcceptance", () => ({
  runNativeAcceptance: vi.fn(async () => ({ status: "success" })),
}));

describe("NativeAcceptanceView", () => {
  it("runs one acceptance sequence and exposes completion state", async () => {
    const config: NativeAcceptanceConfig = {
      surface: "deep-runner",
      runNonce: "run-nonce-1234",
      binaryPath: "/fixtures/fake-llama-server",
      modelPath: "/fixtures/model.gguf",
      modelDirectory: "/fixtures",
      reportPath: "/fixtures/report.json",
      occupiedPort: 18180,
      preferredPort: 18181,
      startupTimeoutMs: 180_000,
      chatTimeoutMs: 120_000,
      cancellationTimeoutMs: 120_000,
      fixtureControl: true,
      externalClient: null,
      viewportWidth: 1180,
      viewportHeight: 760,
    };

    const { rerender } = render(<NativeAcceptanceView config={config} />);
    rerender(<NativeAcceptanceView config={config} />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Acceptance complete"));
    expect(runNativeAcceptance).toHaveBeenCalledTimes(1);
  });
});
