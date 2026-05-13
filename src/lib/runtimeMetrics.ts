export function countStreamToken(token: string): number {
  return token.trim().length > 0 ? 1 : 0;
}

export function estimateDeltaTokens(deltaText: string): number {
  const trimmed = deltaText.trim();
  if (!trimmed) {
    return 0;
  }

  // Lightweight incremental estimator:
  // - ASCII "words" roughly map to ~1.3 tokens
  // - CJK chars roughly map to ~1.1 tokens
  // - Other symbols roughly map to ~0.5 tokens
  const asciiWords = trimmed.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const cjkChars = trimmed.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
  const otherChars = trimmed.replace(/[A-Za-z0-9_\s\u3400-\u9FFF\uF900-\uFAFF]/g, "").length;

  return Math.ceil(asciiWords * 1.3 + cjkChars * 1.1 + otherChars * 0.5);
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
