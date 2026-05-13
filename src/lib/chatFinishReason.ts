/**
 * When streaming omits `finish_reason` but completion tokens hit the output cap,
 * infer a length-like stop so UI can show truncation affordances.
 */
export function inferLikelyLengthFinishReason(
  existing: string | null | undefined,
  completionTokens: number,
  maxTokens: number,
): string | null | undefined {
  if (existing !== undefined && existing !== null && String(existing).trim() !== "") {
    return existing;
  }
  if (!Number.isFinite(maxTokens) || maxTokens <= 0 || !Number.isFinite(completionTokens)) {
    return existing;
  }
  const atCap = completionTokens >= maxTokens - 2;
  if (atCap) {
    return "length";
  }
  return existing;
}

/** Short user-facing copy for uncommon OpenAI-style finish_reason values. */
export function finishReasonUserHint(reason: string | null | undefined): string | null {
  if (reason == null || typeof reason !== "string") {
    return null;
  }
  const key = reason.trim().toLowerCase();
  switch (key) {
    case "tool_calls":
      return "模型因工具调用而结束本轮输出；若未看到工具结果，请检查服务端工具协议。";
    case "content_filter":
      return "输出可能因内容过滤策略被截停；可改写提示或调整服务端安全设置。";
    case "function_call":
      return "模型因函数调用结束；与 tool_calls 类似，需服务端配合解析。";
    default:
      return null;
  }
}

/** Optional absolute URL to finish_reason / limits docs (set in `.env` as `VITE_FINISH_REASON_DOC_URL`). */
export function externalFinishReasonDocHref(): string | null {
  try {
    const raw = import.meta.env.VITE_FINISH_REASON_DOC_URL;
    if (typeof raw !== "string") {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
