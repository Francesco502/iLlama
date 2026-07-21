import { describe, expect, it } from "vitest";
import type { ActiveLaunchSnapshot } from "../api/tauri";
import type { DraftLaunchConfig } from "../types/domain";
import { getLaunchDraftChanges } from "./launchDraft";

const active: ActiveLaunchSnapshot = {
  binaryPath: "/bin/llama-server",
  modelPath: "/models/a.gguf",
  host: "127.0.0.1",
  port: 8080,
  parameters: {
    ctxSize: 4096,
    threads: "auto",
    threadsBatch: "auto",
    gpuLayers: "all",
    batchSize: 512,
    ubatchSize: 128,
    flashAttention: "auto",
    mmap: true,
    mlock: false,
    metrics: true,
    idleSleepSeconds: 0,
    mmprojPath: null,
    mmprojOffload: true,
  },
  prometheusHints: {
    kvSubstrings: [],
    promptSubstrings: [],
    generationAnyOf: [],
    generationRequired: [],
  },
  startedAt: "2026-07-21T00:00:00Z",
  modelId: "model-a",
  serverCapabilities: null,
};

const draft: DraftLaunchConfig = {
  binaryPath: active.binaryPath,
  modelPath: active.modelPath,
  host: active.host,
  port: active.port,
  parameters: active.parameters,
  prometheusHints: active.prometheusHints,
  autoPort: true,
};

describe("launch draft comparison", () => {
  it("reports no changes when draft matches the immutable active launch", () => {
    expect(getLaunchDraftChanges(draft, active)).toEqual([]);
  });

  it("counts edited model, port and individual launch parameters", () => {
    expect(
      getLaunchDraftChanges(
        {
          ...draft,
          modelPath: "/models/b.gguf",
          port: 9090,
          parameters: { ...draft.parameters, ctxSize: 8192, mmap: false },
        },
        active,
      ),
    ).toEqual(["modelPath", "port", "parameters.ctxSize", "parameters.mmap"]);
  });
});
