import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useExclusiveAsyncAction } from "./useExclusiveAsyncAction";

describe("useExclusiveAsyncAction", () => {
  it("covers the complete async preflight and ignores a concurrent invocation", async () => {
    let resolvePreflight!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePreflight = resolve;
        }),
    );
    const { result } = renderHook(() => useExclusiveAsyncAction());

    let first!: Promise<boolean>;
    act(() => {
      first = result.current.run(action);
    });
    expect(result.current.pending).toBe(true);
    expect(await result.current.run(action)).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePreflight();
      await first;
    });
    expect(result.current.pending).toBe(false);
  });
});
