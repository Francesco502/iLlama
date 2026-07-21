import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { AppSettings } from "../api/tauri";
import { patchSettings } from "../api/tauri";

export function useDebouncedSettingsPersist(
  runningInTauri: boolean,
  hasBootstrappedRef: MutableRefObject<boolean>,
  settingsSnapshot: AppSettings,
  appendSystemLog: (message: string) => void,
) {
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedPersist = useCallback(
    (snapshot: AppSettings) => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        void patchSettings(snapshot).catch((error) => {
          appendSystemLog(error instanceof Error ? error.message : String(error));
        });
      }, 1500);
    },
    [appendSystemLog],
  );

  useEffect(() => {
    if (!runningInTauri || !hasBootstrappedRef.current) return;
    debouncedPersist(settingsSnapshot);
  }, [debouncedPersist, runningInTauri, settingsSnapshot, hasBootstrappedRef]);

  const clearPersistTimer = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPersistTimer(), [clearPersistTimer]);

  return { clearPersistTimer };
}
