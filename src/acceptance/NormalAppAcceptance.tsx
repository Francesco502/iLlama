import { useEffect, useRef, useState } from "react";
import {
  checkHealth,
  finishNativeAcceptance,
  markNativeAcceptanceRunnerStarted,
  nativeAcceptanceSettingsIsolation,
  reportNormalAcceptanceProgress,
  runtimeSnapshot,
  type ActiveLaunchSnapshot,
  type NativeAcceptanceConfig,
  type NormalAcceptanceObservation,
  type SettingsIsolationEvidence,
} from "../api/tauri";

declare const __APP_VERSION__: string;

type NormalTransport = "tauri-ipc" | "webview-http" | "trusted-os-input" | "dom-layout";

interface NormalStep {
  name: string;
  status: "success" | "failure";
  transport: NormalTransport;
  detail?: string;
}

interface TrustedInputEvidence {
  sequence: number;
  eventType: "keydown";
  key: string;
  target: string;
  isTrusted: true;
}

interface TargetLayoutEvidence {
  target: string;
  focusObserved: boolean;
  enabled: boolean;
  visible: boolean;
  withinViewport: boolean;
}

export interface NormalAppKeyboardReport {
  schemaVersion: 1;
  kind: "normal-app-keyboard";
  surface: "normal-app";
  runNonce: string;
  status: "success" | "failure";
  appVersion: string;
  steps: NormalStep[];
  scan: {
    directory: string;
    filesScanned: number;
    modelsFound: number;
    configuredModel: {
      path: string;
      metadataStatus: "ready" | "limited";
      available: true;
    };
  } | null;
  activeLaunch: ActiveLaunchSnapshot | null;
  modelId: string | null;
  connection: { checked: true; ok: true; models: string[] } | null;
  chat: { prompt: string; streamStarted: boolean; contentObserved: string } | null;
  cancellation: {
    cancelControlActivated: boolean;
    cancelledUiObserved: boolean;
    serverDisconnectObserved: boolean;
  } | null;
  recovery: {
    code: "port_unavailable";
    message: string;
    recoveryAction: "changePort";
    exercised: true;
    visible: true;
  } | null;
  stop: { pid: null; activeLaunch: null; portReachable: false } | null;
  startedPid: number | null;
  trustedInputs: TrustedInputEvidence[];
  layout: {
    requestedWidth: number;
    requestedHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    documentScrollWidth: number;
    documentScrollHeight: number;
    overflowX: false;
    overflowY: false;
    targets: TargetLayoutEvidence[];
  } | null;
  settingsIsolation: SettingsIsolationEvidence | null;
  externalClient?: { path: string; status: "configured" };
  error?: string;
}

const STEP_TRANSPORTS = new Map<string, NormalTransport>([
  ["normal-app-mounted", "tauri-ipc"],
  ["settings-isolated", "tauri-ipc"],
  ["scan-model-directory", "tauri-ipc"],
  ["keyboard-select-model", "trusted-os-input"],
  ["occupied-port-visible-recovery", "trusted-os-input"],
  ["keyboard-change-port", "trusted-os-input"],
  ["keyboard-start-llama", "trusted-os-input"],
  ["healthy-runtime-snapshot", "tauri-ipc"],
  ["keyboard-connection-check", "trusted-os-input"],
  ["models", "webview-http"],
  ["keyboard-open-test", "trusted-os-input"],
  ["keyboard-send-stream", "trusted-os-input"],
  ["stream-started", "webview-http"],
  ["keyboard-cancel-stream", "trusted-os-input"],
  ["server-disconnect", "webview-http"],
  ["keyboard-stop-llama", "trusted-os-input"],
  ["port-closed", "tauri-ipc"],
  ["layout-no-overflow", "dom-layout"],
]);

const REQUIRED_LAYOUT_TARGETS = [
  "model-option",
  "start",
  "change-port",
  "connection-check",
  "open-test",
  "chat-input",
  "cancel-stream",
  "tab-run",
  "stop",
];
const CHAT_PROMPT = "slow cancellation acceptance";

export function NormalAppAcceptance({ config }: { config: NativeAcceptanceConfig }) {
  const started = useRef(false);
  const [message, setMessage] = useState("Normal App keyboard acceptance running…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const coordinator = createCoordinator(config, setMessage);
    coordinator.start();
    return coordinator.dispose;
  }, [config]);

  return <output hidden data-native-acceptance-surface="normal-app">{message}</output>;
}

