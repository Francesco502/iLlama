import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);

export function MarkdownContent({ text }: { text: string }): ReactNode {
  if (!text) {
    return null;
  }

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
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
    return <>{children}</>;
  },
  code({ className, children, ...props }) {
    const code = String(children).replace(/\n$/, "");
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    if (!language && !code.includes("\n")) {
      return (
        <code className="md-inline-code" {...props}>
          {children}
        </code>
      );
    }

    return <CodeBlock code={code} language={language} />;
  },
};

function CodeBlock({ code, language }: { code: string; language?: string }) {
  async function copyCode() {
    await navigator.clipboard?.writeText(code);
  }

  return (
    <pre className="md-code-block">
      {language && <span className="md-code-lang">{language}</span>}
      <button className="md-copy-btn" type="button" aria-label="复制代码" onClick={copyCode}>
        <Copy size={12} />
      </button>
      <code
        dangerouslySetInnerHTML={{
          __html: highlightCode(code, language),
        }}
      />
    </pre>
  );
}

function highlightCode(code: string, language?: string): string {
  if (!code) {
    return "";
  }

  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
