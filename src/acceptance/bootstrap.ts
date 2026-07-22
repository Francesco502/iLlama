import type { NativeAcceptanceConfig } from "../api/tauri";
import type { NativeAcceptanceReport } from "./nativeAcceptance";

export interface AcceptanceBootstrapDependencies {
  appVersion: string;
  isTauriRuntime: () => boolean;
  loadAcceptanceConfig: () => Promise<NativeAcceptanceConfig | null>;
  finishAcceptance: (report: NativeAcceptanceReport, exitCode: 1) => Promise<void>;
  renderNormalApplication: () => void;
  renderAcceptance: (config: NativeAcceptanceConfig) => void;
  renderDiagnostic: (message: string) => void;
}

export async function bootstrapApplication(
  dependencies: AcceptanceBootstrapDependencies,
): Promise<void> {
  if (!dependencies.isTauriRuntime()) {
    dependencies.renderNormalApplication();
    return;
  }

  let config: NativeAcceptanceConfig | null;
  try {
    config = await dependencies.loadAcceptanceConfig();
  } catch (error) {
    await finishBootstrapFailure(
      dependencies,
      `native acceptance config failed: ${errorMessage(error)}`,
    );
    return;
  }

  if (!config) {
    dependencies.renderNormalApplication();
    return;
  }

  dependencies.renderAcceptance(config);
}

function bootstrapFailureReport(
  appVersion: string,
  detail: string,
): NativeAcceptanceReport {
  return {
    schemaVersion: 1,
    kind: "native-tauri",
    surface: "deep-runner",
    runNonce: "unavailable-config-ipc",
    status: "failure",
    appVersion,
    steps: [{
      name: "acceptance-config",
      status: "failure",
      transport: "tauri-ipc",
      detail,
    }],
    scan: null,
    commandSpec: null,
    activeLaunch: null,
    modelId: null,
    chat: null,
    cancellation: null,
    recovery: null,
    stop: null,
    startedPid: null,
    healthTransition: {
      exercised: false,
      healthyStatus: "healthy",
      degradedStatus: null,
      recoveredStatus: null,
    },
    error: detail,
  };
}

async function finishBootstrapFailure(
  dependencies: AcceptanceBootstrapDependencies,
  detail: string,
): Promise<void> {
  const report = bootstrapFailureReport(dependencies.appVersion, detail);
  try {
    await dependencies.finishAcceptance(report, 1);
  } catch (error) {
    dependencies.renderDiagnostic(
      `${detail}; unable to invoke native failure-report exit: ${errorMessage(error)}`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
