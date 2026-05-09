import { Copy, GitBranch, RotateCcw, Trash2 } from "lucide-react";

interface MessageActionsProps {
  content: string;
  canRegenerate: boolean;
  onBranch: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
}

export function MessageActions({
  content,
  canRegenerate,
  onBranch,
  onDelete,
  onRegenerate,
}: MessageActionsProps) {
  return (
    <div className="message-actions" aria-label="消息操作">
      <button type="button" aria-label="复制消息" disabled={!content} onClick={() => void navigator.clipboard?.writeText(content)}>
        <Copy size={12} />
      </button>
      {canRegenerate && (
        <button type="button" aria-label="重新生成" onClick={onRegenerate}>
          <RotateCcw size={12} />
        </button>
      )}
      <button type="button" aria-label="分支对话" onClick={onBranch}>
        <GitBranch size={12} />
      </button>
      <button type="button" aria-label="删除消息" onClick={onDelete}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}
