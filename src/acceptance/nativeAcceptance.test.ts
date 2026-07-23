import { describe, expect, it, vi } from "vitest";
import type {
  ActiveLaunchSnapshot,
  CommandError,
  CommandSpec,
  NativeAcceptanceConfig,
  RuntimeSnapshot,
} from "../api/tauri";
import type { ModelEntry } from "../types/domain";
import {
  runNativeAcceptance,
  type NativeAcceptanceDependencies,
  type NativeAcceptanceReport,
} from "./nativeAcceptance";

describe("runNativeAcceptance", () => {
  it("executes the native scan/probe/spec/recovery/start/health/chat/abort/stop sequence", async () => {
    const calls: string[] = [];
    let finished: { report: NativeAcceptanceReport; exitCode: number } | null = null;
    const dependencies = passingDependencies(calls, (report, exitCode) => {
      finished = { report, exitCode };
    });

    const report = await runNativeAcceptance(config(), dependencies);

    expect(calls).toEqual([
      "tauri-runtime",
      "runner-started",
      "scan",
      "probe",
      "command-spec:18181",
      "start:18180",
      "find-port",
      "start:18181",
      "snapshot:starting",
      "snapshot:healthy",
      "set-health:down",
      "snapshot:degraded",
      "set-health:up",
      "snapshot:recovered",
      "chat",
      "stream-chat",
      "stop",
      "health-after-stop",
      "finish:0",
    ]);
    expect(report.status).toBe("success");
    expect(report.scan?.configuredModel.metadataStatus).toBe("ready");
    expect(report.commandSpec?.args).toEqual(commandArgs());
    expect(report.activeLaunch?.commandArgs).toEqual(commandArgs());
    expect(report.activeLaunch?.parameters.ctxSize).toEqual({ source: "argument", value: 2048 });
    expect(report.activeLaunch?.parameters.metrics).toEqual({ source: "serverDefault", value: null });
    expect(report.modelId).toBe("fixture-model");
    expect(report.healthTransition).toEqual({
      exercised: true,
      healthyStatus: "healthy",
      degradedStatus: "starting",
      recoveredStatus: "healthy",
    });
    expect(report.chat?.content).toBe("OK");
    expect(report.cancellation).toMatchObject({
      abortControllerAborted: true,
      abortErrorObserved: true,
      streamStarted: true,
    });
    expect(report.recovery).toMatchObject({
      code: "port_unavailable",
      recoveryAction: "changePort",
      exercised: true,
    });
    expect(report.stop).toMatchObject({ pid: null, activeLaunch: null, portReachable: false });
    expect(finished).toEqual({ report, exitCode: 0 });
  });

  it("accepts reasoning-only output from a native chat model", async () => {
    const calls: string[] = [];
    const dependencies = passingDependencies(calls, () => {});
    dependencies.completeChatCompletion = vi.fn(async () => {
      calls.push("chat");
      return {
        content: "",
        reasoningContent: "The model produced a reasoning response.",
        finishReason: "stop",
      };
    });

    const report = await runNativeAcceptance(config(), dependencies);

    expect(report.status).toBe("success");
    expect(report.chat).toMatchObject({
      content: "",
      reasoningContent: "The model produced a reasoning response.",
    });
  });

  it("writes a failure report and stops if a simulated PID 1 is returned", async () => {
    const calls: string[] = [];
    let finished: { report: NativeAcceptanceReport; exitCode: number } | null = null;
    const dependencies = passingDependencies(calls, (report, exitCode) => {
      finished = { report, exitCode };
    });
    dependencies.startLlama = vi.fn(async (launch) => {
      calls.push(`start:${launch.port}`);
      if (launch.port === 18180) throw occupiedPortError();
      return snapshot("starting", 1, activeLaunch());
    });

    const report = await runNativeAcceptance(config(), dependencies);

    expect(report.status).toBe("failure");
    expect(report.error).toContain("PID 1");
    expect(calls).toContain("stop");
    expect(calls.at(-1)).toBe("finish:1");
    expect(finished).toEqual({ report, exitCode: 1 });
  });

  it("claims runner ownership inside the runner and fails closed if the marker IPC rejects", async () => {
    const calls: string[] = [];
    let finished: { report: NativeAcceptanceReport; exitCode: number } | null = null;
    const dependencies = passingDependencies(calls, (report, exitCode) => {
      finished = { report, exitCode };
    });
    dependencies.markRunnerStarted = vi.fn(async () => {
      calls.push("runner-started");
      throw new Error("marker IPC rejected");
    });

    const report = await runNativeAcceptance(config(), dependencies);

    expect(calls).toEqual(["tauri-runtime", "runner-started", "finish:1"]);
    expect(report.status).toBe("failure");
    expect(report.error).toContain("marker IPC rejected");
    expect(finished).toEqual({ report, exitCode: 1 });
  });

  it("rejects an invalid configured GGUF before probing or starting", async () => {
    const calls: string[] = [];
    let finished: { report: NativeAcceptanceReport; exitCode: number } | null = null;
    const dependencies = passingDependencies(calls, (report, exitCode) => {
      finished = { report, exitCode };
    });
    dependencies.scanModelDirectory = vi.fn(async () => {
      calls.push("scan");
      return {
        requestId: "native-acceptance",
        directory: "/fixtures",
        models: [{ ...modelEntry(), metadataStatus: "invalid" as const, available: false }],
        filesScanned: 1,
        modelsFound: 0,
      };
    });

    const report = await runNativeAcceptance(config(), dependencies);

    expect(report.status).toBe("failure");
    expect(report.error).toContain("ready or limited");
    expect(calls).toEqual(["tauri-runtime", "runner-started", "scan", "finish:1"]);
    expect(finished).toEqual({ report, exitCode: 1 });
  });

  it("uses the immutable startup timeout instead of a 30 second poll cap", async () => {
    const calls: string[] = [];
    const dependencies = passingDependencies(calls, () => {});
    let polls = 0;
    dependencies.runtimeSnapshot = vi.fn(async () => {
      polls += 1;
      return snapshot(
        polls === 121 ? "healthy" : "starting",
        4321,
        activeLaunch(polls === 121 ? "fixture-model" : null),
      );
    });

    const report = await runNativeAcceptance(
      { ...config(), fixtureControl: false },
      dependencies,
    );

    expect(report.status).toBe("success");
    expect(polls).toBe(121);
  });

  it("uses a deadline so slow runtime snapshot IPC time counts against startup timeout", async () => {
    const calls: string[] = [];
    const dependencies = passingDependencies(calls, () => {});
    let now = 0;
    let polls = 0;
    dependencies.now = () => now;
    dependencies.wait = async (milliseconds) => {
      now += milliseconds;
    };
    dependencies.runtimeSnapshot = vi.fn(async () => {
      polls += 1;
      now += 2_000;
      return snapshot(
        polls === 2 ? "healthy" : "starting",
        4321,
        activeLaunch(polls === 2 ? "fixture-model" : null),
      );
    });

    const report = await runNativeAcceptance(
      { ...config(), startupTimeoutMs: 3_000, fixtureControl: false },
      dependencies,
    );

    expect(report.status).toBe("failure");
    expect(report.error).toContain("3000ms");
    expect(polls).toBe(2);
  });

  it("retries cleanup when stop returns a residual PID", async () => {
    const calls: string[] = [];
    const dependencies = passingDependencies(calls, () => {});
    let stops = 0;
    dependencies.stopLlama = vi.fn(async () => {
      calls.push("stop");
      stops += 1;
      return stops === 1
        ? snapshot("stopping", 4321, activeLaunch("fixture-model"))
        : snapshot("stopped", null, null);
    });

    const report = await runNativeAcceptance(
      { ...config(), fixtureControl: false },
      dependencies,
    );

    expect(report.status).toBe("failure");
    expect(report.error).toContain("left pid or activeLaunch");
    expect(stops).toBe(2);
  });
});

