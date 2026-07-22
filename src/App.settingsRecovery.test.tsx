import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileById } from "./lib/parameterSchema";
import { emptyPrometheusHintsConfig } from "./types/domain";
import { App } from "./App";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

describe("App settings recovery", () => {
  const recoveryTarget = "/app/settings.corrupt-20260722T093015123Z.json";

  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "load_settings_command":
          return {
            settings: {
              schemaVersion: 3,
              modelDirectories: [],
              llamaServerPath: null,
              launchDraft: {
                profileId: "auto",
                parameterPresetSourceId: "model-family:auto",
                selectedModelPath: null,
                autoPort: true,
                port: 8080,
                parameters: getProfileById("max-capability").parameters,
                prometheusHints: emptyPrometheusHintsConfig(),
              },
              sampling: getProfileById("max-capability").sampling,
              ui: {
                showInMenuBar: false,
                logPanelOpen: false,
                logPanelHeight: 180,
                advancedOpen: false,
              },
            },
            warnings: [
              {
                code: "settings_recovered",
                message: "设置文件损坏，已创建备份。",
                recoveryAction: "open-settings-backup",
                recoveryTarget,
              },
            ],
          };
        case "resolve_llama_server_path_command":
          return null;
        case "get_tray_enabled_command":
          return false;
        case "runtime_snapshot_command":
          return {
            status: "idle",
            pid: null,
            startedAt: null,
            activeModelPath: null,
            activeLaunch: null,
            lastError: null,
            metrics: {
              cpuPercent: null,
              memoryBytes: null,
              tokensPerSecond: null,
              promptTokensPerSecond: null,
              kvCacheUsageRatio: null,
            },
            logs: [],
          };
        case "reveal_settings_backup_command":
          return undefined;
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.clearAllMocks();
  });

  it("invokes the native reveal command with the backend recovery target", async () => {
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "在文件管理器中显示备份" }),
    );

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("reveal_settings_backup_command", {
        path: recoveryTarget,
      }),
    );
  });
});
