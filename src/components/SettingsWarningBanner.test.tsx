import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsWarningBanner } from "./SettingsWarningBanner";

describe("SettingsWarningBanner", () => {
  it("routes the structured recovery target through the backup action", () => {
    const onRecovery = vi.fn();
    render(
      <SettingsWarningBanner
        warning={{
          code: "settings_recovered",
          message: "设置文件损坏，已创建备份。",
          recoveryAction: "open-settings-backup",
          recoveryTarget: "/app/settings.corrupt-20260722T093015123Z.json",
        }}
        onRecovery={onRecovery}
        onOpenLogs={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "在文件管理器中显示备份" }));

    expect(onRecovery).toHaveBeenCalledWith(
      "open-settings-backup",
      "/app/settings.corrupt-20260722T093015123Z.json",
    );
  });

  it("does not offer a reveal action without a recovery target", () => {
    render(
      <SettingsWarningBanner
        warning={{
          code: "settings_migrated",
          message: "设置已升级。",
          recoveryAction: "none",
          recoveryTarget: null,
        }}
        onRecovery={vi.fn()}
        onOpenLogs={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "在文件管理器中显示备份" }),
    ).not.toBeInTheDocument();
  });
});