function passingDependencies(
  calls: string[],
  onFinish: (report: NativeAcceptanceReport, exitCode: number) => void,
): NativeAcceptanceDependencies {
  let snapshotCount = 0;
  return {
    isTauriRuntime: () => {
      calls.push("tauri-runtime");
      return true;
    },
    markRunnerStarted: async () => {
      calls.push("runner-started");
    },
    scanModelDirectory: async () => {
      calls.push("scan");
      return {
        requestId: "native-acceptance",
        directory: "/fixtures",
        models: [modelEntry(), invalidModelEntry()],
        filesScanned: 2,
        modelsFound: 1,
      };
    },
    probeLlamaServer: async () => {
      calls.push("probe");
      return capabilities();
    },
    buildCommandSpec: async (launch) => {
      calls.push(`command-spec:${launch.port}`);
      return commandSpec();
    },
    startLlama: async (launch) => {
      calls.push(`start:${launch.port}`);
      if (launch.port === 18180) throw occupiedPortError();
      return snapshot("starting", 4321, activeLaunch());
    },
    findAvailablePort: async () => {
      calls.push("find-port");
      return 18181;
    },
    runtimeSnapshot: async () => {
      const states = ["starting", "healthy", "degraded", "recovered"] as const;
      const state = states[Math.min(snapshotCount++, states.length - 1)];
      calls.push(`snapshot:${state}`);
      const status = state === "degraded" ? "starting" : state === "starting" ? "starting" : "healthy";
      return snapshot(status, 4321, activeLaunch(status === "healthy" ? "fixture-model" : null));
    },
    setFixtureHealth: async (_host, _port, healthy) => {
      calls.push(`set-health:${healthy ? "up" : "down"}`);
    },
    completeChatCompletion: async () => {
      calls.push("chat");
      return { content: "OK", reasoningContent: "", finishReason: "stop" };
    },
    streamChatCompletion: async ({ signal, onToken }) => {
      calls.push("stream-chat");
      await new Promise<void>((resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        onToken?.("partial");
        if (!signal?.aborted) resolve();
      });
    },
    stopLlama: async () => {
      calls.push("stop");
      return snapshot("stopped", null, null);
    },
    checkHealth: async () => {
      calls.push("health-after-stop");
      return { healthy: false, message: "connection refused" };
    },
    wait: async () => {},
    now: () => Date.now(),
    finish: async (report, exitCode) => {
      calls.push(`finish:${exitCode}`);
      onFinish(report, exitCode);
    },
  };
}

