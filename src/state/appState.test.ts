import { describe, expect, it } from "vitest";
import { getProfileById } from "../lib/parameterSchema";
import type { ModelDirectory, ModelEntry } from "../types/domain";
import {
  buildSettingsSnapshot,
  mergeScannedModels,
  pickSelectedModelPath,
  removeDirectoryModels,
} from "./appState";

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

  it("builds a settings snapshot from the latest full UI state", () => {
    const directories: ModelDirectory[] = [
      { path: "/models/a", status: "ready" },
      { path: "/models/b", status: "missing" },
    ];
    const parameters = {
      ...getProfileById("balanced").parameters,
      batchSize: 2048,
      metrics: false,
      idleSleepSeconds: 30,
    };

    const snapshot = buildSettingsSnapshot({
      directories,
      binaryPath: "/bin/llama-server",
      profileId: "balanced",
      selectedModelPath: "/models/a/model-a.gguf",
      port: 9090,
      startupParameters: parameters,
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      modelDirectories: ["/models/a"],
      llamaServerPath: "/bin/llama-server",
      defaultPort: 9090,
      idleSleepSeconds: 30,
      chatHistory: {
        enabled: true,
        imagePersistence: "thumbnail",
        includeReasoningInExportDefault: false,
        maxConversations: 200,
      },
    });
  });
});
