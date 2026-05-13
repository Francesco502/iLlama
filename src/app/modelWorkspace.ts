import type { ModelDirectory } from "../types/domain";

export function computeContextLengthMismatch(
  modelContextLength: number,
  ctxSize: number,
): { kind: "warn" | "info"; recommendedCtxSize: number } | null {
  if (
    !Number.isFinite(modelContextLength) ||
    !Number.isFinite(ctxSize) ||
    modelContextLength <= 0 ||
    ctxSize <= 0
  ) {
    return null;
  }
  if (ctxSize > modelContextLength) {
    return { kind: "warn", recommendedCtxSize: Math.max(1, Math.floor(modelContextLength)) };
  }
  if (modelContextLength >= ctxSize * 2) {
    return { kind: "info", recommendedCtxSize: ctxSize };
  }
  return null;
}

export function upsertDirectory(directories: ModelDirectory[], next: ModelDirectory): ModelDirectory[] {
  const exists = directories.some((d) => d.path === next.path);
  if (!exists) return [...directories, next];
  return directories.map((d) => (d.path === next.path ? next : d));
}