function createCoordinator(
  config: NativeAcceptanceConfig,
  setMessage: (message: string) => void,
) {
  const report: NormalAppKeyboardReport = {
    schemaVersion: 1,
    kind: "normal-app-keyboard",
    surface: "normal-app",
    runNonce: config.runNonce,
    status: "failure",
    appVersion: __APP_VERSION__,
    steps: [],
    scan: null,
    activeLaunch: null,
    modelId: null,
    connection: null,
    chat: null,
    cancellation: null,
    recovery: null,
    stop: null,
    startedPid: null,
    trustedInputs: [],
    layout: null,
    settingsIsolation: null,
    ...(config.externalClient
      ? { externalClient: { path: config.externalClient, status: "configured" as const } }
      : {}),
  };
  const pressedTargets = new Map<string, number>();
  const layoutTargets = new Map<string, TargetLayoutEvidence>();
  let progressSequence = 0;
  let progressQueue = Promise.resolve();
  let pollTimer: number | null = null;
  let timeoutTimer: number | null = null;
  let disposed = false;
  let finished = false;
  let polling = false;

  const emit = (observation: Omit<NormalAcceptanceObservation, "sequence">) => {
    const payload = { ...observation, sequence: ++progressSequence } as NormalAcceptanceObservation;
    progressQueue = progressQueue.then(() => reportNormalAcceptanceProgress(payload));
    progressQueue.catch((error) => void fail(`progress IPC failed: ${errorMessage(error)}`));
    return payload.sequence;
  };

  const addStep = (name: string) => {
    if (report.steps.some((step) => step.name === name)) return;
    const expected = [...STEP_TRANSPORTS.keys()][report.steps.length];
    if (expected !== name) {
      void fail(`normal App step order violation: expected ${expected}, observed ${name}`);
      return;
    }
    const transport = STEP_TRANSPORTS.get(name);
    if (!transport) {
      void fail(`unknown normal App step ${name}`);
      return;
    }
    report.steps.push({ name, status: "success", transport });
    emit({ kind: "milestone", name });
  };

  const fail = async (detail: string) => {
    if (finished) return;
    finished = true;
    report.status = "failure";
    report.error = detail;
    report.steps.push({
      name: "acceptance-failure",
      status: "failure",
      transport: "tauri-ipc",
      detail,
    });
    setMessage(`Normal App acceptance failed: ${detail}`);
    try {
      emit({ kind: "failure", detail });
      await progressQueue;
      await finishNativeAcceptance(report, 1);
    } catch {
      // The controller timeout and exact process-tree cleanup remain authoritative.
    }
  };

  const onFocus = (event: FocusEvent) => {
    if (finished || !(event.target instanceof HTMLElement)) return;
    if (!event.isTrusted) {
      return;
    }
    const target = acceptanceTarget(event.target);
    captureLayoutTarget(layoutTargets, target, event.target, true);
    emit({ kind: "focus", target, isTrusted: true });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (finished || !["Tab", "Enter", " "].includes(event.key)) return;
    if (!event.isTrusted) {
      void fail(`normal App rejected untrusted ${event.key} input`);
      return;
    }
    const target = acceptanceTarget(event.target);
    const sequence = emit({ kind: "input", target, key: event.key, isTrusted: true });
    report.trustedInputs.push({
      sequence,
      eventType: "keydown",
      key: event.key,
      target,
      isTrusted: true,
    });
    if (event.key !== "Tab") {
      pressedTargets.set(target, (pressedTargets.get(target) ?? 0) + 1);
      if (event.target instanceof HTMLElement) {
        captureLayoutTarget(layoutTargets, target, event.target, true);
      }
    }
    if (
      event.key === "Enter" &&
      target === "chat-input" &&
      event.target instanceof HTMLTextAreaElement
    ) {
      report.chat = {
        prompt: event.target.value,
        streamStarted: false,
        contentObserved: "",
      };
    }
  };

  const poll = async () => {
    if (finished || polling) return;
    polling = true;
    try {
      const option = document.querySelector<HTMLElement>(
        `[data-native-acceptance-target="model-option"][data-model-path="${cssEscape(config.modelPath)}"]`,
      );
      if (report.steps.length === 2 && option) {
        const metadataStatus = option.dataset.metadataStatus;
        if (metadataStatus !== "ready" && metadataStatus !== "limited") {
          throw new Error(`configured model has invalid metadata status ${metadataStatus}`);
        }
        report.scan = {
          directory: config.modelDirectory,
          filesScanned: document.querySelectorAll("[data-model-path]").length,
          modelsFound: document.querySelectorAll('[data-native-acceptance-target="model-option"]').length,
          configuredModel: {
            path: config.modelPath,
            metadataStatus,
            available: true,
          },
        };
        addStep("scan-model-directory");
      }
      if (
        report.steps.length === 3 &&
        (pressedTargets.get("model-option") ?? 0) >= 1 &&
        option?.getAttribute("aria-selected") === "true"
      ) {
        addStep("keyboard-select-model");
      }

      const alert = document.querySelector<HTMLElement>('[role="alert"]');
      const recoveryButton = document.querySelector<HTMLElement>(
        '[data-native-acceptance-target="change-port"]',
      );
      if (
        report.steps.length === 4 &&
        (pressedTargets.get("start") ?? 0) >= 1 &&
        alert && recoveryButton
      ) {
        report.recovery = {
          code: "port_unavailable",
          message: alert.innerText.trim(),
          recoveryAction: "changePort",
          exercised: true,
          visible: true,
        };
        addStep("occupied-port-visible-recovery");
      }
      const portInput = document.querySelector<HTMLInputElement>('[aria-label="端口号"]');
      if (
        report.steps.length === 5 &&
        (pressedTargets.get("change-port") ?? 0) >= 1 &&
        !document.querySelector('[data-native-acceptance-target="change-port"]') &&
        Number(portInput?.value) !== config.occupiedPort
      ) {
        addStep("keyboard-change-port");
      }

      const snapshot = await runtimeSnapshot();
      if (
        report.steps.length === 6 &&
        (pressedTargets.get("start") ?? 0) >= 2 &&
        snapshot.pid !== null && snapshot.pid > 1 && snapshot.activeLaunch
      ) {
        report.startedPid = snapshot.pid;
        report.activeLaunch = snapshot.activeLaunch;
        addStep("keyboard-start-llama");
      }
      if (
        report.steps.length === 7 &&
        snapshot.status === "healthy" &&
        snapshot.pid === report.startedPid &&
        snapshot.activeLaunch?.modelId
      ) {
        report.activeLaunch = snapshot.activeLaunch;
        report.modelId = snapshot.activeLaunch.modelId;
        addStep("healthy-runtime-snapshot");
      }

      const connectionResult = document.querySelector<HTMLElement>(
        '.connection-check-result[data-ok="true"]',
      );
      if (
        report.steps.length === 8 &&
        (pressedTargets.get("connection-check") ?? 0) >= 1 &&
        connectionResult
      ) {
        addStep("keyboard-connection-check");
      }
      if (report.steps.length === 9 && connectionResult && report.modelId) {
        report.connection = { checked: true, ok: true, models: [report.modelId] };
        addStep("models");
      }
      if (
        report.steps.length === 10 &&
        (pressedTargets.get("open-test") ?? 0) >= 1 &&
        document.querySelector('[data-native-acceptance-target="chat-input"]')
      ) {
        addStep("keyboard-open-test");
      }
      if (
        report.steps.length === 11 &&
        (pressedTargets.get("chat-input") ?? 0) >= 1 &&
        report.chat?.prompt === CHAT_PROMPT
      ) {
        addStep("keyboard-send-stream");
      }
      const cancelButton = document.querySelector<HTMLElement>(
        '[data-native-acceptance-target="cancel-stream"]',
      );
      const assistantContent = document.querySelector<HTMLElement>(
        '.smoke-message-wrapper[data-role="assistant"] .chat-message-content',
      )?.innerText.trim() ?? "";
      if (report.steps.length === 12 && cancelButton && assistantContent.length > 0 && report.chat) {
        report.chat.streamStarted = true;
        report.chat.contentObserved = assistantContent;
        addStep("stream-started");
      }
      const cancelledUi = [...document.querySelectorAll<HTMLElement>(".smoke-status-label")]
        .some((element) => element.innerText.includes("已取消"));
      if (
        report.steps.length === 13 &&
        (pressedTargets.get("cancel-stream") ?? 0) >= 1 &&
        cancelledUi
      ) {
        report.cancellation = {
          cancelControlActivated: true,
          cancelledUiObserved: true,
          serverDisconnectObserved: false,
        };
        addStep("keyboard-cancel-stream");
      }
      const disconnected = snapshot.logs.some((entry) =>
        entry.message.includes("stream-client-disconnected"),
      );
      if (report.steps.length === 14 && disconnected && report.cancellation) {
        report.cancellation.serverDisconnectObserved = true;
        addStep("server-disconnect");
      }
      if (
        report.steps.length === 15 &&
        (pressedTargets.get("stop") ?? 0) >= 1 &&
        snapshot.status === "stopped" && snapshot.pid === null && snapshot.activeLaunch === null &&
        report.activeLaunch
      ) {
        report.stop = { pid: null, activeLaunch: null, portReachable: false };
        addStep("keyboard-stop-llama");
      }
      if (report.steps.length === 16 && report.activeLaunch) {
        const health = await checkHealth(report.activeLaunch.host, report.activeLaunch.port);
        if (!health.healthy) {
          addStep("port-closed");
        }
      }
      if (report.steps.length === 17) {
        report.settingsIsolation = await nativeAcceptanceSettingsIsolation();
        if (!report.settingsIsolation.unchanged || report.settingsIsolation.mode !== "in-memory") {
          throw new Error("acceptance isolation changed the user settings file");
        }
        report.layout = collectLayoutEvidence(config, layoutTargets);
        addStep("layout-no-overflow");
      }
      if (report.steps.length === STEP_TRANSPORTS.size && !finished) {
        finished = true;
        report.status = "success";
        setMessage("Normal App keyboard acceptance complete");
        await progressQueue;
        await finishNativeAcceptance(report, 0);
      }
    } catch (error) {
      await fail(errorMessage(error));
    } finally {
      polling = false;
    }
  };

  const start = () => {
    window.addEventListener("focusin", onFocus, true);
    window.addEventListener("keydown", onKeyDown, true);
    void (async () => {
      try {
        if (config.surface !== "normal-app") throw new Error("normal App received the wrong surface");
        await markNativeAcceptanceRunnerStarted();
        addStep("normal-app-mounted");
        report.settingsIsolation = await nativeAcceptanceSettingsIsolation();
        if (!report.settingsIsolation.unchanged || report.settingsIsolation.mode !== "in-memory") {
          throw new Error("normal App did not start with isolated in-memory settings");
        }
        addStep("settings-isolated");
        emit({ kind: "ready", name: "normal-app-keyboard" });
        pollTimer = window.setInterval(() => void poll(), 50);
        timeoutTimer = window.setTimeout(
          () => void fail("normal App keyboard acceptance timed out"),
          config.startupTimeoutMs + config.chatTimeoutMs + config.cancellationTimeoutMs + 60_000,
        );
      } catch (error) {
        await fail(errorMessage(error));
      }
    })();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("focusin", onFocus, true);
    window.removeEventListener("keydown", onKeyDown, true);
    if (pollTimer !== null) window.clearInterval(pollTimer);
    if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
  };

  return { start, dispose };
}

