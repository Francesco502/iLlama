import { describe, expect, it } from "vitest";
import { normalizeCommandError } from "./tauri";

describe("normalizeCommandError", () => {
  it("preserves structured recovery metadata returned by Tauri", () => {
    expect(
      normalizeCommandError({
        code: "port_unavailable",
        message: "端口已被占用",
        recoveryAction: "changePort",
      }),
    ).toEqual({
      code: "port_unavailable",
      message: "端口已被占用",
      recoveryAction: "changePort",
    });
  });

  it("normalizes legacy string failures", () => {
    expect(normalizeCommandError("启动失败")).toEqual({
      code: "command_failed",
      message: "启动失败",
      recoveryAction: "viewLogs",
    });
  });
});
