import { describe, expect, it } from "vitest";
import type { ActiveLaunchSnapshot } from "../api/tauri";
import type { DraftLaunchConfig } from "../types/domain";
import {
  countServerDefaultParameters,
  getLaunchDraftChanges,
  mergeResolvedStartupParameters,
} from "./launchDraft";

const parameters: DraftLaunchConfig["parameters"] = {
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
};

const active: ActiveLaunchSnapshot = {
  binaryPath: "/bin/llama-server",
  modelPath: "/models/a.gguf",
  host: "127.0.0.1",
  port: 8080,
  parameters: {
    ctxSize: { source: "argument", value: 4096 },
    threads: { source: "argument", value: "auto" },
    threadsBatch: { source: "argument", value: "auto" },
    gpuLayers: { source: "argument", value: "all" },
    batchSize: { source: "argument", value: 512 },
    ubatchSize: { source: "argument", value: 128 },
    flashAttention: { source: "argument", value: "auto" },
    mmap: { source: "argument", value: true },
    mlock: { source: "argument", value: false },
    metrics: { source: "argument", value: true },
    idleSleepSeconds: { source: "argument", value: 0 },
    mmprojPath: { source: "serverDefault", value: null },
    mmprojOffload: { source: "serverDefault", value: null },
  },
  commandArgs: ["--model", "/models/a.gguf", "--ctx-size", "4096"],
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
  parameters,
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

  it("merges only explicit arguments and retains draft values for server defaults", () => {
    const resolved = {
      ...active.parameters,
      ctxSize: { source: "serverDefault", value: null } as const,
      mmap: { source: "serverDefault", value: null } as const,
      metrics: { source: "serverDefault", value: null } as const,
    };
    const editedDraft = {
      ...parameters,
      ctxSize: 16384,
      mmap: false,
      metrics: false,
      batchSize: 256,
    };

    expect(mergeResolvedStartupParameters(editedDraft, resolved)).toEqual({
      ...parameters,
      ctxSize: 16384,
      mmap: false,
      metrics: false,
    });
  });

  it("compares explicit arguments only and counts unknown server defaults", () => {
    const defaults = {
      ...active,
      parameters: {
        ...active.parameters,
        ctxSize: { source: "serverDefault", value: null } as const,
        mmap: { source: "serverDefault", value: null } as const,
        flashAttention: { source: "serverDefault", value: null } as const,
        metrics: { source: "serverDefault", value: null } as const,
      },
    };
    const editedDraft = {
      ...draft,
      parameters: { ...draft.parameters, ctxSize: 8192, mmap: false, metrics: false },
    };

    expect(getLaunchDraftChanges(editedDraft, defaults)).toEqual([]);
    expect(countServerDefaultParameters(defaults.parameters)).toBe(6);
  });
});
