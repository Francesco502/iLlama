import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getProfileById } from "../lib/parameterSchema";
import { emptyPrometheusHintsConfig } from "../types/domain";
import { loadSettings, resolveLlamaServerPath } from "../api/tauri";
import { useAppBootstrap } from "./useAppBootstrap";

vi.mock("../api/tauri", () => ({
  loadSettings: vi.fn(),
  resolveLlamaServerPath: vi.fn(),
}));

describe("useAppBootstrap", () => {
  it("restores autoPort=false from migrated settings", async () => {
    const parameters = getProfileById("custom").parameters;
    vi.mocked(loadSettings).mockResolvedValue({
      settings: {
        schemaVersion: 3,
        modelDirectories: [],
        llamaServerPath: "/bin/llama-server",
        launchDraft: {
          profileId: "custom",
          parameterPresetSourceId: "model-family:auto",
          selectedModelPath: null,
          autoPort: false,
          port: 9090,
          parameters,
          prometheusHints: emptyPrometheusHintsConfig(),
        },
        sampling: getProfileById("custom").sampling,
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
          message: "设置文件损坏，已加载默认设置。",
          recoveryAction: "viewLogs",
        },
      ],
    });
    vi.mocked(resolveLlamaServerPath).mockResolvedValue("/bin/llama-server");
    const setAutoPort = vi.fn();
    const onWarning = vi.fn();
    const hasBootstrappedRef = { current: false };
    const noop = vi.fn();

    renderHook(() =>
      useAppBootstrap({
        runningInTauri: true,
        appendSystemLog: noop,
        onWarning,
        hasBootstrappedRef,
        setBinaryPath: noop,
        setAutoPort,
        setPort: noop,
        setProfileId: noop,
        setParameterPresetSourceId: noop,
        setStartupParameters: noop,
        setSampling: noop,
        setUiSettings: noop,
        setDirectories: noop,
        setModels: noop,
        setSelectedModelPath: noop,
        setPrometheusHints: noop,
        scanDirectories: vi.fn().mockResolvedValue(undefined),
      } as Parameters<typeof useAppBootstrap>[0]),
    );

    await waitFor(() => expect(hasBootstrappedRef.current).toBe(true));
    expect(setAutoPort).toHaveBeenCalledWith(false);
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({ code: "settings_recovered" }),
    );
  });
});
