import type { ActiveLaunchSnapshot } from "../api/tauri";
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
  compareRecord(changes, "parameters", draft.parameters, active.parameters);
  compareRecord(changes, "prometheusHints", draft.prometheusHints, active.prometheusHints);
  return changes;
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
