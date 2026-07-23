import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertTrustedKeyboardEnvironment,
  cleanupAcceptanceResources,
  cleanupOwnedProcessTree,
  cleanupTrackedLaunchServicesApp,
  createOwnedProcessTreeTracker,
  activateNormalTargetWithTrustedKeyboard,
  driveNormalAppWithTrustedKeyboard,
  embedExternalClientEvidence,
  identifyNewLaunchServicesApp,
  installLaunchServicesEnvironment,
  launchServicesEnvironmentKeys,
  listExactExecutablePids,
  parseExactExecutablePids,
  parseProcessTable,
  resolveAbsoluteInput,
  runProcess,
  validateNativeAcceptanceReport,
  validateNormalAppKeyboardReport,
  waitForBootstrapEvidence,
} from "../native-tauri-acceptance.mjs";

test("accepts a complete native Tauri report", () => {
  assert.doesNotThrow(() => validateNativeAcceptanceReport(validReport(), expected()));
});

test("accepts a reasoning-only native chat response", () => {
  const report = validReport();
  report.chat = {
    content: "",
    reasoningContent: "The model produced reasoning output.",
    finishReason: "length",
  };
  assert.doesNotThrow(() => validateNativeAcceptanceReport(report, expected()));
});

test("embeds run-bound curl evidence into the stopped iLlama lifecycle report", () => {
  const report = validReport();
  report.externalClient = { path: "/tmp/external-client.mjs", status: "executed" };
  const external = {
    status: "success",
    endpoint: `http://127.0.0.1:${report.activeLaunch.port}`,
    detectedModelId: report.modelId,
  };
  const artifacts = {
    binarySha256: "a".repeat(64),
    modelSha256: "b".repeat(64),
  };

  embedExternalClientEvidence(report, external, artifacts);

  assert.deepEqual(report.artifacts, artifacts);
  assert.deepEqual(report.externalClient.report, external);
  assert.match(report.externalClient.reportSha256, /^[0-9a-f]{64}$/);
});

test("accepts only a run-bound strict normal-App trusted-keyboard report", () => {
  assert.doesNotThrow(() => validateNormalAppKeyboardReport(validNormalReport(), {
    ...expected(),
    surface: "normal-app",
    viewportWidth: 1000,
    viewportHeight: 680,
  }));

  for (const mutate of [
    (report) => { report.kind = "browser-preview"; },
    (report) => { report.runNonce = "stale-run"; },
    (report) => { report.trustedInputs[0].isTrusted = false; },
    (report) => { report.steps.push({ ...report.steps[0] }); },
    (report) => { report.layout.overflowX = true; },
    (report) => { report.settingsIsolation.unchanged = false; },
  ]) {
    const report = validNormalReport();
    mutate(report);
    assert.throws(() => validateNormalAppKeyboardReport(report, {
      ...expected(),
      surface: "normal-app",
      viewportWidth: 1000,
      viewportHeight: 680,
    }));
  }
});

