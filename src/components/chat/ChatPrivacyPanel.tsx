import { Download, Shield, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatHistorySettings } from "../../api/tauri";

type ExportFormat = "markdown" | "json";

interface ChatPrivacyPanelProps {
  chatHistory: ChatHistorySettings;
  exportDisabled: boolean;
  onChatHistoryChange: (settings: ChatHistorySettings) => void | Promise<void>;
  onClearHistory: () => void | Promise<void>;
  onExportConversation: (format: ExportFormat, includeReasoning: boolean) => void | Promise<void>;
}

export function ChatPrivacyPanel({
  chatHistory,
  exportDisabled,
  onChatHistoryChange,
  onClearHistory,
  onExportConversation,
}: ChatPrivacyPanelProps) {
  const [includeReasoning, setIncludeReasoning] = useState(
    chatHistory.includeReasoningInExportDefault,
  );

  useEffect(() => {
    setIncludeReasoning(chatHistory.includeReasoningInExportDefault);
  }, [chatHistory.includeReasoningInExportDefault]);

  function updateHistory(next: ChatHistorySettings) {
    void onChatHistoryChange(next);
  }

  function exportConversation(format: ExportFormat) {
    void onExportConversation(format, includeReasoning);
  }

  return (
    <section className="chat-privacy-panel" aria-label="本地历史与导出">
      <div className="chat-privacy-heading">
        <Shield size={14} />
        <span>{chatHistory.enabled ? "本地历史已开启" : "本地历史已关闭"}</span>
      </div>
      <div className="chat-privacy-controls">
        <label className="chat-privacy-toggle">
          <input
            type="checkbox"
            aria-label="保存本地历史"
            checked={chatHistory.enabled}
            onChange={(event) =>
              updateHistory({
                ...chatHistory,
                enabled: event.target.checked,
              })
            }
          />
          <span>保存本地历史</span>
        </label>
        <label className="chat-privacy-field">
          <span>图片保存方式</span>
          <select
            aria-label="图片保存方式"
            value={chatHistory.imagePersistence}
            onChange={(event) =>
              updateHistory({
                ...chatHistory,
                imagePersistence: event.target.value as ChatHistorySettings["imagePersistence"],
              })
            }
          >
            <option value="none">仅本次会话</option>
            <option value="thumbnail">仅缩略图</option>
            <option value="full">完整图片</option>
          </select>
        </label>
        <label className="chat-privacy-toggle">
          <input
            type="checkbox"
            aria-label="导出时包含思考过程"
            checked={includeReasoning}
            onChange={(event) => {
              setIncludeReasoning(event.target.checked);
              updateHistory({
                ...chatHistory,
                includeReasoningInExportDefault: event.target.checked,
              });
            }}
          />
          <span>导出时包含思考过程</span>
        </label>
      </div>
      <div className="chat-export-actions">
        <button
          type="button"
          aria-label="导出 Markdown"
          disabled={exportDisabled}
          onClick={() => exportConversation("markdown")}
        >
          <Download size={13} />
          Markdown
        </button>
        <button
          type="button"
          aria-label="导出 JSON"
          disabled={exportDisabled}
          onClick={() => exportConversation("json")}
        >
          <Download size={13} />
          JSON
        </button>
        <button type="button" aria-label="清空本地历史" onClick={() => void onClearHistory()}>
          <Trash2 size={13} />
        </button>
      </div>
    </section>
  );
}
