import { useEffect, useRef, useState } from "react";
import type { NativeAcceptanceConfig } from "../api/tauri";
import { runNativeAcceptance } from "./nativeAcceptance";

interface NativeAcceptanceViewProps {
  config: NativeAcceptanceConfig;
}

export function NativeAcceptanceView({ config }: NativeAcceptanceViewProps) {
  const started = useRef(false);
  const [message, setMessage] = useState("Native acceptance running…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runNativeAcceptance(config)
      .then((report) => {
        setMessage(report.status === "success" ? "Acceptance complete" : "Acceptance failed");
      })
      .catch((error) => {
        setMessage(`Acceptance failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [config]);

  return <main role="status">{message}</main>;
}
