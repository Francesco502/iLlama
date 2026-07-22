import { describe, expect, it } from "vitest";
import type { RuntimeSnapshot } from "../api/tauri";
import { isStoppedRuntimeSnapshot } from "./NormalAppAcceptance";

describe("normal App stop acceptance", () => {
  it("requires the backend snapshot to prove the process and active launch are gone", () => {
    expect(isStoppedRuntimeSnapshot({ status: "stopped", pid: null, activeLaunch: null })).toBe(true);
    expect(isStoppedRuntimeSnapshot({ status: "stopped", pid: 4321, activeLaunch: null })).toBe(false);
    expect(isStoppedRuntimeSnapshot({
      status: "stopped",
      pid: null,
      activeLaunch: {} as NonNullable<RuntimeSnapshot["activeLaunch"]>,
    })).toBe(false);
    expect(isStoppedRuntimeSnapshot({ status: "healthy", pid: null, activeLaunch: null })).toBe(false);
  });
});
