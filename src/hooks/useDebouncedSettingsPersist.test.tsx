import { renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileById } from "../lib/parameterSchema";
import type { AppSettings } from "../api/tauri";
import { patchSettings } from "../api/tauri";
import { useDebouncedSettingsPersist } from "./useDebouncedSettingsPersist";

vi.mock("../api/tauri", () => ({
  patchSettings: vi.fn().mockResolvedValue({ settings: {}, warnings: [] }),
}));

const settings: AppSettings = {
  schemaVersion: 3,
  modelDirectories: [],
  llamaServerPath: null,
  launchDraft: {
    profileId: "custom",
    parameterPresetSourceId: "model-family:auto",
    selectedModelPath: null,
    autoPort: true,
    port: 8080,
    parameters: getProfileById("custom").parameters,
    prometheusHints: {
      kvSubstrings: [],
      promptSubstrings: [],
      generationAnyOf: [],
      generationRequired: [],
    },
  },
  sampling: getProfileById("custom").sampling,
  ui: {
    showInMenuBar: false,
    logPanelOpen: false,
    logPanelHeight: 180,
    advancedOpen: false,
  },
};

describe("useDebouncedSettingsPersist", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(patchSettings).mockClear();
  });

  afterEach(() => vi.useRealTimers());

  it("persists the v3 snapshot through the serialized patch command", async () => {
    const hasBootstrappedRef: MutableRefObject<boolean> = { current: true };

    renderHook(() =>
      useDebouncedSettingsPersist(true, hasBootstrappedRef, settings, vi.fn()),
    );
    await vi.advanceTimersByTimeAsync(1500);

    expect(patchSettings).toHaveBeenCalledWith({
      ...settings,
      ui: {
        logPanelOpen: false,
        logPanelHeight: 180,
        advancedOpen: false,
      },
    });
  });
});
