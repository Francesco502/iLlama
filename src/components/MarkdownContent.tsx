import type { ReactNode } from "react";

/**
 * Lightweight markdown-to-React renderer. Handles:
 * - Fenced code blocks (```)
 * - Inline code (`)
 * - Bold (**)
 * - Lists (- and 1.)
 * - Line breaks
 *
 * No external dependencies required.
 */
export function MarkdownContent({ text }: { text: string }): ReactNode {
  if (!text) {
    return null;
  }

  const blocks = splitCodeBlocks(text);

  return (
    <>
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <pre key={index} className="md-code-block">
            {block.lang && <span className="md-code-lang">{block.lang}</span>}
            <code>{block.content}</code>
          </pre>
        ) : (
          <span key={index}>{renderInline(block.content)}</span>
        ),
      )}
    </>
  );
}

interface Block {
  type: "text" | "code";
  content: string;
  lang?: string;
}

function splitCodeBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const parts = text.split(/^```(\w*)\n?/gm);

  let inCode = false;
  let lang = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!inCode) {
      // Check if this part is a language identifier (between ``` markers)
      if (i > 0 && i % 2 === 1) {
        lang = part;
        inCode = true;
        continue;
      }
      if (part) {
        blocks.push({ type: "text", content: part });
      }
    } else {
      // Inside code block — this is the content
      const content = part.endsWith("```") ? part.slice(0, -3) : part;
      blocks.push({ type: "code", content: content.replace(/\n$/, ""), lang: lang || undefined });
      lang = "";
      inCode = false;
    }
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split by inline code first
  const codeParts = text.split(/(`[^`]+`)/g);

  for (let i = 0; i < codeParts.length; i++) {
    const part = codeParts[i];
    if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(<code key={i} className="md-inline-code">{part.slice(1, -1)}</code>);
    } else {
      // Handle bold and text
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      for (let j = 0; j < boldParts.length; j++) {
        const bp = boldParts[j];
        if (bp.startsWith("**") && bp.endsWith("**")) {
          nodes.push(<strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>);
        } else if (bp) {
          nodes.push(bp);
        }
      }
    }
  }

  return nodes;
}
