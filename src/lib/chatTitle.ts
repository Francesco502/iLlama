const FALLBACK_TITLE = "新对话";
const CJK_TITLE_LIMIT = 18;
const LATIN_TITLE_LIMIT = 36;

export function createConversationTitle(text: string): string {
  const normalized = text
    .replace(/[`*_>#\-[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return FALLBACK_TITLE;
  }

  const firstClause = normalized.split(/[。！？!?，,；;：:\n]/)[0]?.trim() ?? "";
  const candidate = firstClause || normalized;
  if (!candidate) {
    return FALLBACK_TITLE;
  }

  const hasCjk = /[\u3400-\u9FFF\uF900-\uFAFF]/.test(candidate);
  const limit = hasCjk ? CJK_TITLE_LIMIT : LATIN_TITLE_LIMIT;
  return candidate.length > limit ? candidate.slice(0, limit).trim() : candidate;
}
