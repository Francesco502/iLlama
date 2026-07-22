import type { SettingsWarning } from "../api/tauri";

interface SettingsWarningBannerProps {
  warning: SettingsWarning;
  onRecovery: (action: string, target: string) => void;
  onOpenLogs: () => void;
  onDismiss: () => void;
}

export function SettingsWarningBanner({
  warning,
  onRecovery,
  onOpenLogs,
  onDismiss,
}: SettingsWarningBannerProps) {
  const canRevealBackup =
    warning.recoveryAction === "open-settings-backup" && warning.recoveryTarget !== null;

  return (
    <section className="settings-warning-banner panel" role="alert">
      <div>
        <strong>设置已恢复</strong>
        <p>{warning.message}</p>
      </div>
      <div className="settings-warning-actions">
        {canRevealBackup && (
          <button
            className="ghost-button"
            type="button"
            onClick={() => onRecovery(warning.recoveryAction, warning.recoveryTarget!)}
          >
            在文件管理器中显示备份
          </button>
        )}
        <button className="ghost-button" type="button" onClick={onOpenLogs}>
          查看日志
        </button>
        <button className="ghost-button" type="button" onClick={onDismiss}>
          关闭
        </button>
      </div>
    </section>
  );
}
