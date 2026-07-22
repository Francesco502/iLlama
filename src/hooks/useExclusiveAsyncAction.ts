import { useCallback, useRef, useState } from "react";

export function useExclusiveAsyncAction() {
  const activeRef = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (activeRef.current) return false;
    activeRef.current = true;
    setPending(true);
    try {
      await action();
      return true;
    } finally {
      activeRef.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}
