import { Copy, Check } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github.css";

export function MarkdownContent({ text }: { text: string }): ReactNode {
  if (!text) {
    return null;
  }

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSanitize,
          [rehypeHighlight, { detect: true }],
        ]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function PreWithToolbar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    const root = ref.current;
    const code = root?.querySelector("code");
    const text = (code?.textContent ?? root?.textContent ?? "").replace(/\n+$/, "");
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <pre ref={ref} className="md-code-block">
      <button className="md-copy-btn" type="button" aria-label="复制代码" onClick={() => void copy()}>
        {copied ? <Check size={12} className="copy-success-icon" /> : <Copy size={12} />}
      </button>
      {children}
    </pre>
  );
}

const markdownComponents: Components = {
  a({ children, ...props }) {
    return (
      <a {...props} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  pre({ children }) {
    return <PreWithToolbar>{children}</PreWithToolbar>;
  },
  code({ className, children, ...props }) {
    if (className?.includes("hljs")) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="md-inline-code" {...props}>
        {children}
      </code>
    );
  },
};
