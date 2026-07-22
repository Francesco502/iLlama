import type { ResolvedStartupParameters } from "../api/tauri";
import type { StartupParameters } from "../types/domain";

export function resolvedStartupParametersFixture(
  parameters: StartupParameters,
): ResolvedStartupParameters {
  return {
    ctxSize: { source: "argument", value: parameters.ctxSize },
    threads: { source: "argument", value: parameters.threads },
    threadsBatch: { source: "argument", value: parameters.threadsBatch },
    gpuLayers: { source: "argument", value: parameters.gpuLayers },
    batchSize: { source: "argument", value: parameters.batchSize },
    ubatchSize: { source: "argument", value: parameters.ubatchSize },
    flashAttention: { source: "argument", value: parameters.flashAttention },
    mmap: { source: "argument", value: parameters.mmap },
    mlock: { source: "argument", value: parameters.mlock },
    metrics: { source: "argument", value: parameters.metrics },
    idleSleepSeconds: { source: "argument", value: parameters.idleSleepSeconds },
    mmprojPath: parameters.mmprojPath
      ? { source: "argument", value: parameters.mmprojPath }
      : { source: "serverDefault", value: null },
    mmprojOffload: { source: "argument", value: parameters.mmprojOffload },
  };
}