function acceptanceTarget(target: EventTarget | null): string {
  if (!(target instanceof HTMLElement)) return "unknown";
  const marked = target.closest<HTMLElement>("[data-native-acceptance-target]");
  if (marked?.dataset.nativeAcceptanceTarget) return marked.dataset.nativeAcceptanceTarget;
  const aria = target.getAttribute("aria-label")?.trim();
  if (aria) return `aria:${aria}`;
  const text = target.innerText?.trim().replace(/\s+/g, " ");
  if (text) return `${target.tagName.toLowerCase()}:${text.slice(0, 80)}`;
  return target.tagName.toLowerCase();
}

function captureLayoutTarget(
  targets: Map<string, TargetLayoutEvidence>,
  target: string,
  element: HTMLElement,
  focusObserved: boolean,
) {
  if (!REQUIRED_LAYOUT_TARGETS.includes(target)) return;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  targets.set(target, {
    target,
    focusObserved,
    enabled: !(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || !element.disabled,
    visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
    withinViewport:
      rect.left >= 0 && rect.top >= 0 &&
      rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
  });
}

function collectLayoutEvidence(
  config: NativeAcceptanceConfig,
  targets: Map<string, TargetLayoutEvidence>,
): NonNullable<NormalAppKeyboardReport["layout"]> {
  const root = document.documentElement;
  const overflowX = root.scrollWidth > root.clientWidth;
  const overflowY = root.scrollHeight > root.clientHeight;
  const evidence = REQUIRED_LAYOUT_TARGETS.map((target) => targets.get(target));
  if (overflowX || overflowY) throw new Error("normal App document overflowed the viewport");
  if (evidence.some((item) => !item?.focusObserved || !item.visible || !item.withinViewport)) {
    throw new Error("normal App has an unverified, hidden, or overflowing keyboard target");
  }
  return {
    requestedWidth: config.viewportWidth,
    requestedHeight: config.viewportHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentScrollWidth: root.scrollWidth,
    documentScrollHeight: root.scrollHeight,
    overflowX: false,
    overflowY: false,
    targets: evidence as TargetLayoutEvidence[],
  };
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
