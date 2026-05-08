export function countStreamToken(token: string): number {
  return token.trim().length > 0 ? 1 : 0;
}

export function calculateTokensPerSecond(
  generatedTokens: number,
  startedAtMs: number,
  nowMs: number,
): number | null {
  if (generatedTokens <= 0 || nowMs <= startedAtMs) {
    return null;
  }
  const seconds = (nowMs - startedAtMs) / 1000;
  return Number((generatedTokens / seconds).toFixed(2));
}
