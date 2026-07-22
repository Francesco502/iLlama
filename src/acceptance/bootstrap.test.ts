import { describe, expect, it, vi } from "vitest";
import type { NativeAcceptanceConfig } from "../api/tauri";
import { bootstrapApplication } from "./bootstrap";
import type { NativeAcceptanceReport } from "./nativeAcceptance";

describe("native acceptance application bootstrap", () => {
  it("finishes with a schema-valid failure report when the initial config IPC rejects", async () => {
    const finishAcceptance = vi.fn(
      async (_report: NativeAcceptanceReport, _exitCode: 1) => {},
    );
    const renderNormalApplication = vi.fn();
    const renderAcceptance = vi.fn();
    const renderDiagnostic = vi.fn();

    await bootstrapApplication({
      appVersion: "3.2.0",
      isTauriRuntime: () => true,
      loadAcceptanceConfig: async () => {
        throw new Error("config IPC rejected");
      },
      finishAcceptance,
      renderNormalApplication,
      renderAcceptance,
      renderDiagnostic,
    });

    expect(finishAcceptance).toHaveBeenCalledTimes(1);
    const [report, exitCode] = finishAcceptance.mock.calls[0];
    expect(exitCode).toBe(1);
    expect(report).toMatchObject({
      schemaVersion: 1,
      kind: "native-tauri",
      status: "failure",
      appVersion: "3.2.0",
      scan: null,
      commandSpec: null,
      activeLaunch: null,
      modelId: null,
      chat: null,
      cancellation: null,
      recovery: null,
      error: "native acceptance config failed: config IPC rejected",
    });
    expect(report.steps).toEqual([{
      name: "acceptance-config",
      status: "failure",
      transport: "tauri-ipc",
      detail: "native acceptance config failed: config IPC rejected",
    }]);
    expect(renderNormalApplication).not.toHaveBeenCalled();
    expect(renderAcceptance).not.toHaveBeenCalled();
    expect(renderDiagnostic).not.toHaveBeenCalled();
  });

  it("renders a diagnostic when neither config nor failure-report IPC can be invoked", async () => {
    const renderDiagnostic = vi.fn();

    await bootstrapApplication({
      appVersion: "3.2.0",
      isTauriRuntime: () => true,
      loadAcceptanceConfig: async () => {
        throw new Error("config rejected");
      },
      finishAcceptance: async () => {
        throw new Error("finish command unavailable");
      },
      renderNormalApplication: vi.fn(),
      renderAcceptance: vi.fn(),
      renderDiagnostic,
    });

    expect(renderDiagnostic).toHaveBeenCalledWith(
      expect.stringMatching(/config rejected.*finish command unavailable/s),
    );
  });

  it("leaves browser and disabled Tauri bootstrap on the normal application path", async () => {
    const browser = bootstrapDependencies({ isTauriRuntime: () => false });
    await bootstrapApplication(browser);
    expect(browser.renderNormalApplication).toHaveBeenCalledTimes(1);
    expect(browser.loadAcceptanceConfig).not.toHaveBeenCalled();
    expect(browser.finishAcceptance).not.toHaveBeenCalled();

    const disabledTauri = bootstrapDependencies({
      isTauriRuntime: () => true,
      loadAcceptanceConfig: vi.fn(async () => null),
    });
    await bootstrapApplication(disabledTauri);
    expect(disabledTauri.renderNormalApplication).toHaveBeenCalledTimes(1);
    expect(disabledTauri.finishAcceptance).not.toHaveBeenCalled();
  });

  it("renders the native acceptance view without claiming ownership before its runner executes", async () => {
    const order: string[] = [];
    const config = acceptanceConfig();
    const dependencies = bootstrapDependencies({
      isTauriRuntime: () => true,
      loadAcceptanceConfig: vi.fn(async () => config),
      renderAcceptance: vi.fn(() => { order.push("render-acceptance"); }),
    });

    await bootstrapApplication(dependencies);

    expect(order).toEqual(["render-acceptance"]);
    expect(dependencies.renderAcceptance).toHaveBeenCalledWith(config);
    expect(dependencies.renderNormalApplication).not.toHaveBeenCalled();
  });
});

function bootstrapDependencies(overrides = {}) {
  return {
    surface: "deep-runner",
    runNonce: "run-nonce-1234",
    appVersion: "3.2.0",
    isTauriRuntime: () => false,
    loadAcceptanceConfig: vi.fn(async (): Promise<NativeAcceptanceConfig | null> => null),
    finishAcceptance: vi.fn(async () => {}),
    renderNormalApplication: vi.fn(),
    renderAcceptance: vi.fn(),
    renderDiagnostic: vi.fn(),
    ...overrides,
  };
}

function acceptanceConfig(): NativeAcceptanceConfig {
  return {
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
}
