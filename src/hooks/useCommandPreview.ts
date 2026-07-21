import { useEffect, useRef, useState } from "react";
import { buildCommandSpec, probeLlamaServer, type ServerCapabilities } from "../api/tauri";
import { buildCommandPreview } from "../lib/parameterSchema";
import type { LaunchConfig } from "../types/domain";

export const COMMAND_PREVIEW_DEBOUNCE_MS = 300;

interface CommandPreviewState {
  args: string[];
  warnings: string[];
}

export function useCommandPreview(
  config: LaunchConfig,
  runningInTauri: boolean,
): CommandPreviewState {
  const [preview, setPreview] = useState<CommandPreviewState>(() => ({
    args: runningInTauri ? [] : buildCommandPreview(config),
    warnings: [],
  }));
  const capabilityRef = useRef<{
    path: string;
    request: Promise<ServerCapabilities>;
  } | null>(null);

  useEffect(() => {
    if (!runningInTauri) {
      setPreview({ args: buildCommandPreview(config), warnings: [] });
      return;
    }
    if (!config.binaryPath || !config.modelPath) {
      setPreview({ args: [], warnings: [] });
      return;
    }

    let cancelled = false;
    setPreview({ args: [], warnings: ["正在根据 llama-server 能力生成命令预览…"] });
    const timer = setTimeout(() => {
      const path = config.binaryPath!;
      if (capabilityRef.current?.path !== path) {
        const request = probeLlamaServer(path).catch((error) => {
          if (capabilityRef.current?.request === request) capabilityRef.current = null;
          throw error;
        });
        capabilityRef.current = { path, request };
      }
      const request = capabilityRef.current.request;
      void request
        .then((capabilities) => buildCommandSpec(config, capabilities))
        .then((spec) => {
          if (!cancelled) {
            setPreview({
              args: [spec.executable, ...spec.args],
              warnings: spec.warnings,
            });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setPreview({
              args: [],
              warnings: [
                `命令预览探测失败：${error instanceof Error ? error.message : String(error)}`,
              ],
            });
          }
        });
    }, COMMAND_PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, runningInTauri]);

  return preview;
}
