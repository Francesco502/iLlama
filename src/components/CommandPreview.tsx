import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface CommandPreviewProps {
  args: string[];
}

export function CommandPreview({ args }: CommandPreviewProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = args.join(" \\\n  ");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <section className="panel command-panel">
      <div className="panel-title">
        <span>命令预览</span>
        <button className="ghost-button" type="button" onClick={handleCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{args.join(" \\\n  ")}</pre>
    </section>
  );
}
