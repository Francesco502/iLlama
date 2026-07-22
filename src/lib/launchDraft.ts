import type { ActiveLaunchSnapshot, ResolvedStartupParameters } from "../api/tauri";
import type { DraftLaunchConfig, PrometheusHintsConfig, StartupParameters } from "../types/domain";

export function getLaunchDraftChanges(
  draft: DraftLaunchConfig,
  active: ActiveLaunchSnapshot | null,
): string[] {
  if (!active) return [];
  const changes: string[] = [];
  compareValue(changes, "binaryPath", draft.binaryPath, active.binaryPath);
  compareValue(changes, "modelPath", draft.modelPath, active.modelPath);
  compareValue(changes, "host", draft.host, active.host);
  compareValue(changes, "port", draft.port, active.port);
  compareRecord(
    changes,
    "parameters",
    draft.parameters,
    mergeResolvedStartupParameters(draft.parameters, active.parameters),
  );
  compareRecord(changes, "prometheusHints", draft.prometheusHints, active.prometheusHints);
  return changes;
}

export function mergeResolvedStartupParameters(
  draft: StartupParameters,
  resolved: ResolvedStartupParameters,
): StartupParameters {
  return {
    ctxSize: argumentOrDraft(resolved.ctxSize, draft.ctxSize),
    threads: argumentOrDraft(resolved.threads, draft.threads),
    threadsBatch: argumentOrDraft(resolved.threadsBatch, draft.threadsBatch),
    gpuLayers: argumentOrDraft(resolved.gpuLayers, draft.gpuLayers),
    batchSize: argumentOrDraft(resolved.batchSize, draft.batchSize),
    ubatchSize: argumentOrDraft(resolved.ubatchSize, draft.ubatchSize),
    flashAttention: argumentOrDraft(resolved.flashAttention, draft.flashAttention),
    mmap: argumentOrDraft(resolved.mmap, draft.mmap),
    mlock: argumentOrDraft(resolved.mlock, draft.mlock),
    metrics: argumentOrDraft(resolved.metrics, draft.metrics),
    idleSleepSeconds: argumentOrDraft(resolved.idleSleepSeconds, draft.idleSleepSeconds),
    mmprojPath: argumentOrDraft(resolved.mmprojPath, draft.mmprojPath),
    mmprojOffload: argumentOrDraft(resolved.mmprojOffload, draft.mmprojOffload),
  };
}

export function countServerDefaultParameters(resolved: ResolvedStartupParameters): number {
  return Object.values(resolved).filter((parameter) => parameter.source === "serverDefault").length;
}

function argumentOrDraft<T>(
  resolved: { source: "argument"; value: T } | { source: "serverDefault"; value: null },
  draft: T,
): T {
  return resolved.source === "argument" ? resolved.value : draft;
}

function compareRecord<T extends StartupParameters | PrometheusHintsConfig>(
  changes: string[],
  prefix: string,
  draft: T,
  active: T,
) {
  for (const key of Object.keys(draft) as Array<keyof T>) {
    compareValue(changes, `${prefix}.${String(key)}`, draft[key], active[key]);
  }
}

function compareValue(changes: string[], path: string, draft: unknown, active: unknown) {
  const equal =
    Array.isArray(draft) && Array.isArray(active)
      ? draft.length === active.length && draft.every((value, index) => value === active[index])
      : Object.is(draft, active);
  if (!equal) changes.push(path);
}
