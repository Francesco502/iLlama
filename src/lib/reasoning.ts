export interface SplitThinkResult {
  reasoning: string;
  content: string;
  open: boolean;
}

export function splitThinkTags(text: string): SplitThinkResult {
  const openTag = text.indexOf("<think>");
  if (openTag < 0) {
    return { reasoning: "", content: text, open: false };
  }

  const before = text.slice(0, openTag);
  const afterOpen = text.slice(openTag + "<think>".length);
  const closeTag = afterOpen.indexOf("</think>");
  if (closeTag < 0) {
    return { reasoning: afterOpen, content: before, open: true };
  }

  return {
    reasoning: afterOpen.slice(0, closeTag),
    content: `${before}${afterOpen.slice(closeTag + "</think>".length)}`,
    open: false,
  };
}
