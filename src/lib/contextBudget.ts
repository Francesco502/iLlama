export function getAdaptiveSafetyFactor(contextSize: number): number {
  if (!Number.isFinite(contextSize) || contextSize <= 0) {
    return 0.85;
  }
  if (contextSize <= 4096) return 0.8;
  if (contextSize <= 8192) return 0.83;
  return 0.86;
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return Math.floor(value);
}