test("normal App keyboard gate fails explicitly without Accessibility and has no synthetic fallback", () => {
  assert.doesNotThrow(() => assertTrustedKeyboardEnvironment(() => ({
    status: 0,
    stdout: "true\n",
    stderr: "",
  })));
  assert.throws(
    () => assertTrustedKeyboardEnvironment(() => ({
      status: 0,
      stdout: "false\n",
      stderr: "",
    })),
    /environment\/setup failure.*Accessibility/s,
  );
  const source = readFileSync(resolve("scripts/native-tauri-acceptance.mjs"), "utf8");
  assert.doesNotMatch(source, /dispatchEvent\s*\(|\.click\s*\(/);
  assert.match(source, /key code 48/);
  assert.match(source, /pressAndObserve\(36, "Enter"/);
  assert.match(source, /pressAndObserve\(\s*49,\s*" "/);
  assert.match(source, /keystroke/);
});

test("normal App stop activation uses a bounded trusted-Space fallback and waits for the real stop milestone", async () => {
  const runNonce = "stop-space-fallback";
  const output = { stdout: "", stderr: "" };
  let sequence = 0;
  const actions = [];
  const emit = (marker) => {
    output.stderr += `[normal-acceptance] ${JSON.stringify({
      runNonce,
      sequence: ++sequence,
      ...marker,
    })}\n`;
  };

  const result = await activateNormalTargetWithTrustedKeyboard({
    appPid: 4321,
    target: "stop",
    expectedMilestone: "keyboard-stop-llama",
    child: { exitCode: null, signalCode: null },
    output,
    runNonce,
    deadline: Date.now() + 2_000,
    afterSequence: 0,
    fallbackDelayMs: 10,
    execute: (lines) => {
      const action = lines.at(-2);
      actions.push(action);
      if (action === "key code 36") {
        emit({ kind: "input", target: "stop", key: "Enter", isTrusted: true });
      } else if (action === "key code 49") {
        emit({ kind: "input", target: "stop", key: " ", isTrusted: true });
        emit({ kind: "milestone", name: "keyboard-stop-llama" });
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(actions, ["key code 36", "key code 49"]);
  assert.equal(result.activationKey, " ");
  assert.equal(result.milestone.name, "keyboard-stop-llama");
});

test("normal App stop fallback restores focus before sending trusted Space", async () => {
  const runNonce = "stop-space-refocus";
  const output = { stdout: "", stderr: "" };
  let sequence = 0;
  let focusedTarget = "stop";
  const actions = [];
  const emit = (marker) => {
    output.stderr += `[normal-acceptance] ${JSON.stringify({
      runNonce,
      sequence: ++sequence,
      ...marker,
    })}\n`;
  };

  const result = await activateNormalTargetWithTrustedKeyboard({
    appPid: 4321,
    target: "stop",
    expectedMilestone: "keyboard-stop-llama",
    child: { exitCode: null, signalCode: null },
    output,
    runNonce,
    deadline: Date.now() + 250,
    afterSequence: 0,
    fallbackDelayMs: 10,
    refocusTarget: async (target) => {
      actions.push(`refocus:${target}`);
      focusedTarget = target;
      emit({ kind: "focus", target });
    },
    execute: (lines) => {
      const action = lines.at(-2);
      actions.push(action);
      if (action === "key code 36") {
        emit({ kind: "input", target: "stop", key: "Enter", isTrusted: true });
        focusedTarget = "body";
        emit({ kind: "focus", target: "body" });
      } else if (action === "key code 49") {
        emit({ kind: "input", target: focusedTarget, key: " ", isTrusted: true });
        if (focusedTarget === "stop") {
          emit({ kind: "milestone", name: "keyboard-stop-llama" });
        }
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(actions, ["key code 36", "refocus:stop", "key code 49"]);
  assert.equal(result.activationKey, " ");
  assert.equal(result.milestone.name, "keyboard-stop-llama");
});

test("normal App can use trusted Space as the primary activation while focus is still on stop", async () => {
  const runNonce = "stop-primary-space";
  const output = { stdout: "", stderr: "" };
  let sequence = 0;
  const actions = [];
  const emit = (marker) => {
    output.stderr += `[normal-acceptance] ${JSON.stringify({
      runNonce,
      sequence: ++sequence,
      ...marker,
    })}\n`;
  };

  const result = await activateNormalTargetWithTrustedKeyboard({
    appPid: 4321,
    target: "stop",
    expectedMilestone: "keyboard-stop-llama",
    primaryKey: " ",
    child: { exitCode: null, signalCode: null },
    output,
    runNonce,
    deadline: Date.now() + 250,
    execute: (lines) => {
      const action = lines.at(-2);
      actions.push(action);
      if (action === "key code 49") {
        emit({ kind: "input", target: "stop", key: " ", isTrusted: true });
        emit({ kind: "milestone", name: "keyboard-stop-llama" });
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(actions, ["key code 49"]);
  assert.equal(result.activationKey, " ");
  assert.equal(result.milestone.name, "keyboard-stop-llama");
});

test("normal App report accepts trusted Space for stop only with real stopped-runtime evidence", () => {
  const report = validNormalReport();
  report.trustedInputs.at(-1).key = " ";
  assert.doesNotThrow(() => validateNormalAppKeyboardReport(report, {
    ...expected(),
    surface: "normal-app",
    viewportWidth: 1000,
    viewportHeight: 680,
  }));

  report.stop.pid = 1234;
  assert.throws(() => validateNormalAppKeyboardReport(report, {
    ...expected(),
    surface: "normal-app",
    viewportWidth: 1000,
    viewportHeight: 680,
  }), /retained a PID/);
});

test("normal App retries trusted Tab when one key press produces no focus transition", async () => {
  const runNonce = "retry-focus-run";
  const output = { stdout: "", stderr: "" };
  let sequence = 0;
  let backwardTabs = 0;
  const emit = (marker) => {
    output.stderr += `[normal-acceptance] ${JSON.stringify({
      runNonce,
      sequence: ++sequence,
      ...marker,
    })}\n`;
  };
  emit({ kind: "ready", name: "normal-app-keyboard" });
  emit({ kind: "milestone", name: "scan-model-directory" });

  await assert.rejects(
    driveNormalAppWithTrustedKeyboard({
      appPid: 4321,
      child: { exitCode: null, signalCode: null },
      output,
      runNonce,
      timeoutMs: 500,
      execute: (lines) => {
        const action = lines.at(-2);
        if (action === "key code 48") {
          emit({ kind: "focus", target: "model-option", isTrusted: true });
        } else if (action === "key code 36") {
          emit({ kind: "input", target: "model-option", key: "Enter", isTrusted: true });
          emit({ kind: "milestone", name: "keyboard-select-model" });
        } else if (action === "key code 48 using {shift down}") {
          backwardTabs += 1;
          if (backwardTabs === 2) throw new Error("second backward Tab reached");
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    }),
    /second backward Tab reached/,
  );
  assert.equal(backwardTabs, 2);
});

test("normal App confirms every trusted character against the focused AXValue", () => {
  const source = readFileSync(resolve("scripts/native-tauri-acceptance.mjs"), "utf8");
  assert.match(source, /repeat with characterToType in characters of promptText/);
  assert.match(source, /set expectedPrefix to expectedPrefix & \(characterToType as text\)/);
  assert.match(source, /repeat 3 times/);
  assert.match(source, /key code 49/);
  assert.match(source, /keystroke \(characterToType as text\)/);
  assert.match(source, /attribute "AXFocusedUIElement"/);
  assert.match(source, /attribute "AXValue"/);
  assert.match(source, /if currentValue is expectedPrefix then/);
  assert.match(source, /if characterConfirmed is false then error/);
  assert.doesNotMatch(source, /the clipboard/);
});

test("normal App scopes trusted text entry to an ASCII TIS source and restores it", () => {
  const source = readFileSync(resolve("scripts/native-tauri-acceptance.mjs"), "utf8");
  assert.match(source, /TISCopyCurrentKeyboardInputSource/);
  assert.match(source, /kTISPropertyInputSourceIsASCIICapable/);
  assert.match(source, /TISCreateInputSourceList/);
  assert.match(source, /TISSelectInputSource/);
  assert.match(source, /finally \{/);
  assert.match(source, /runInputSourceHelper\(scope, "restore"\)/);
  assert.match(source, /input source restore failed/);
});

test("normal App waits for the model scan milestone before its first trusted Tab", async () => {
  const runNonce = "wait-for-scan-run";
  const output = { stdout: "", stderr: "" };
  let sequence = 0;
  let scanReady = false;
  const emit = (marker) => {
    output.stderr += `[normal-acceptance] ${JSON.stringify({
      runNonce,
      sequence: ++sequence,
      ...marker,
    })}\n`;
  };
  emit({ kind: "ready", name: "normal-app-keyboard" });
  const scanTimer = setTimeout(() => {
    scanReady = true;
    emit({ kind: "milestone", name: "scan-model-directory" });
  }, 250);

  try {
    await assert.rejects(
      driveNormalAppWithTrustedKeyboard({
        appPid: 4321,
        child: { exitCode: null, signalCode: null },
        output,
        runNonce,
        timeoutMs: 500,
        execute: (lines) => {
          const action = lines.at(-2);
          if (action === "key code 48") {
            throw new Error(scanReady ? "Tab after scan" : "Tab before scan");
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
      /Tab after scan/,
    );
  } finally {
    clearTimeout(scanTimer);
  }
});

test("rejects browser preview, missing IPC steps, and fabricated PID 1", () => {
  const browser = validReport();
  browser.kind = "browser-preview";
  assert.throws(() => validateNativeAcceptanceReport(browser, expected()), /native-tauri/);

  const missingIpc = validReport();
  missingIpc.steps = missingIpc.steps.filter((step) => step.name !== "scan-model-directory");
  assert.throws(() => validateNativeAcceptanceReport(missingIpc, expected()), /scan-model-directory/);

  const simulatedPid = validReport();
  simulatedPid.startedPid = 1;
  assert.throws(() => validateNativeAcceptanceReport(simulatedPid, expected()), /PID 1/);
});

test("binds deep reports to surface, run nonce, and exact packaged app version", () => {
  for (const [field, value, pattern] of [
    ["surface", "normal-app", /surface/],
    ["runNonce", "stale-run", /runNonce/],
    ["appVersion", "3.1.9", /appVersion/],
  ]) {
    const report = validReport();
    report[field] = value;
    assert.throws(() => validateNativeAcceptanceReport(report, expected()), pattern);
  }
});

test("rejects required native steps that are out of order or duplicated", () => {
  const outOfOrder = validReport();
  const startIndex = outOfOrder.steps.findIndex((step) => step.name === "start-llama");
  [outOfOrder.steps[startIndex], outOfOrder.steps[startIndex + 1]] = [
    outOfOrder.steps[startIndex + 1],
    outOfOrder.steps[startIndex],
  ];
  assert.throws(
    () => validateNativeAcceptanceReport(outOfOrder, expected()),
    /required native steps are out of order/,
  );

  const duplicated = validReport();
  duplicated.steps.push({
    ...duplicated.steps.find((step) => step.name === "start-llama"),
  });
  assert.throws(
    () => validateNativeAcceptanceReport(duplicated, expected()),
    /required native step start-llama must appear exactly once/,
  );

  const contradictory = validReport();
  contradictory.steps.push({
    name: "acceptance-failure",
    status: "failure",
    transport: "tauri-ipc",
    detail: "contradiction",
  });
  assert.throws(
    () => validateNativeAcceptanceReport(contradictory, expected()),
    /exact expected sequence/,
  );
});

test("rejects fabricated cancellation and a residual child/port", () => {
  const noAbort = validReport();
  noAbort.cancellation.abortErrorObserved = false;
  assert.throws(() => validateNativeAcceptanceReport(noAbort, expected()), /cancellation/);

  const residual = validReport();
  residual.stop.portReachable = true;
  assert.throws(() => validateNativeAcceptanceReport(residual, expected()), /reachable/);
});

test("binds the report to the configured binary, model, and exact argv", () => {
  const wrongBinary = validReport();
  wrongBinary.commandSpec.executable = "/tmp/other-server";
  assert.throws(() => validateNativeAcceptanceReport(wrongBinary, expected()), /binary/);

  const wrongModel = validReport();
  wrongModel.scan.configuredModel.path = "/tmp/other.gguf";
  assert.throws(() => validateNativeAcceptanceReport(wrongModel, expected()), /model/);

  const changedArgv = validReport();
  changedArgv.activeLaunch.commandArgs = ["--model", "/tmp/other.gguf"];
  assert.throws(() => validateNativeAcceptanceReport(changedArgv, expected()), /commandArgs/);
});

test("rejects arbitrary empty nested objects in an otherwise successful deep report", () => {
  for (const field of ["scan", "commandSpec", "activeLaunch", "chat", "cancellation", "recovery", "stop"]) {
    const report = validReport();
    report[field] = {};
    assert.throws(
      () => validateNativeAcceptanceReport(report, expected()),
      new RegExp(field === "scan" ? "model" : field, "i"),
      `${field} must be validated beyond object presence`,
    );
  }
});

test("rejects relative configured paths before resolving them", () => {
  assert.throws(() => resolveAbsoluteInput("relative/model.gguf", "--model"), /absolute/);
  assert.equal(resolveAbsoluteInput("/tmp/model.gguf", "--model"), "/tmp/model.gguf");
});

test("requires a concrete active port and an invalid GGUF rejection for fixture reports", () => {
  for (const port of [undefined, null, 0, 80, 65_536, "18181"]) {
    const invalidPort = validReport();
    invalidPort.activeLaunch.port = port;
    assert.throws(() => validateNativeAcceptanceReport(invalidPort, expected()), /port/);
  }

  const fixture = validReport();
  const firstChatStep = fixture.steps.findIndex((step) => step.name === "non-stream-chat");
  fixture.steps.splice(
    firstChatStep,
    0,
    { name: "health-downgrade", status: "success", transport: "tauri-ipc" },
    { name: "health-recovery", status: "success", transport: "tauri-ipc" },
  );
  fixture.healthTransition = {
    exercised: true,
    healthyStatus: "healthy",
    degradedStatus: "starting",
    recoveredStatus: "healthy",
  };
  assert.doesNotThrow(() => validateNativeAcceptanceReport(
    fixture,
    { ...expected(), fixtureControl: true },
  ));
  fixture.scan.rejectedInvalidModels[0].available = true;
  assert.throws(
    () => validateNativeAcceptanceReport(fixture, { ...expected(), fixtureControl: true }),
    /invalid GGUF/,
  );
});

test("LaunchServices waits for app exit and propagates both acceptance and fixture env", () => {
  const source = readFileSync(resolve("scripts/native-tauri-acceptance.mjs"), "utf8");
  assert.match(source, /\["-n",\s*"-W",\s*appPath\]/);
  assert.deepEqual(
    launchServicesEnvironmentKeys({
      PATH: "/bin",
      ILLAMA_ACCEPTANCE_MODE: "1",
      FAKE_LLAMA_ACCEPTANCE_CONTROL: "1",
    }).sort(),
    ["FAKE_LLAMA_ACCEPTANCE_CONTROL", "ILLAMA_ACCEPTANCE_MODE"],
  );
});

test("bootstrap deadline fails quickly with gated marker and stderr evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "illama-bootstrap-test-"));
  const reportPath = join(directory, "native-report.json");
  const output = {
    stdout: "",
    stderr: [
      "unrelated diagnostic",
      "[native-acceptance] state-enabled",
      "[native-acceptance] tauri-setup",
    ].join("\n"),
  };

  await assert.rejects(
    waitForBootstrapEvidence({
      reportPath,
      previousReport: null,
      child: { exitCode: null },
      output,
      timeoutMs: 20,
    }),
    (error) => {
      assert.match(error.message, /bootstrap timed out after 20ms/);
      assert.match(error.message, /state-enabled/);
      assert.match(error.message, /tauri-setup/);
      assert.match(error.message, /unrelated diagnostic/);
      return true;
    },
  );
});

test("bootstrap deadline accepts the backend runner-started marker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "illama-bootstrap-test-"));
  const result = await waitForBootstrapEvidence({
    reportPath: join(directory, "native-report.json"),
    previousReport: null,
    child: { exitCode: null },
    output: { stdout: "", stderr: "[native-acceptance] runner-started\n" },
    timeoutMs: 20,
  });

  assert.deepEqual(result, { report: null });
});

test("bootstrap deadline does not treat config-command entry as runner ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "illama-bootstrap-test-"));

  await assert.rejects(
    waitForBootstrapEvidence({
      reportPath: join(directory, "native-report.json"),
      previousReport: null,
      child: { exitCode: null, signalCode: null },
      output: { stdout: "", stderr: "[native-acceptance] webview-ipc\n" },
      timeoutMs: 20,
    }),
    /bootstrap timed out after 20ms/,
  );
});

test("bootstrap fails immediately when the launcher exited by signal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "illama-bootstrap-test-"));
  const startedAt = Date.now();

  await assert.rejects(
    waitForBootstrapEvidence({
      reportPath: join(directory, "native-report.json"),
      previousReport: null,
      child: { exitCode: null, signalCode: "SIGKILL" },
      output: { stdout: "", stderr: "[native-acceptance] state-enabled\n" },
      timeoutMs: 1_000,
    }),
    /exited before WebView IPC bootstrap \(signal SIGKILL\)/,
  );
  assert.ok(Date.now() - startedAt < 250, "signal exit must bypass the bootstrap deadline");
});

test("runProcess reaps a timed-out child that ignores SIGTERM and preserves diagnostics", async () => {
  const source = [
    "process.on('SIGTERM', () => process.stderr.write('ignored-sigterm\\n'));",
    "process.stdout.write(`child-pid=${process.pid}\\n`);",
    "setInterval(() => {}, 1000);",
  ].join("");

  let failure;
  try {
    await runProcess(process.execPath, ["-e", source], {
      cwd: process.cwd(),
      timeoutMs: 150,
      terminationGraceMs: 100,
      killGraceMs: 1_000,
    });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof Error, "runProcess must reject after its timeout");
  assert.match(failure.message, /timed out after 150ms/);
  assert.match(failure.message, /child-pid=\d+/);
  assert.match(failure.message, /ignored-sigterm/);
  const pid = Number.parseInt(failure.message.match(/child-pid=(\d+)/)?.[1] ?? "", 10);
  assert.ok(Number.isInteger(pid) && pid > 1, "the child must report a concrete PID");
  assert.equal(processIsAlive(pid), false, `timed-out child PID ${pid} must be reaped`);
});

test("runProcess reports a signal exit without mislabeling it as exit code null", {
  skip: process.platform === "win32",
}, async () => {
  const startedAt = Date.now();
  const source = [
    "process.stderr.write('signal-exit-diagnostic\\n');",
    "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);",
  ].join("");

  await assert.rejects(
    runProcess(process.execPath, ["-e", source], {
      cwd: process.cwd(),
      timeoutMs: 1_000,
    }),
    (error) => {
      assert.match(error.message, /exited via signal SIGTERM/);
      assert.match(error.message, /signal-exit-diagnostic/);
      assert.doesNotMatch(error.message, /exited with null/);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 250, "signal exit must clear the timeout waiter");
});

test("runProcess kills its isolated Unix process group so SIGTERM-ignoring descendants do not survive", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "illama-process-tree-test-"));
  const pidFile = join(directory, "pids.txt");
  const descendantSource = [
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
  ].join("");
  const parentSource = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "process.on('SIGTERM', () => {});",
    `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n' + descendant.pid + '\\n');`,
    "process.stdout.write('process-tree-ready\\n');",
    "setInterval(() => {}, 1000);",
  ].join("");
  let failure;
  let pids = [];

  try {
    await runProcess(process.execPath, ["-e", parentSource], {
      cwd: process.cwd(),
      timeoutMs: 200,
      terminationGraceMs: 100,
      killGraceMs: 1_000,
    });
  } catch (error) {
    failure = error;
  }

  try {
    pids = (await readFile(pidFile, "utf8"))
      .trim()
      .split("\n")
      .map((value) => Number.parseInt(value, 10));
    assert.ok(failure instanceof Error, "the process tree must time out");
    assert.match(failure.message, /process-tree-ready/);
    assert.equal(pids.length, 2);
    for (const pid of pids) {
      assert.equal(
        await waitForProcessDeath(pid, 1_000),
        true,
        `timed-out process-tree PID ${pid} must not survive`,
      );
    }
  } finally {
    for (const pid of pids) {
      if (processIsAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // The assertion raced a normal process exit.
        }
      }
    }
  }
});

test("owned-tree cleanup terminates a real live parent and its SIGTERM-ignoring descendant", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "illama-owned-tree-test-"));
  const pidFile = join(directory, "pids.txt");
  const descendantSource = [
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
  ].join("");
  const parentSource = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "process.on('SIGTERM', () => {});",
    `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n' + descendant.pid + '\\n');`,
    "setInterval(() => {}, 1000);",
  ].join("");
  const parent = spawn(process.execPath, ["-e", parentSource], { stdio: "ignore" });
  const tracker = createOwnedProcessTreeTracker({
    rootPid: parent.pid,
    rootExecutablePath: process.execPath,
    pollIntervalMs: 5,
  });
  let pids = [];

  try {
    pids = await readPidFileWhenReady(pidFile);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    await cleanupOwnedProcessTree(tracker, {
      terminationGraceMs: 50,
      killGraceMs: 1_000,
    });
    for (const pid of pids) {
      assert.equal(await waitForProcessDeath(pid, 1_000), true, `owned PID ${pid} must be dead`);
    }
  } finally {
    tracker.stop();
    killTestPids(pids);
  }
});

test("owned-tree cleanup remembers an observed descendant after its real parent exits and it is orphaned", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "illama-owned-orphan-test-"));
  const pidFile = join(directory, "pids.txt");
  const descendantSource = [
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
  ].join("");
  const parentSource = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n' + descendant.pid + '\\n');`,
    "setTimeout(() => process.exit(0), 150);",
  ].join("");
  const parent = spawn(process.execPath, ["-e", parentSource], { stdio: "ignore" });
  const parentExit = once(parent, "exit");
  const tracker = createOwnedProcessTreeTracker({
    rootPid: parent.pid,
    rootExecutablePath: process.execPath,
    pollIntervalMs: 5,
  });
  let pids = [];

  try {
    pids = await readPidFileWhenReady(pidFile);
    await parentExit;
    assert.equal(processIsAlive(pids[1]), true, "the orphan must be alive before cleanup");
    await cleanupOwnedProcessTree(tracker, {
      terminationGraceMs: 50,
      killGraceMs: 1_000,
    });
    assert.equal(
      await waitForProcessDeath(pids[1], 1_000),
      true,
      `remembered orphan PID ${pids[1]} must be dead`,
    );
  } finally {
    tracker.stop();
    killTestPids(pids);
  }
});

test("isolated process-group fallback cleans a descendant spawned before any report when the app exits between polls", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "illama-owned-early-exit-test-"));
  const pidFile = join(directory, "pids.txt");
  const descendantSource = [
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
  ].join("");
  const parentSource = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "setTimeout(() => {",
    `  const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' });`,
    `  writeFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n' + descendant.pid + '\\n');`,
    "  process.exit(0);",
    "}, 100);",
  ].join("");
  const parent = spawn(process.execPath, ["-e", parentSource], {
    detached: true,
    stdio: "ignore",
  });
  const parentExit = once(parent, "exit");
  const tracker = createOwnedProcessTreeTracker({
    rootPid: parent.pid,
    rootExecutablePath: process.execPath,
    processGroupId: parent.pid,
    pollIntervalMs: 1_000,
  });
  let pids = [];

  try {
    pids = await readPidFileWhenReady(pidFile);
    await parentExit;
    assert.equal(processIsAlive(pids[1]), true, "the pre-report descendant must start alive");
    await cleanupOwnedProcessTree(tracker, {
      terminationGraceMs: 50,
      killGraceMs: 1_000,
    });
    assert.equal(
      await waitForProcessDeath(pids[1], 1_000),
      true,
      `isolated pre-report descendant PID ${pids[1]} must be dead`,
    );
  } finally {
    tracker.stop();
    killTestPids(pids);
    try {
      process.kill(-parent.pid, "SIGKILL");
    } catch {
      // The isolated test process group is already gone.
    }
  }
});

test("process table parsing keeps exact pid, ppid, and full comm paths", () => {
  const executablePath = `/Volumes/${"long path ".repeat(30)}iLlama.app/Contents/MacOS/illama`;
  assert.deepEqual(parseProcessTable([
    `  101     1 ${executablePath}`,
    "  202   101 /usr/bin/helper with literal spaces",
  ].join("\n")), [
    { pid: 101, ppid: 1, comm: executablePath },
    { pid: 202, ppid: 101, comm: "/usr/bin/helper with literal spaces" },
  ]);
});

test("LaunchServices environment install rolls back earlier keys after a partial failure", async () => {
  const launchctl = createLaunchctlDouble(new Map([
    ["ILLAMA_ACCEPTANCE_MODE", "  old-mode  "],
    ["ILLAMA_ACCEPTANCE_MODEL", "old-model"],
  ]), ({ operation, key, value }) =>
    operation === "setenv" && key === "ILLAMA_ACCEPTANCE_MODEL" && value === "new-model"
      ? "injected set failure"
      : null);

  await assert.rejects(
    installLaunchServicesEnvironment({
      PATH: "/bin",
      ILLAMA_ACCEPTANCE_MODE: "1",
      ILLAMA_ACCEPTANCE_MODEL: "new-model",
    }, launchctl.execute),
    /launchctl setenv failed for ILLAMA_ACCEPTANCE_MODEL.*injected set failure/s,
  );

  assert.deepEqual(
    Object.fromEntries(launchctl.state),
    {
      ILLAMA_ACCEPTANCE_MODE: "  old-mode  ",
      ILLAMA_ACCEPTANCE_MODEL: "old-model",
    },
  );
  assert.deepEqual(launchctl.calls.at(-1), [
    "setenv",
    "ILLAMA_ACCEPTANCE_MODE",
    "  old-mode  ",
  ]);
});

test("LaunchServices cleanup restores every key in reverse and combines restoration failures", async () => {
  let restoring = false;
  const launchctl = createLaunchctlDouble(new Map([
    ["ILLAMA_ACCEPTANCE_MODE", "old-mode"],
  ]), ({ operation, key, value }) => {
    if (!restoring) return null;
    if (operation === "unsetenv" && key === "FAKE_LLAMA_MODEL_ID") {
      return new Error("unset exploded");
    }
    if (operation === "setenv" && key === "ILLAMA_ACCEPTANCE_MODE" && value === "old-mode") {
      return "restore denied";
    }
    return null;
  });
  const restore = await installLaunchServicesEnvironment({
    ILLAMA_ACCEPTANCE_MODE: "1",
    FAKE_LLAMA_MODEL_ID: "fixture-model",
  }, launchctl.execute);
  restoring = true;

  await assert.rejects(restore(), (error) => {
    assert.match(error.message, /FAKE_LLAMA_MODEL_ID.*unset exploded/s);
    assert.match(error.message, /ILLAMA_ACCEPTANCE_MODE.*restore denied/s);
    return true;
  });
  assert.deepEqual(launchctl.calls.slice(-2), [
    ["unsetenv", "FAKE_LLAMA_MODEL_ID"],
    ["setenv", "ILLAMA_ACCEPTANCE_MODE", "old-mode"],
  ]);
});

test("LaunchServices distinguishes missing status-0 getenv from explicit empty and preserves spaces", async () => {
  const launchctl = createLaunchctlDouble(new Map([
    ["ILLAMA_ACCEPTANCE_EMPTY", ""],
    ["ILLAMA_ACCEPTANCE_SPACED", "  keep both edges  "],
  ]));
  const restore = await installLaunchServicesEnvironment({
    ILLAMA_ACCEPTANCE_MISSING: "installed-missing",
    ILLAMA_ACCEPTANCE_EMPTY: "installed-empty",
    ILLAMA_ACCEPTANCE_SPACED: "installed-spaced",
  }, launchctl.execute);

  await restore();

  assert.equal(launchctl.state.has("ILLAMA_ACCEPTANCE_MISSING"), false);
  assert.equal(launchctl.state.get("ILLAMA_ACCEPTANCE_EMPTY"), "");
  assert.equal(launchctl.state.get("ILLAMA_ACCEPTANCE_SPACED"), "  keep both edges  ");
  assert.deepEqual(launchctl.calls.slice(-3), [
    ["setenv", "ILLAMA_ACCEPTANCE_SPACED", "  keep both edges  "],
    ["setenv", "ILLAMA_ACCEPTANCE_EMPTY", ""],
    ["unsetenv", "ILLAMA_ACCEPTANCE_MISSING"],
  ]);
});

test("final cleanup reaps the launcher after SIGKILL even when environment restoration fails", async () => {
  const child = createFakeChild({ exitAfterSignal: "SIGKILL", exitDelayMs: 25 });
  const startedAt = Date.now();

  await assert.rejects(
    cleanupAcceptanceResources({
      occupied: null,
      restoreLaunchEnvironment: async () => {
        throw new Error("restore denied");
      },
      child,
      terminationGraceMs: 5,
      killGraceMs: 100,
    }),
    /restore denied/,
  );

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.signalCode, "SIGKILL");
  assert.ok(Date.now() - startedAt >= 25, "cleanup must wait for the final exit event");
});

test("final cleanup fails closed when the launcher cannot be reaped after SIGKILL", async () => {
  const child = createFakeChild();

  await assert.rejects(
    cleanupAcceptanceResources({
      occupied: null,
      restoreLaunchEnvironment: async () => {},
      child,
      terminationGraceMs: 5,
      killGraceMs: 10,
    }),
    /launcher cleanup failed.*could not be reaped.*SIGKILL/s,
  );
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("LaunchServices PID parsing matches the absolute executable and preserves the pre-launch baseline", async () => {
  const executablePath = "/Applications/iLlama Candidate.app/Contents/MacOS/illama";
  const processList = [
    `  101 ${executablePath}`,
    "  150 /Applications/iLlama Candidate.app/Contents/MacOS/illama-helper",
    `  202 ${executablePath}`,
  ].join("\n");

  assert.deepEqual(
    [...parseExactExecutablePids(processList, executablePath)],
    [101, 202],
  );

  const tracker = await identifyNewLaunchServicesApp({
    executablePath,
    baselinePids: new Set([101]),
    launcher: { exitCode: null, signalCode: null },
    timeoutMs: 20,
    listExactPids: () => new Set([101, 202]),
  });
  const terminated = [];
  await cleanupTrackedLaunchServicesApp(tracker, {
    listExactPids: () => new Set([101, 202]),
    terminatePid: async (pid) => terminated.push(pid),
  });

  assert.equal(tracker.pid, 202);
  assert.deepEqual(terminated, [202], "the pre-existing PID must never be signalled");

  const longMountedPath = `/Volumes/${"long mounted path ".repeat(20)}iLlama.app/Contents/MacOS/illama`;
  const psCalls = [];
  const listed = listExactExecutablePids(longMountedPath, (args) => {
    psCalls.push(args);
    return { status: 0, stdout: `  404     1 ${longMountedPath}\n`, stderr: "" };
  });
  assert.deepEqual(psCalls, [["-ww", "-axo", "pid=,ppid=,comm="]]);
  assert.deepEqual([...listed], [404]);
});

test("LaunchServices cleanup refuses to signal ambiguous new exact-path instances", async () => {
  const tracker = {
    executablePath: "/Applications/iLlama.app/Contents/MacOS/illama",
    baselinePids: new Set([101]),
    pid: null,
  };
  const terminated = [];

  await assert.rejects(
    cleanupTrackedLaunchServicesApp(tracker, {
      listExactPids: () => new Set([101, 202, 303]),
      terminatePid: async (pid) => terminated.push(pid),
    }),
    /ambiguous.*202, 303.*refusing to signal/s,
  );
  assert.deepEqual(terminated, []);
});

function expected() {
  return {
    binaryPath: "/tmp/fake-llama-server",
    modelPath: "/tmp/model.gguf",
    appVersion: "3.2.0",
    surface: "deep-runner",
    runNonce: "run-nonce-1234",
  };
}

function validReport() {
  const args = [
    "--model",
    "/tmp/model.gguf",
    "--host",
    "127.0.0.1",
    "--port",
    "18181",
    "--ctx-size",
    "2048",
  ];
  return {
    schemaVersion: 1,
    kind: "native-tauri",
    surface: "deep-runner",
    runNonce: "run-nonce-1234",
    status: "success",
    appVersion: "3.2.0",
    startedPid: 4321,
    steps: [
      "tauri-runtime",
      "scan-model-directory",
      "probe-llama-server",
      "build-command-spec",
      "occupied-port-recovery",
      "start-llama",
      "healthy-runtime-snapshot",
      "models",
      "non-stream-chat",
      "stream-cancellation",
      "stop-llama",
      "port-closed",
    ].map((name) => ({
      name,
      status: "success",
      transport: ["non-stream-chat", "stream-cancellation"].includes(name)
        ? "webview-http"
        : "tauri-ipc",
    })),
    scan: {
      requestId: "native-acceptance-run-nonce-1234",
      directory: "/tmp",
      filesScanned: 2,
      modelsFound: 1,
      configuredModel: {
        path: "/tmp/model.gguf",
        metadataStatus: "ready",
        available: true,
      },
      rejectedInvalidModels: [{
        path: "/tmp/invalid.gguf",
        metadataStatus: "invalid",
        available: false,
      }],
    },
    commandSpec: {
      executable: "/tmp/fake-llama-server",
      args,
      warnings: [],
      capabilities: {
        binaryPath: "/tmp/fake-llama-server",
        versionText: "llama-server fake 3.2.0",
        supportedFlags: ["--model", "--host", "--port", "--ctx-size"],
        status: "compatible",
        warnings: [],
      },
    },
    activeLaunch: {
      binaryPath: "/tmp/fake-llama-server",
      modelPath: "/tmp/model.gguf",
      host: "127.0.0.1",
      port: 18181,
      commandArgs: args,
      startedAt: "2026-07-22T00:00:00.000Z",
      parameters: { ctxSize: { source: "argument", value: 2048 } },
    },
    modelId: "fixture-model",
    chat: { content: "OK", finishReason: "stop" },
    cancellation: {
      abortControllerAborted: true,
      abortErrorObserved: true,
      streamStarted: true,
    },
    recovery: {
      code: "port_unavailable",
      message: "端口已被占用",
      recoveryAction: "changePort",
      exercised: true,
    },
    stop: { pid: null, activeLaunch: null, portReachable: false },
    healthTransition: {
      exercised: false,
      healthyStatus: "healthy",
      degradedStatus: null,
      recoveredStatus: null,
    },
  };
}

function validNormalReport() {
  const deep = validReport();
  const requiredTargets = [
    "model-option",
    "start",
    "change-port",
    "start",
    "connection-check",
    "open-test",
    "chat-input",
    "cancel-stream",
    "tab-run",
    "stop",
  ];
  const steps = [
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
  ].map(([name, transport]) => ({ name, status: "success", transport }));
  const snapshot = { exists: false, byteLength: 0, sha256: null };
  return {
    schemaVersion: 1,
    kind: "normal-app-keyboard",
    surface: "normal-app",
    runNonce: "run-nonce-1234",
    status: "success",
    appVersion: "3.2.0",
    steps,
    scan: {
      directory: "/tmp",
      filesScanned: 2,
      modelsFound: 1,
      configuredModel: deep.scan.configuredModel,
    },
    activeLaunch: { ...deep.activeLaunch, modelId: "fixture-model" },
    modelId: "fixture-model",
    connection: { checked: true, ok: true, models: ["fixture-model"] },
    chat: {
      prompt: "slow cancellation acceptance",
      streamStarted: true,
      contentObserved: "partial",
    },
    cancellation: {
      cancelControlActivated: true,
      cancelledUiObserved: true,
      serverDisconnectObserved: true,
    },
    recovery: { ...deep.recovery, visible: true },
    stop: deep.stop,
    startedPid: deep.startedPid,
    trustedInputs: requiredTargets.map((target, index) => ({
      sequence: index + 1,
      eventType: "keydown",
      key: "Enter",
      target,
      isTrusted: true,
    })),
    layout: {
      requestedWidth: 1000,
      requestedHeight: 680,
      viewportWidth: 1000,
      viewportHeight: 680,
      documentScrollWidth: 1000,
      documentScrollHeight: 680,
      overflowX: false,
      overflowY: false,
      targets: [...new Set(requiredTargets)].map((target) => ({
        target,
        focusObserved: true,
        enabled: true,
        visible: true,
        withinViewport: true,
      })),
    },
    settingsIsolation: {
      mode: "in-memory",
      path: "/Users/test/Library/Application Support/com.illama.mac/settings.json",
      before: snapshot,
      after: { ...snapshot },
      unchanged: true,
    },
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForProcessDeath(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (!processIsAlive(pid)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  return !processIsAlive(pid);
}

async function readPidFileWhenReady(path) {
  const deadline = Date.now() + 2_000;
  while (Date.now() <= deadline) {
    try {
      const pids = (await readFile(path, "utf8"))
        .trim()
        .split("\n")
        .map((value) => Number.parseInt(value, 10));
      if (pids.length === 2 && pids.every((pid) => Number.isInteger(pid) && pid > 1)) return pids;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`timed out waiting for PID file ${path}`);
}

function killTestPids(pids) {
  for (const pid of pids) {
    if (!processIsAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The test cleanup raced a normal process exit.
    }
  }
}

function createLaunchctlDouble(initialState, failureFor) {
  const state = new Map(initialState);
  const calls = [];
  const execute = (args) => {
    calls.push([...args]);
    const [operation, key, value] = args;
    const failure = failureFor?.({ operation, key, value });
    if (failure instanceof Error) throw failure;
    if (failure) return { status: 1, stdout: "", stderr: failure };
    if (operation === "getenv") {
      return {
        status: 0,
        stdout: state.has(key) ? `${state.get(key)}\n` : "",
        stderr: "",
      };
    }
    if (operation === "print") {
      const entries = [...state]
        .map(([name, entryValue]) => `\t\t${name} => ${entryValue}`)
        .join("\n");
      return {
        status: 0,
        stdout: `gui = {\n\tenvironment = {\n${entries}\n\t}\n}`,
        stderr: "",
      };
    }
    if (operation === "setenv") state.set(key, value);
    if (operation === "unsetenv") state.delete(key);
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, execute, state };
}

function createFakeChild({ exitAfterSignal = null, exitDelayMs = 0 } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 98_765;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === exitAfterSignal) {
      setTimeout(() => {
        child.signalCode = signal;
        child.emit("exit", null, signal);
      }, exitDelayMs);
    }
    return true;
  };
  return child;
}
