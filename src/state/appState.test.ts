import { describe, expect, it, vi } from "vitest";
import { getProfileById } from "../lib/parameterSchema";
import type { ModelDirectory, ModelEntry } from "../types/domain";
import { emptyPrometheusHintsConfig } from "../types/domain";
import {
  buildSettingsSnapshot,
  getModelLaunchAssessment,
  mergeScannedModels,
  pickSelectedModelPath,
  reconcileMmprojPathForModel,
  removeDirectoryModels,
} from "./appState";
import * as appState from "./appState";

const baseModel: ModelEntry = {
  path: "/models/a/model-a.gguf",
  fileName: "model-a.gguf",
  directory: "/models/a",
  sizeBytes: 10,
  modifiedAt: "2026-05-08T00:00:00Z",
  metadataStatus: "ready",
  available: true,
  mmprojCandidates: [],
};

describe("app state helpers", () => {
  it("replaces models from a rescanned directory while preserving other directories", () => {
    const other = { ...baseModel, path: "/models/b/model-b.gguf", directory: "/models/b" };
    const replacement = { ...baseModel, path: "/models/a/model-a-new.gguf", fileName: "model-a-new.gguf" };

    const merged = mergeScannedModels([baseModel, other], "/models/a", [replacement]);

    expect(merged.map((model) => model.path)).toEqual([
      "/models/b/model-b.gguf",
      "/models/a/model-a-new.gguf",
    ]);
  });

  it("removes models belonging to a removed directory", () => {
    const other = { ...baseModel, path: "/models/b/model-b.gguf", directory: "/models/b" };

    const remaining = removeDirectoryModels([baseModel, other], "/models/a");

    expect(remaining).toEqual([other]);
  });

  it("restores the last selected model when it is still present", () => {
    const models = [
      baseModel,
      { ...baseModel, path: "/models/a/model-c.gguf", fileName: "model-c.gguf" },
    ];

    expect(pickSelectedModelPath(models, "/models/a/model-c.gguf")).toBe("/models/a/model-c.gguf");
    expect(pickSelectedModelPath(models, "/missing.gguf")).toBe("/models/a/model-a.gguf");
  });

  it("never restores or automatically selects an invalid model", () => {
    const invalid = {
      ...baseModel,
      metadataStatus: "invalid" as const,
      available: false,
      metadataError: "invalid GGUF magic",
    };
    const limited = {
      ...baseModel,
      path: "/models/a/limited.gguf",
      metadataStatus: "limited" as const,
      metadataError: "metadata truncated",
    };

    expect(pickSelectedModelPath([invalid, limited], invalid.path)).toBe(limited.path);
    expect(pickSelectedModelPath([invalid], invalid.path)).toBeNull();
  });

  it("blocks invalid model launches but allows limited models with a warning", () => {
    const invalid = {
      ...baseModel,
      metadataStatus: "invalid" as const,
      available: false,
      metadataError: "invalid GGUF magic",
    };
    const limited = {
      ...baseModel,
      metadataStatus: "limited" as const,
      metadataError: "metadata truncated",
    };

    expect(getModelLaunchAssessment(invalid)).toEqual({
      allowed: false,
      error: "invalid GGUF magic",
    });
    expect(getModelLaunchAssessment(limited)).toEqual({
      allowed: true,
      warning: "metadata truncated",
    });
  });

  it("auto-selects the only mmproj candidate for a newly selected model", () => {
    const model = {
      ...baseModel,
      mmprojCandidates: ["/models/a/mmproj-model-a.gguf"],
    };

    expect(reconcileMmprojPathForModel(null, model)).toBe("/models/a/mmproj-model-a.gguf");
  });

  it("keeps a matching mmproj candidate and clears stale candidates", () => {
    const model = {
      ...baseModel,
      mmprojCandidates: ["/models/a/mmproj-model-a.gguf", "/models/a/mmproj-F16.gguf"],
    };

    expect(reconcileMmprojPathForModel("/models/a/mmproj-F16.gguf", model)).toBe("/models/a/mmproj-F16.gguf");
    expect(reconcileMmprojPathForModel("/models/b/mmproj-other.gguf", model)).toBeNull();
  });

  it("builds a settings snapshot from the latest full UI state", () => {
    const directories: ModelDirectory[] = [
      { path: "/models/a", status: "ready" },
      { path: "/models/b", status: "missing" },
    ];
    const parameters = {
      ...getProfileById("custom").parameters,
      batchSize: 2048,
      metrics: false,
      idleSleepSeconds: 30,
    };

    const snapshot = buildSettingsSnapshot({
      directories,
      binaryPath: "/bin/llama-server",
      profileId: "custom",
      parameterPresetSourceId: "user:precise",
      selectedModelPath: "/models/a/model-a.gguf",
      autoPort: false,
      port: 9090,
      startupParameters: parameters,
      sampling: { ...getProfileById("custom").sampling, maxTokens: 512 },
      prometheusHints: emptyPrometheusHintsConfig(),
      ui: {
        showInMenuBar: true,
        logPanelOpen: true,
        logPanelHeight: 240,
        advancedOpen: false,
      },
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 3,
      modelDirectories: ["/models/a", "/models/b"],
      llamaServerPath: "/bin/llama-server",
      launchDraft: {
        profileId: "custom",
        parameterPresetSourceId: "user:precise",
        autoPort: false,
        port: 9090,
        parameters: {
          batchSize: 2048,
          idleSleepSeconds: 30,
        },
      },
      sampling: { maxTokens: 512 },
      ui: { showInMenuBar: true, logPanelOpen: true, logPanelHeight: 240 },
    });
  });

  it("does not search for a replacement when automatic ports are disabled", async () => {
    expect(appState.resolveLaunchPort).toBeTypeOf("function");
    const findPort = vi.fn().mockResolvedValue(9091);

    await expect(appState.resolveLaunchPort(false, 9090, findPort)).resolves.toBe(9090);
    expect(findPort).not.toHaveBeenCalled();

    await expect(appState.resolveLaunchPort(true, 9090, findPort)).resolves.toBe(9091);
    expect(findPort).toHaveBeenCalledWith("127.0.0.1", 9090);
  });
});
