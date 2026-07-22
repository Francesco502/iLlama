import type { ModelDirectory, ModelEntry } from "../types/domain";

export const demoModelDirectories: ModelDirectory[] = [
  { path: "~/Models", status: "ready" },
];

export const demoModels: ModelEntry[] = [
  {
    path: "~/Models/demo-model-7B-Q4_K_M.gguf",
    fileName: "demo-model-7B-Q4_K_M.gguf",
    directory: "~/Models",
    sizeBytes: 4_370_000_000,
    modifiedAt: new Date().toISOString(),
    architecture: "llama",
    quantization: "Q4_K_M",
    contextLength: 4096,
    parameterCount: "7B",
    metadataStatus: "ready",
    available: true,
    mmprojCandidates: [],
  },
  {
    path: "~/Models/demo-model-13B-Q3_K_M.gguf",
    fileName: "demo-model-13B-Q3_K_M.gguf",
    directory: "~/Models",
    sizeBytes: 6_870_000_000,
    modifiedAt: new Date().toISOString(),
    architecture: "llama",
    quantization: "Q3_K_M",
    contextLength: 8192,
    parameterCount: "13B",
    metadataStatus: "ready",
    available: true,
    mmprojCandidates: [],
  },
];
