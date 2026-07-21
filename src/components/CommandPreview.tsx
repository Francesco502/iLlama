import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface CommandPreviewProps {
  args: string[];
  warnings?: string[];
}

export type CommandShell = "posix" | "powershell";

function quotePosix(value: string) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'"'"'`)}'`;
}

function quotePowerShell(value: string) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "''")}'`;
}

export function formatCommandForShell(args: string[], shell: CommandShell) {
  if (args.length === 0) return "";
  if (shell === "powershell") {
    return `& ${args.map(quotePowerShell).join(" `\n  ")}`;
  }
  return args.map(quotePosix).join(" \\\n  ");
}

export function CommandPreview({ args, warnings = [] }: CommandPreviewProps) {
  const [copied, setCopied] = useState(false);
  const shell: CommandShell = navigator.userAgent.includes("Windows")
    ? "powershell"
    : "posix";
  const command = formatCommandForShell(args, shell);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement("textarea");
      textarea.value = command;
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
      <pre>{command}</pre>
      {warnings.length > 0 && (
        <ul className="validation-list warning-list" aria-label="命令预览警告">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