function config(): NativeAcceptanceConfig {
  return {
    surface: "deep-runner",
    runNonce: "run-nonce-1234",
    binaryPath: "/fixtures/fake-llama-server",
    modelPath: "/fixtures/model.gguf",
    modelDirectory: "/fixtures",
    reportPath: "/fixtures/report.json",
    occupiedPort: 18180,
    preferredPort: 18181,
    startupTimeoutMs: 180_000,
    chatTimeoutMs: 120_000,
    cancellationTimeoutMs: 120_000,
    fixtureControl: true,
    externalClient: null,
    viewportWidth: 1180,
    viewportHeight: 760,
  };
}

function modelEntry(): ModelEntry {
  return {
    path: "/fixtures/model.gguf",
    fileName: "model.gguf",
    directory: "/fixtures",
    sizeBytes: 128,
    modifiedAt: "2026-07-22T00:00:00.000Z",
    architecture: "llama",
    quantization: "F32",
    contextLength: 2048,
    parameterCount: "fixture",
    metadataStatus: "ready",
    available: true,
    mmprojCandidates: [],
  };
}

function invalidModelEntry(): ModelEntry {
  return {
    ...modelEntry(),
    path: "/fixtures/invalid.gguf",
    fileName: "invalid.gguf",
    metadataStatus: "invalid",
    metadataError: "zero tensors",
    available: false,
  };
}

function capabilities() {
  return {
    binaryPath: "/fixtures/fake-llama-server",
    versionText: "fake llama-server 1.0",
    supportedFlags: ["--model", "--host", "--port", "--ctx-size"],
    status: "compatible" as const,
    warnings: [],
  };
}

function commandSpec(): CommandSpec {
  return {
    executable: "/fixtures/fake-llama-server",
    args: commandArgs(),
    warnings: [],
    capabilities: capabilities(),
  };
}

function commandArgs(): string[] {
  return [
    "--model",
    "/fixtures/model.gguf",
    "--host",
    "127.0.0.1",
    "--port",
    "18181",
    "--ctx-size",
    "2048",
  ];
}

function activeLaunch(modelId: string | null = null): ActiveLaunchSnapshot {
  const serverDefault = { source: "serverDefault" as const, value: null };
  return {
    binaryPath: "/fixtures/fake-llama-server",
    modelPath: "/fixtures/model.gguf",
    host: "127.0.0.1",
    port: 18181,
    parameters: {
      ctxSize: { source: "argument", value: 2048 },
      threads: serverDefault,
      threadsBatch: serverDefault,
      gpuLayers: serverDefault,
      batchSize: serverDefault,
      ubatchSize: serverDefault,
      flashAttention: serverDefault,
      mmap: serverDefault,
      mlock: serverDefault,
      metrics: serverDefault,
      idleSleepSeconds: serverDefault,
      mmprojPath: serverDefault,
      mmprojOffload: serverDefault,
    },
    commandArgs: commandArgs(),
    prometheusHints: {
      kvSubstrings: [],
      promptSubstrings: [],
      generationAnyOf: [],
      generationRequired: [],
    },
    startedAt: "2026-07-22T00:00:01.000Z",
    modelId,
    serverCapabilities: capabilities(),
  };
}

function snapshot(
  status: RuntimeSnapshot["status"],
  pid: number | null,
  launch: ActiveLaunchSnapshot | null,
): RuntimeSnapshot {
  return {
    status,
    pid,
    startedAt: launch?.startedAt ?? null,
    activeModelPath: launch?.modelPath ?? null,
    activeLaunch: launch,
    lastError: null,
    metrics: {
      cpuPercent: null,
      memoryBytes: null,
      tokensPerSecond: null,
      promptTokensPerSecond: null,
      kvCacheUsageRatio: null,
    },
    logs: [],
  };
}

function occupiedPortError(): CommandError {
  return {
    code: "port_unavailable",
    message: "端口已被占用",
    recoveryAction: "changePort",
  };
}
