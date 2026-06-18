import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { MutableRefObject } from "react";
import { loadSettings, resolveLlamaServerPath } from "../api/tauri";
import { getProfileById } from "../lib/parameterSchema";
import {
  MODEL_FAMILY_AUTO_PRESET_SOURCE_ID,
  normalizeParameterPresetSourceId,
  type ParameterPresetSourceId,
} from "../lib/parameterPresets";
import {
  emptyPrometheusHintsConfig,
  type ModelDirectory,
  type ModelEntry,
  type ParameterProfile,
  type PrometheusHintsConfig,
  type StartupParameters,
} from "../types/domain";

const DEFAULT_PORT = 8080;

export interface AppBootstrapOptions {
  runningInTauri: boolean;
  appendSystemLog: (message: string) => void;
  hasBootstrappedRef: MutableRefObject<boolean>;
  setBinaryPath: (path: string | null) => void;
  setPort: (port: number) => void;
  setProfileId: (id: ParameterProfile["id"]) => void;
  setParameterPresetSourceId: (id: ParameterPresetSourceId) => void;
  setStartupParameters: Dispatch<SetStateAction<StartupParameters>>;
  setDirectories: (dirs: ModelDirectory[]) => void;
  setModels: (models: ModelEntry[]) => void;
  setSelectedModelPath: (path: string | null) => void;
  setPrometheusHints: (hints: PrometheusHintsConfig) => void;
  scanDirectories: (paths: string[], preferredModelPath: string | null) => Promise<void>;
}

export function useAppBootstrap({
  runningInTauri,
  appendSystemLog,
  hasBootstrappedRef,
  setBinaryPath,
  setPort,
  setProfileId,
  setParameterPresetSourceId,
  setStartupParameters,
  setDirectories,
  setModels,
  setSelectedModelPath,
  setPrometheusHints,
  scanDirectories,
}: AppBootstrapOptions): void {
  useEffect(() => {
    if (!runningInTauri) return;
    let cancelled = false;
    async function bootstrap() {
      try {
        const settings = await loadSettings();
        if (cancelled) return;
        const resolvedBinary = await resolveLlamaServerPath(settings.llamaServerPath);
        if (cancelled) return;
        setBinaryPath(resolvedBinary ?? settings.llamaServerPath);
        setPort(settings.defaultPort || DEFAULT_PORT);
        setPrometheusHints(settings.prometheusHints ?? emptyPrometheusHintsConfig());
        const loadedProfile = getProfileById(settings.defaultPresetId || "max-capability");
        setProfileId(loadedProfile.id);
        setParameterPresetSourceId(
          normalizeParameterPresetSourceId(settings.parameterPresetSourceId ?? MODEL_FAMILY_AUTO_PRESET_SOURCE_ID),
        );
        setStartupParameters({
          ...loadedProfile.parameters,
          idleSleepSeconds: settings.idleSleepSeconds,
        });

        if (settings.modelDirectories.length > 0) {
          await scanDirectories(settings.modelDirectories, settings.lastSelectedModelPath);
        } else {
          setDirectories([]);
          setModels([]);
          setSelectedModelPath(null);
          appendSystemLog("请选择模型目录以扫描 GGUF 模型。");
        }
      } catch (error) {
        appendSystemLog(error instanceof Error ? error.message : String(error));
      } finally {
        hasBootstrappedRef.current = true;
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    appendSystemLog,
    hasBootstrappedRef,
    runningInTauri,
    scanDirectories,
    setBinaryPath,
    setDirectories,
    setModels,
    setPort,
    setProfileId,
    setParameterPresetSourceId,
    setPrometheusHints,
    setSelectedModelPath,
    setStartupParameters,
  ]);
}
