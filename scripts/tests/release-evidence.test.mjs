import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { constants as fsConstants, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const evidenceUrl = new URL("../lib/release-evidence.mjs", import.meta.url);
const curlRunnerUrl = new URL("../external-client-curl.mjs", import.meta.url);
const evidenceModule = await import(evidenceUrl).catch((loadError) => ({ loadError }));
const curlRunnerModule = await import(curlRunnerUrl).catch((loadError) => ({ loadError }));

const metadata = Object.freeze({
  headSha: "a".repeat(40),
  workflowPath: ".github/workflows/release-acceptance.yml",
  runId: 123456789,
  runAttempt: 2,
  repository: "example/iLlama",
});
const cleanCheckNames = Object.freeze([
  "codesignDetails",
  "codesignVerify",
  "hdiutilAttach",
  "spctlApp",
  "spctlDmg",
  "staplerApp",
  "staplerDmg",
]);

function evidenceApi(name) {
  assert.ifError(evidenceModule.loadError);
  assert.equal(typeof evidenceModule[name], "function", `${name} must be exported`);
  return evidenceModule[name];
}

function curlApi(name) {
  assert.ifError(curlRunnerModule.loadError);
  assert.equal(typeof curlRunnerModule[name], "function", `${name} must be exported`);
  return curlRunnerModule[name];
}

async function releaseFixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "illama-release-evidence-")));
  const reportPath = join(directory, "matrix-report.json");
  const binaryPath = join(directory, "llama-server");
  const modelPath = join(directory, "model.gguf");
  const binaryContents = "llama-server-binary\n";
  const modelContents = "GGUF-real-model\n";
  await writeFile(
    reportPath,
    `${JSON.stringify(matrixReport(binaryPath, modelPath, binaryContents, modelContents))}\n`,
  );
  await writeFile(binaryPath, binaryContents, { mode: 0o755 });
  await writeFile(modelPath, modelContents);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    reportPath,
    binaryPath,
    modelPath,
    artifacts: { binary: binaryPath, model: modelPath },
  };
}

test("creates and validates an exact workflow/run/report/artifact-bound manifest", async (t) => {
  const fixture = await releaseFixture(t);
  const createReleaseEvidence = evidenceApi("createReleaseEvidence");
  const validateReleaseEvidence = evidenceApi("validateReleaseEvidence");
  const manifest = await createReleaseEvidence({
    type: "llama-matrix",
    reportPath: fixture.reportPath,
    artifacts: fixture.artifacts,
    ...metadata,
  });

  assert.equal(manifest.type, "llama-matrix");
  assert.equal(manifest.status, "success");
  assert.match(manifest.reportSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    Object.keys(manifest.checksums).sort(),
    ["binary", "model"],
  );
  await assert.doesNotReject(validateReleaseEvidence(manifest, {
    type: "llama-matrix",
    reportPath: fixture.reportPath,
    artifacts: fixture.artifacts,
    ...metadata,
  }));
});

test("rejects mismatched SHA, repository, workflow, run ID, attempt, and status", async (t) => {
  const fixture = await releaseFixture(t);
  const createReleaseEvidence = evidenceApi("createReleaseEvidence");
  const validateReleaseEvidence = evidenceApi("validateReleaseEvidence");
  const manifest = await createReleaseEvidence({
    type: "llama-matrix",
    reportPath: fixture.reportPath,
    artifacts: fixture.artifacts,
    ...metadata,
  });
  const mutations = {
    headSha: "b".repeat(40),
    repository: "attacker/fork",
    workflowPath: ".github/workflows/other.yml",
    runId: metadata.runId + 1,
    runAttempt: metadata.runAttempt + 1,
    status: "failure",
  };

  for (const [field, value] of Object.entries(mutations)) {
    await assert.rejects(
      validateReleaseEvidence({ ...manifest, [field]: value }, {
        type: "llama-matrix",
        reportPath: fixture.reportPath,
        artifacts: fixture.artifacts,
        ...metadata,
      }),
      new RegExp(field === "headSha" ? "SHA" : field, "i"),
    );
  }
});

test("rejects malicious GitHub run metadata before exposing its run attempt", async (t) => {
  const validateWorkflowRunMetadata = evidenceApi("validateWorkflowRunMetadata");
  const directory = await realpath(await mkdtemp(join(tmpdir(), "illama-workflow-run-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runJsonPath = join(directory, "run.json");
  const valid = {
    id: metadata.runId,
    status: "completed",
    conclusion: "success",
    head_branch: "v3.2.0-rc.1",
    head_sha: metadata.headSha,
    path: metadata.workflowPath,
    event: "workflow_dispatch",
    run_attempt: metadata.runAttempt,
    repository: { full_name: metadata.repository },
  };
  const expected = {
    ...metadata,
    event: "workflow_dispatch",
    headBranch: "v3.2.0-rc.1",
  };
  assert.equal(validateWorkflowRunMetadata(valid, expected), metadata.runAttempt);

  const cliArguments = (runJson, attemptOutput) => [
    resolve("scripts/validate-workflow-run.mjs"),
    "--run-json", runJson,
    "--attempt-output", attemptOutput,
    "--run-id", String(metadata.runId),
    "--head-sha", metadata.headSha,
    "--workflow-path", metadata.workflowPath,
    "--repository", metadata.repository,
    "--event", "workflow_dispatch",
    "--head-branch", "v3.2.0-rc.1",
  ];
  let mutationIndex = 0;
  for (const [label, mutate] of [
    ["status", (run) => { run.status = "in_progress"; }],
    ["conclusion", (run) => { run.conclusion = "failure"; }],
    ["head SHA", (run) => { run.head_sha = "b".repeat(40); }],
    ["workflow path", (run) => { run.path = ".github/workflows/attacker.yml"; }],
    ["repository", (run) => { run.repository.full_name = "attacker/fork"; }],
    ["event", (run) => { run.event = "push"; }],
    ["head branch", (run) => { run.head_branch = "main"; }],
    ["run ID", (run) => { run.id += 1; }],
    ["run attempt", (run) => { run.run_attempt = 0; }],
  ]) {
    const malicious = structuredClone(valid);
    mutate(malicious);
    assert.throws(
      () => validateWorkflowRunMetadata(malicious, expected),
      new RegExp(label, "i"),
    );
    const maliciousJsonPath = join(directory, `malicious-${mutationIndex}.json`);
    const maliciousAttemptPath = join(directory, `malicious-${mutationIndex}.attempt`);
    await writeFile(maliciousJsonPath, `${JSON.stringify(malicious)}\n`);
    const rejectedCli = spawnSync(process.execPath, cliArguments(
      maliciousJsonPath,
      maliciousAttemptPath,
    ), { encoding: "utf8" });
    assert.notEqual(rejectedCli.status, 0, `${label} metadata unexpectedly passed the CLI`);
    await assert.rejects(access(maliciousAttemptPath), { code: "ENOENT" });
    mutationIndex += 1;
  }

  const missingHeadBranch = structuredClone(valid);
  delete missingHeadBranch.head_branch;
  assert.throws(
    () => validateWorkflowRunMetadata(missingHeadBranch, expected),
    /head branch/i,
  );

  await writeFile(runJsonPath, `${JSON.stringify(valid)}\n`);
  const attemptPath = join(directory, "attempt.txt");
  const cli = spawnSync(process.execPath, cliArguments(runJsonPath, attemptPath), {
    encoding: "utf8",
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(await readFile(attemptPath, "utf8"), `${metadata.runAttempt}\n`);
  const staleAttempt = spawnSync(process.execPath, cliArguments(runJsonPath, attemptPath), {
    encoding: "utf8",
  });
  assert.notEqual(staleAttempt.status, 0, "validator must refuse a pre-existing attempt output");
  assert.equal(await readFile(attemptPath, "utf8"), `${metadata.runAttempt}\n`);
});

test("rejects modified source reports and modified bound artifacts", async (t) => {
  const fixture = await releaseFixture(t);
  const createReleaseEvidence = evidenceApi("createReleaseEvidence");
  const validateReleaseEvidence = evidenceApi("validateReleaseEvidence");
  const manifest = await createReleaseEvidence({
    type: "llama-matrix",
    reportPath: fixture.reportPath,
    artifacts: fixture.artifacts,
    ...metadata,
  });

  await writeFile(fixture.reportPath, "{}\n");
  await assert.rejects(
    validateReleaseEvidence(manifest, {
      type: "llama-matrix",
      reportPath: fixture.reportPath,
      artifacts: fixture.artifacts,
      ...metadata,
    }),
    /report.*SHA|report.*changed/i,
  );

  await writeFile(
    fixture.reportPath,
    `${JSON.stringify(matrixReport(
      fixture.binaryPath,
      fixture.modelPath,
      "llama-server-binary\n",
      "GGUF-real-model\n",
    ))}\n`,
  );
  await writeFile(fixture.modelPath, "tampered-model\n");
  await assert.rejects(
    validateReleaseEvidence(manifest, {
      type: "llama-matrix",
      reportPath: fixture.reportPath,
      artifacts: fixture.artifacts,
      ...metadata,
    }),
    /model.*checksum|model.*changed/i,
  );
});

test("promotion rehashes the downloaded report and cross-checks report-bound matrix digests", async (t) => {
  const fixture = await releaseFixture(t);
  const createReleaseEvidence = evidenceApi("createReleaseEvidence");
  const validateReleaseEvidence = evidenceApi("validateReleaseEvidence");
  const manifest = await createReleaseEvidence({
    type: "llama-matrix",
    reportPath: fixture.reportPath,
    artifacts: fixture.artifacts,
    ...metadata,
  });

  await assert.doesNotReject(validateReleaseEvidence(manifest, {
    type: "llama-matrix",
    reportPath: fixture.reportPath,
    ...metadata,
  }));
  const changed = structuredClone(manifest);
  changed.checksums.binary = "b".repeat(64);
  await assert.rejects(
    validateReleaseEvidence(changed, {
      type: "llama-matrix",
      reportPath: fixture.reportPath,
      ...metadata,
    }),
    /binary.*report|report.*binary/i,
  );
});

test("matrix evidence rejects incomplete native lifecycles, path swaps, and unbound extra binaries", async (t) => {
  const fixture = await releaseFixture(t);
  const createReleaseEvidence = evidenceApi("createReleaseEvidence");
  const original = JSON.parse(await readFile(fixture.reportPath, "utf8"));

  for (const field of ["scan", "commandSpec", "activeSnapshot", "modelId", "chat", "cancellation", "stop"]) {
    const changed = structuredClone(original);
    delete changed.entries[0][field];
    await writeFile(fixture.reportPath, `${JSON.stringify(changed)}\n`);
    await assert.rejects(
      createReleaseEvidence({
        type: "llama-matrix",
        reportPath: fixture.reportPath,
        artifacts: fixture.artifacts,
        ...metadata,
      }),
      new RegExp(field === "activeSnapshot" ? "active" : field, "i"),
    );
  }

  const pathSwap = structuredClone(original);
  pathSwap.entries[0].binaryPath = join(fixture.directory, "unbound-server");
  await writeFile(fixture.reportPath, `${JSON.stringify(pathSwap)}\n`);
  await assert.rejects(
    createReleaseEvidence({
      type: "llama-matrix",
      reportPath: fixture.reportPath,
      artifacts: fixture.artifacts,
      ...metadata,
    }),
    /binary.*path|path.*binary/i,
  );

  const binaryAlias = join(fixture.directory, "llama-server-alias");
  await symlink(fixture.binaryPath, binaryAlias);
  const symlinkedPath = structuredClone(original);
  symlinkedPath.entries[0].binaryPath = binaryAlias;
  symlinkedPath.entries[0].commandSpec.executable = binaryAlias;
  symlinkedPath.entries[0].activeSnapshot.activeLaunch.binaryPath = binaryAlias;
  await writeFile(fixture.reportPath, `${JSON.stringify(symlinkedPath)}\n`);
  await assert.rejects(
    createReleaseEvidence({
      type: "llama-matrix",
      reportPath: fixture.reportPath,
      artifacts: fixture.artifacts,
      ...metadata,
    }),
    /canonical.*binary|binary.*canonical/i,
  );

  const extra = structuredClone(original);
  const extraEntry = structuredClone(extra.entries[0]);
  extraEntry.binaryPath = "/tmp/extra-llama";
  extraEntry.commandSpec.executable = extraEntry.binaryPath;
  extraEntry.activeSnapshot.activeLaunch.binaryPath = extraEntry.binaryPath;
  extra.entries.push(extraEntry);
  await writeFile(fixture.reportPath, `${JSON.stringify(extra)}\n`);
  await assert.rejects(
    createReleaseEvidence({
      type: "llama-matrix",
      reportPath: fixture.reportPath,
      artifacts: fixture.artifacts,
      ...metadata,
    }),
    /binary-1|unbound|artifact/i,
  );

  const duplicate = structuredClone(original);
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  await writeFile(fixture.reportPath, `${JSON.stringify(duplicate)}\n`);
  await assert.rejects(
    createReleaseEvidence({
      type: "llama-matrix",
      reportPath: fixture.reportPath,
      artifacts: {
        ...fixture.artifacts,
        "binary-1": fixture.binaryPath,
      },
      ...metadata,
    }),
    /duplicate|unique|one-to-one/i,
  );

  for (const mutation of ["missing", "duplicate", "out-of-order", "wrong-transport"]) {
    const changed = structuredClone(original);
    if (mutation === "missing") {
      changed.entries[0].steps = changed.entries[0].steps.filter(
        (step) => step.name !== "non-stream-chat",
      );
    } else if (mutation === "duplicate") {
      changed.entries[0].steps.push({
        ...changed.entries[0].steps.find((step) => step.name === "start-llama"),
      });
    } else if (mutation === "out-of-order") {
      const start = changed.entries[0].steps.findIndex((step) => step.name === "start-llama");
      [changed.entries[0].steps[start], changed.entries[0].steps[start + 1]] = [
        changed.entries[0].steps[start + 1],
        changed.entries[0].steps[start],
      ];
    } else {
      changed.entries[0].steps.find(
        (step) => step.name === "non-stream-chat",
      ).transport = "tauri-ipc";
    }
    await writeFile(fixture.reportPath, `${JSON.stringify(changed)}\n`);
    await assert.rejects(
      createReleaseEvidence({
        type: "llama-matrix",
        reportPath: fixture.reportPath,
        artifacts: fixture.artifacts,
        ...metadata,
      }),
      /step|transport|order|exactly once/i,
    );
  }

  const detachedHashes = structuredClone(original);
  detachedHashes.entries[0].artifacts.binarySha256 = "f".repeat(64);
  await writeFile(fixture.reportPath, `${JSON.stringify(detachedHashes)}\n`);
  await assert.rejects(
    createReleaseEvidence({
      type: "llama-matrix",
      reportPath: fixture.reportPath,
      artifacts: fixture.artifacts,
      ...metadata,
    }),
    /artifact|binary.*SHA/i,
  );
});

test("real matrix derives the commit from checkout and records canonical native proof", () => {
  const source = readText("scripts/real-smoke-matrix.mjs");
  assert.doesNotMatch(source, /process\.env\.GITHUB_SHA/);
  assert.match(source, /const gitSha = currentGitSha\(\)/);
  assert.match(source, /await realpath\(requestedBinary\)/);
  assert.match(source, /steps:\s*native\.steps/);
  assert.match(source, /artifacts:\s*native\.artifacts/);
});

test("external-client manifest rejects a failed or detached native service report", async (t) => {
  const createReleaseEvidence = evidenceApi("createReleaseEvidence");
  const directory = await mkdtemp(join(tmpdir(), "illama-external-native-binding-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = join(directory, "llama-server");
  const modelPath = join(directory, "model.gguf");
  const externalPath = join(directory, "external.json");
  const nativePath = join(directory, "native.json");
  await writeFile(binaryPath, "binary\n", { mode: 0o755 });
  await writeFile(modelPath, "model\n");
  const external = await validExternalClientReport();
  await writeFile(externalPath, `${JSON.stringify(external)}\n`);
  const native = validNativeExternalReport(binaryPath, modelPath, external);
  const artifacts = {
    binary: binaryPath,
    curl: external.curl.path,
    model: modelPath,
    nativeReport: nativePath,
  };
  await writeFile(nativePath, `${JSON.stringify(native)}\n`);
  await assert.doesNotReject(createReleaseEvidence({
    type: "external-client",
    reportPath: externalPath,
    artifacts,
    ...metadata,
  }));

  const mutations = [
    ["failed native status", (value) => { value.status = "failure"; }],
    ["detached endpoint", (value) => { value.activeLaunch.port += 1; }],
    ["detached model", (value) => { value.modelId = "other-model"; }],
    ["configured-only client", (value) => { value.externalClient = { configured: true }; }],
    ["changed embedded report", (value) => { value.externalClient.report.transcript += "changed"; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(native);
    mutate(changed);
    await writeFile(nativePath, `${JSON.stringify(changed)}\n`);
    await assert.rejects(
      createReleaseEvidence({
        type: "external-client",
        reportPath: externalPath,
        artifacts,
        ...metadata,
      }),
      /native|endpoint|model|external|report SHA/i,
      label,
    );
  }
});

test("rejects legacy trust shortcuts and arbitrary operator JSON", async (t) => {
  const fixture = await releaseFixture(t);
  const createReleaseEvidence = evidenceApi("createReleaseEvidence");
  const validateReleaseEvidence = evidenceApi("validateReleaseEvidence");
  const manifest = await createReleaseEvidence({
    type: "llama-matrix",
    reportPath: fixture.reportPath,
    artifacts: fixture.artifacts,
    ...metadata,
  });

  for (const field of ["acceptanceRecord", "externalClientResult", "modelsVerified", "chatVerified"]) {
    await assert.rejects(
      validateReleaseEvidence({ ...manifest, [field]: true }, {
        type: "llama-matrix",
        reportPath: fixture.reportPath,
        artifacts: fixture.artifacts,
        ...metadata,
      }),
      /unknown|legacy|field/i,
    );
  }

  const legacy = {
    client: "curl",
    version: "operator-entered",
    headSha: metadata.headSha,
    status: "success",
    modelsVerified: true,
    chatVerified: true,
  };
  const result = spawnSync(process.execPath, [
    resolve("scripts/validate-external-client-evidence.mjs"),
    JSON.stringify(legacy),
    "curl",
    "operator-entered",
    metadata.headSha,
  ], { encoding: "utf8" });
  assert.notEqual(result.status, 0, "legacy arbitrary JSON must never be accepted");
});

test("CLI tools create and validate only file-backed reports with exact workflow metadata", async (t) => {
  const fixture = await releaseFixture(t);
  const evidencePath = join(fixture.directory, "evidence.json");
  const common = [
    "--type", "llama-matrix",
    "--report", fixture.reportPath,
    "--head-sha", metadata.headSha,
    "--workflow-path", metadata.workflowPath,
    "--run-id", String(metadata.runId),
    "--run-attempt", String(metadata.runAttempt),
    "--repository", metadata.repository,
    "--artifact", `binary=${fixture.binaryPath}`,
    "--artifact", `model=${fixture.modelPath}`,
  ];
  const createResult = spawnSync(process.execPath, [
    resolve("scripts/create-release-evidence.mjs"),
    "--output", evidencePath,
    ...common,
  ], { encoding: "utf8" });
  assert.equal(createResult.status, 0, createResult.stderr);
  const manifest = JSON.parse(await readFile(evidencePath, "utf8"));
  assert.equal(manifest.runId, metadata.runId);

  const validateResult = spawnSync(process.execPath, [
    resolve("scripts/validate-release-evidence.mjs"),
    "--evidence", evidencePath,
    ...common,
  ], { encoding: "utf8" });
  assert.equal(validateResult.status, 0, validateResult.stderr);

  const externalReport = await validExternalClientReport();
  const externalPath = join(fixture.directory, "external-client.json");
  await writeFile(externalPath, `${JSON.stringify(externalReport, null, 2)}\n`);
  const externalResult = spawnSync(process.execPath, [
    resolve("scripts/validate-external-client-evidence.mjs"),
    "--report", externalPath,
    "--endpoint", externalReport.endpoint,
    "--head-sha", metadata.headSha,
    "--workflow-path", metadata.workflowPath,
    "--run-id", String(metadata.runId),
    "--run-attempt", String(metadata.runAttempt),
    "--repository", metadata.repository,
    "--verify-curl-executable",
  ], { encoding: "utf8" });
  assert.equal(externalResult.status, 0, externalResult.stderr);
});

test("validates executable curl evidence and rejects missing HTTP modes or boolean-only cancellation", async () => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  const report = await validExternalClientReport();
  await assert.doesNotReject(validateExternalClientEvidence(report, {
    endpoint: report.endpoint,
    verifyCurlExecutable: true,
    ...metadata,
  }));

  for (const field of ["models", "nonStream", "streaming", "cancellation"]) {
    const changed = structuredClone(report);
    if (field === "cancellation") changed.cancellation = { cancelled: true };
    else delete changed[field];
    await assert.rejects(
      validateExternalClientEvidence(changed, {
        endpoint: report.endpoint,
        verifyCurlExecutable: true,
        ...metadata,
      }),
      new RegExp(field === "nonStream" ? "non-stream" : field, "i"),
    );
  }
});

test("SSE parsing retains data-event order and the terminal DONE frame", () => {
  const parseSse = curlApi("parseSse");
  const event = { choices: [{ delta: { content: "Hello" } }] };
  const streaming = parseSse([
    `data: ${JSON.stringify(event)}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n"));

  assert.deepEqual(streaming, {
    events: [event],
    content: "Hello",
    done: true,
    sequence: [
      { type: "event", eventIndex: 0 },
      { type: "done" },
    ],
  });
});

test("SSE parsing rejects DONE before the first content event", () => {
  const parseSse = curlApi("parseSse");
  const contentEvent = JSON.stringify({ choices: [{ delta: { content: "late" } }] });
  assert.throws(
    () => parseSse(`data: [DONE]\n\ndata: ${contentEvent}\n\n`),
    /DONE.*before.*content/i,
  );
});

test("SSE parsing rejects a non-empty data event after DONE", () => {
  const parseSse = curlApi("parseSse");
  const first = JSON.stringify({ choices: [{ delta: { content: "first" } }] });
  const trailing = JSON.stringify({ choices: [{ delta: { content: "trailing" } }] });
  assert.throws(
    () => parseSse(`data: ${first}\n\ndata: [DONE]\n\ndata: ${trailing}\n\n`),
    /data.*after.*DONE/i,
  );
});

test("SSE parsing rejects a duplicate DONE frame", () => {
  const parseSse = curlApi("parseSse");
  const event = JSON.stringify({ choices: [{ delta: { content: "Hello" } }] });
  assert.throws(
    () => parseSse(`data: ${event}\n\ndata: [DONE]\n\ndata: [DONE]\n\n`),
    /duplicate.*DONE/i,
  );
});

test("external-client validation rejects reversed SSE sequence evidence", async () => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  const report = await validExternalClientReport();
  report.streaming.sequence.reverse();

  await assert.rejects(
    validateExternalClientEvidence(report, { endpoint: report.endpoint, ...metadata }),
    /SSE.*sequence|DONE.*terminal|event.*order/i,
  );
});

test("external-client validation rejects an SSE event recorded after DONE", async () => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  const report = await validExternalClientReport();
  report.streaming.sequence.push({ type: "event", eventIndex: 0 });

  await assert.rejects(
    validateExternalClientEvidence(report, { endpoint: report.endpoint, ...metadata }),
    /SSE.*sequence|DONE.*terminal|event.*order/i,
  );
});

test("external-client validation rejects duplicate DONE sequence evidence", async () => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  const report = await validExternalClientReport();
  report.streaming.sequence.push({ type: "done" });

  await assert.rejects(
    validateExternalClientEvidence(report, { endpoint: report.endpoint, ...metadata }),
    /SSE.*sequence|DONE.*terminal|event.*order/i,
  );
});

test("external-client validation rejects missing terminal DONE sequence evidence", async () => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  const report = await validExternalClientReport();
  report.streaming.sequence.pop();

  await assert.rejects(
    validateExternalClientEvidence(report, { endpoint: report.endpoint, ...metadata }),
    /SSE.*sequence|DONE.*terminal/i,
  );
});

test("external-client validation rejects out-of-range and duplicate SSE event indexes", async () => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  for (const mutate of [
    (report) => { report.streaming.sequence[0].eventIndex = report.streaming.events.length; },
    (report) => { report.streaming.sequence[1].eventIndex = 0; },
  ]) {
    const report = await validExternalClientReport();
    mutate(report);
    await assert.rejects(
      validateExternalClientEvidence(report, { endpoint: report.endpoint, ...metadata }),
      /SSE.*event order|SSE.*sequence/i,
    );
  }
});

test("external-client validation rejects content not reproduced by ordered SSE events", async () => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  const report = await validExternalClientReport();
  report.streaming.content = "tampered";

  await assert.rejects(
    validateExternalClientEvidence(report, { endpoint: report.endpoint, ...metadata }),
    /SSE.*content.*inconsistent/i,
  );
});

test("rejects fake curl path/version and a changed transcript", async () => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  const report = await validExternalClientReport();
  const expected = { endpoint: report.endpoint, verifyCurlExecutable: true, ...metadata };

  const fakePath = structuredClone(report);
  fakePath.curl.path = "/tmp/not-the-recorded-curl";
  await assert.rejects(validateExternalClientEvidence(fakePath, expected), /curl.*path|executable/i);

  const fakeVersion = structuredClone(report);
  fakeVersion.curl.version = "curl 999 forged\n";
  await assert.rejects(validateExternalClientEvidence(fakeVersion, expected), /curl.*version/i);

  const changedTranscript = structuredClone(report);
  changedTranscript.transcript += "tampered";
  await assert.rejects(
    validateExternalClientEvidence(changedTranscript, expected),
    /transcript.*SHA|transcript.*changed/i,
  );
});

test("every HTTP and cancellation curl request explicitly disables inherited proxies", () => {
  const requestArguments = curlApi("requestArguments");
  const endpoint = "http://127.0.0.1:18181";
  const requestCases = [
    ["models", { endpoint, path: "/v1/models", method: "GET", timeoutSeconds: 30 }],
    ["non-stream", {
      endpoint,
      path: "/v1/chat/completions",
      method: "POST",
      body: { stream: false },
      timeoutSeconds: 30,
    }],
    ["streaming", {
      endpoint,
      path: "/v1/chat/completions",
      method: "POST",
      body: { stream: true },
      timeoutSeconds: 60,
      noBuffer: true,
    }],
    ["cancellation", {
      endpoint,
      path: "/v1/chat/completions",
      method: "POST",
      body: { stream: true },
      timeoutSeconds: 120,
      noBuffer: true,
    }],
  ];

  for (const [label, options] of requestCases) {
    const args = requestArguments(options);
    const noProxyIndexes = args.flatMap((value, index) => value === "--noproxy" ? [index] : []);
    assert.deepEqual(noProxyIndexes, [0], `${label} must set one authoritative --noproxy`);
    assert.equal(args[1], "*", `${label} must disable proxies for every host`);
  }
});

test("runs a discovered real curl through models, non-stream, SSE, and process cancellation", {
  timeout: 15_000,
}, async (t) => {
  const validateExternalClientEvidence = evidenceApi("validateExternalClientEvidence");
  const server = createFixtureServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise((resolvePromise) => server.close(resolvePromise));
  });
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;
  const directory = await mkdtemp(join(tmpdir(), "illama-curl-runner-"));
  const reportPath = join(directory, "external-client.json");
  t.after(() => rm(directory, { recursive: true, force: true }));

  let proxyRequests = 0;
  const proxyServer = createServer((_request, response) => {
    proxyRequests += 1;
    response.writeHead(502, { "content-type": "text/plain" });
    response.end("environment proxy must not receive loopback acceptance traffic");
  });
  await new Promise((resolvePromise, reject) => {
    proxyServer.once("error", reject);
    proxyServer.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => {
    proxyServer.closeAllConnections?.();
    return new Promise((resolvePromise) => proxyServer.close(resolvePromise));
  });
  const proxyEndpoint = `http://127.0.0.1:${proxyServer.address().port}`;
  const result = await runNodeCli([
    resolve("scripts/external-client-curl.mjs"),
    "--endpoint", endpoint,
    "--report", reportPath,
    "--head-sha", metadata.headSha,
    "--workflow-path", metadata.workflowPath,
    "--run-id", String(metadata.runId),
    "--run-attempt", String(metadata.runAttempt),
    "--repository", metadata.repository,
  ], {
    ...process.env,
    HTTP_PROXY: proxyEndpoint,
    HTTPS_PROXY: proxyEndpoint,
    ALL_PROXY: proxyEndpoint,
    http_proxy: proxyEndpoint,
    https_proxy: proxyEndpoint,
    all_proxy: proxyEndpoint,
    NO_PROXY: "",
    no_proxy: "",
  });
  assert.equal(result.code, 0, result.stderr);

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(proxyRequests, 0, "curl must not send any acceptance request to an environment proxy");
  assert.equal(report.status, "success");
  assert.equal(report.detectedModelId, "fixture-model");
  assert.equal(report.models.response.data[0].id, "fixture-model");
  assert.equal(report.nonStream.response.choices[0].message.content, "OK");
  assert.equal(report.streaming.done, true);
  assert.ok(report.streaming.events.length > 0);
  assert.ok(report.cancellation.childPid > 1);
  assert.equal(report.cancellation.signalSent, "SIGTERM");
  assert.equal(report.cancellation.killReturned, true);
  assert.equal(report.cancellation.exitSignal, "SIGTERM");
  assert.equal(report.cancellation.terminated, true);
  assert.match(report.transcriptSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  await assert.doesNotReject(validateExternalClientEvidence(report, {
    endpoint,
    verifyCurlExecutable: true,
    ...metadata,
  }));
});

test("curl timeout and response-limit termination wait for close and reap the child", {
  timeout: 15_000,
}, async (t) => {
  const runCurlProcess = curlApi("runCurlProcess");
  const curlPath = await discoveredCurlPath();
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url === "/large") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("x".repeat(16_384));
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolvePromise) => server.close(resolvePromise));
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;

  for (const [path, options, expected] of [
    ["/hang", { timeoutMs: 100, maxResponseBytes: 1024 }, /timed out/i],
    ["/large", { timeoutMs: 5_000, maxResponseBytes: 128 }, /response.*bound/i],
  ]) {
    let failure;
    try {
      await runCurlProcess(curlPath, ["--silent", `${endpoint}${path}`], options);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error);
    assert.match(failure.message, expected);
    assert.ok(failure.childPid > 1);
    assert.equal(failure.closed, true, "the promise must reject only after close");
    assert.equal(processIsAlive(failure.childPid), false, `curl PID ${failure.childPid} was not reaped`);
  }
});

test("creates run-bound signed RC provenance and detects stale or changed artifacts", async (t) => {
  const createPortableChecksum = (await import(new URL("../lib/portable-checksum.mjs", import.meta.url)))
    .createPortableChecksum;
  const createRcArtifactProvenance = evidenceApi("createRcArtifactProvenance");
  const validateRcArtifactProvenance = evidenceApi("validateRcArtifactProvenance");
  const directory = await mkdtemp(join(tmpdir(), "illama-rc-provenance-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dmgPath = join(directory, "iLlama_3.2.0_aarch64.dmg");
  const checksumPath = `${dmgPath}.sha256`;
  await writeFile(dmgPath, "signed-rc-dmg\n");
  await createPortableChecksum(dmgPath, checksumPath);
  const rcMetadata = {
    ...metadata,
    workflowPath: ".github/workflows/release.yml",
    runId: 4444,
    runAttempt: 3,
  };
  const provenance = await createRcArtifactProvenance({
    dmgPath,
    checksumPath,
    tag: "v3.2.0-rc.1",
    mode: "signed-release",
    ...rcMetadata,
  });
  await assert.doesNotReject(validateRcArtifactProvenance(provenance, {
    dmgPath,
    checksumPath,
    tag: "v3.2.0-rc.1",
    mode: "signed-release",
    ...rcMetadata,
  }));
  const provenancePath = join(directory, "rc-provenance.json");
  const common = [
    "--dmg", dmgPath,
    "--checksum", checksumPath,
    "--tag", "v3.2.0-rc.1",
    "--mode", "signed-release",
    "--head-sha", rcMetadata.headSha,
    "--workflow-path", rcMetadata.workflowPath,
    "--run-id", String(rcMetadata.runId),
    "--run-attempt", String(rcMetadata.runAttempt),
    "--repository", rcMetadata.repository,
  ];
  const createCli = spawnSync(process.execPath, [
    resolve("scripts/rc-artifact-provenance.mjs"),
    "create",
    "--output", provenancePath,
    ...common,
  ], { encoding: "utf8" });
  assert.equal(createCli.status, 0, createCli.stderr);
  const validateCli = spawnSync(process.execPath, [
    resolve("scripts/rc-artifact-provenance.mjs"),
    "validate",
    "--provenance", provenancePath,
    ...common,
  ], { encoding: "utf8" });
  assert.equal(validateCli.status, 0, validateCli.stderr);
  for (const [field, value] of [
    ["runId", 9999],
    ["runAttempt", 4],
    ["tag", "v3.2.0"],
    ["mode", "unsigned-artifact"],
  ]) {
    await assert.rejects(
      validateRcArtifactProvenance({ ...provenance, [field]: value }, {
        dmgPath,
        checksumPath,
        tag: "v3.2.0-rc.1",
        mode: "signed-release",
        ...rcMetadata,
      }),
      new RegExp(field, "i"),
    );
  }
  await writeFile(dmgPath, "stale-or-changed-dmg\n");
  await assert.rejects(
    validateRcArtifactProvenance(provenance, {
      dmgPath,
      checksumPath,
      tag: "v3.2.0-rc.1",
      mode: "signed-release",
      ...rcMetadata,
    }),
    /checksum|DMG/i,
  );
});

test("clean-Mac report embeds and hashes the complete executable curl report", async (t) => {
  const createCleanMacReport = evidenceApi("createCleanMacReport");
  const validateCleanMacReport = evidenceApi("validateCleanMacReport");
  const directory = await mkdtemp(join(tmpdir(), "illama-clean-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const nativeReportPath = join(directory, "native.json");
  const externalReportPath = join(directory, "external.json");
  const provenancePath = join(directory, "provenance.json");
  const gatekeeperStatusPath = join(directory, "spctl-status.txt");
  const externalClient = await validExternalClientReport();
  const nativeReport = validNativeExternalReport(
    "/tmp/clean-llama-server",
    "/tmp/clean-model.gguf",
    externalClient,
  );
  const provenance = {
    schemaVersion: 1,
    type: "signed-rc",
    status: "success",
    ...metadata,
    workflowPath: ".github/workflows/release.yml",
    tag: "v3.2.0-rc.1",
    mode: "signed-release",
    dmgName: "iLlama_3.2.0_aarch64.dmg",
    dmgSha256: "d".repeat(64),
    checksumName: "iLlama_3.2.0_aarch64.dmg.sha256",
    checksumSha256: "e".repeat(64),
    completedAt: new Date().toISOString(),
  };
  await writeFile(nativeReportPath, `${JSON.stringify(nativeReport)}\n`);
  await writeFile(externalReportPath, `${JSON.stringify(externalClient)}\n`);
  await writeFile(provenancePath, `${JSON.stringify(provenance)}\n`);
  await writeFile(gatekeeperStatusPath, "assessments enabled\n");
  const checkArtifacts = {};
  for (const name of cleanCheckNames) {
    const path = join(directory, `${name}.txt`);
    await writeFile(path, `${name} verified\n`);
    checkArtifacts[name] = path;
  }

  const clean = await createCleanMacReport({
    nativeReportPath,
    externalReportPath,
    rcProvenancePath: provenancePath,
    gatekeeperStatusPath,
    checkArtifacts,
    ...metadata,
  });
  assert.deepEqual(clean.externalClient, externalClient);
  assert.equal(clean.gatekeeper.status, "assessments enabled");
  assert.match(clean.externalClientSha256, /^[0-9a-f]{64}$/);
  await assert.doesNotReject(validateCleanMacReport(clean, metadata));
  const cleanPath = join(directory, "clean-report.json");
  const cleanCli = spawnSync(process.execPath, [
    resolve("scripts/create-clean-mac-report.mjs"),
    "--output", cleanPath,
    "--native-report", nativeReportPath,
    "--external-report", externalReportPath,
    "--rc-provenance", provenancePath,
    "--gatekeeper-status", gatekeeperStatusPath,
    ...Object.entries(checkArtifacts).flatMap(([name, path]) => ["--check", `${name}=${path}`]),
    "--head-sha", metadata.headSha,
    "--workflow-path", metadata.workflowPath,
    "--run-id", String(metadata.runId),
    "--run-attempt", String(metadata.runAttempt),
    "--repository", metadata.repository,
  ], { encoding: "utf8" });
  assert.equal(cleanCli.status, 0, cleanCli.stderr);
  assert.deepEqual(JSON.parse(await readFile(cleanPath, "utf8")).externalClient, externalClient);

  const configuredOnly = structuredClone(clean);
  delete configuredOnly.externalClient;
  await assert.rejects(validateCleanMacReport(configuredOnly, metadata), /external.*curl/i);
  const changed = structuredClone(clean);
  changed.externalClient.transcript += "changed";
  await assert.rejects(validateCleanMacReport(changed, metadata), /external.*SHA|curl.*SHA/i);

  const incompleteNative = structuredClone(clean);
  incompleteNative.nativeReport.steps = incompleteNative.nativeReport.steps.filter(
    (step) => step.name !== "scan-model-directory",
  );
  incompleteNative.nativeReportSha256 = sha256(JSON.stringify(incompleteNative.nativeReport));
  await assert.rejects(validateCleanMacReport(incompleteNative, metadata), /scan-model-directory/i);
});

test("clean-Mac manifest cross-checks linked reports, RC files, and every raw signature output", async (t) => {
  const createPortableChecksum = (await import(new URL("../lib/portable-checksum.mjs", import.meta.url)))
    .createPortableChecksum;
  const createRcArtifactProvenance = evidenceApi("createRcArtifactProvenance");
  const createCleanMacReport = evidenceApi("createCleanMacReport");
  const createReleaseEvidence = evidenceApi("createReleaseEvidence");
  const validateReleaseEvidence = evidenceApi("validateReleaseEvidence");
  const directory = await mkdtemp(join(tmpdir(), "illama-clean-manifest-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = join(directory, "llama-server");
  const modelPath = join(directory, "model.gguf");
  const dmgPath = join(directory, "iLlama_3.2.0_aarch64.dmg");
  const checksumPath = `${dmgPath}.sha256`;
  const nativePath = join(directory, "native.json");
  const externalPath = join(directory, "external.json");
  const provenancePath = join(directory, "rc-provenance.json");
  const gatekeeperStatusPath = join(directory, "spctl-status.txt");
  const cleanPath = join(directory, "clean-report.json");
  await writeFile(binaryPath, "binary\n", { mode: 0o755 });
  await writeFile(modelPath, "model\n");
  await writeFile(dmgPath, "signed-rc\n");
  await createPortableChecksum(dmgPath, checksumPath);
  const external = await validExternalClientReport();
  const native = validNativeExternalReport(binaryPath, modelPath, external);
  await writeFile(nativePath, `${JSON.stringify(native)}\n`);
  await writeFile(externalPath, `${JSON.stringify(external)}\n`);
  const provenance = await createRcArtifactProvenance({
    dmgPath,
    checksumPath,
    tag: "v3.2.0-rc.1",
    mode: "signed-release",
    ...metadata,
    workflowPath: ".github/workflows/release.yml",
    runId: 9876,
    runAttempt: 4,
  });
  await writeFile(provenancePath, `${JSON.stringify(provenance)}\n`);
  await writeFile(gatekeeperStatusPath, "assessments enabled\n");
  const checkArtifacts = {};
  for (const name of cleanCheckNames) {
    const path = join(directory, `${name}.txt`);
    await writeFile(path, `${name} verified\n`);
    checkArtifacts[name] = path;
  }
  const clean = await createCleanMacReport({
    nativeReportPath: nativePath,
    externalReportPath: externalPath,
    rcProvenancePath: provenancePath,
    gatekeeperStatusPath,
    checkArtifacts,
    ...metadata,
  });
  await writeFile(cleanPath, `${JSON.stringify(clean)}\n`);
  const artifacts = {
    binary: binaryPath,
    curl: external.curl.path,
    externalReport: externalPath,
    gatekeeperStatus: gatekeeperStatusPath,
    model: modelPath,
    nativeReport: nativePath,
    rcDmg: dmgPath,
    rcChecksum: checksumPath,
    rcProvenance: provenancePath,
    ...checkArtifacts,
  };
  const manifest = await createReleaseEvidence({
    type: "clean-mac",
    reportPath: cleanPath,
    artifacts,
    ...metadata,
  });
  await assert.doesNotReject(validateReleaseEvidence(manifest, {
    type: "clean-mac",
    reportPath: cleanPath,
    artifacts,
    ...metadata,
  }));

  const changedSignature = structuredClone(manifest);
  changedSignature.checksums.codesignVerify = "f".repeat(64);
  await assert.rejects(
    validateReleaseEvidence(changedSignature, {
      type: "clean-mac",
      reportPath: cleanPath,
      ...metadata,
    }),
    /codesignVerify|signature|check/i,
  );

  await writeFile(externalPath, `${JSON.stringify({ ...external, detectedModelId: "detached" })}\n`);
  await assert.rejects(
    validateReleaseEvidence(manifest, {
      type: "clean-mac",
      reportPath: cleanPath,
      artifacts,
      ...metadata,
    }),
    /external|checksum|linked/i,
  );
  await writeFile(externalPath, `${JSON.stringify(external)}\n`);
  await writeFile(dmgPath, "tampered-rc\n");
  await assert.rejects(
    validateReleaseEvidence(manifest, {
      type: "clean-mac",
      reportPath: cleanPath,
      artifacts,
      ...metadata,
    }),
    /DMG|checksum/i,
  );
});

test("workflows prohibit secret JSON and require ephemeral mounted-app curl evidence with exact run binding", () => {
  const acceptance = readText(".github/workflows/release-acceptance.yml");
  const release = readText(".github/workflows/release.yml");
  const releaseMacos = readText("scripts/release-macos.mjs");
  const verifier = readText("scripts/verify-release-workflow.mjs");

  assert.doesNotMatch(acceptance, /EXTERNAL_CLIENT_RESULT(?:_JSON)?/);
  assert.doesNotMatch(acceptance, /gh release download v3\.2\.0-rc\.1/);
  assert.doesNotMatch(acceptance, /\$\{[^}\n]+,,\}/);
  assert.doesNotMatch(release, /\$\{[^}\n]+,,\}/);
  assert.match(acceptance, /ACCEPTED_RC_SHA256" =~ \^\[0-9a-f\]\{64\}\$/);
  assert.match(release, /ACCEPTED_RC_SHA256" =~ \^\[0-9a-f\]\{64\}\$/);
  assert.match(acceptance, /runs-on:\s*macos-15/);
  assert.match(acceptance, /\[\[ "\$\(uname -m\)" == "arm64" \]\]/);
  for (const pattern of [
    /hdiutil attach/,
    /-readonly/,
    /-nobrowse/,
    /codesign --verify --deep --strict --verbose=2/,
    /TeamIdentifier/,
    /flags=.*runtime/,
    /stapler validate/,
    /spctl --assess --type execute/,
    /spctl --status/,
    /assessments enabled/,
    /native-tauri-acceptance\.mjs/,
    /external-client-curl\.mjs/,
    /create-clean-mac-report\.mjs/,
    /--launch-via-open/,
    /hdiutil detach/,
    /if:\s*always\(\)/,
    /GITHUB_RUN_ID/,
    /GITHUB_RUN_ATTEMPT/,
    /GITHUB_REPOSITORY/,
    /gh run download "\$RC_RELEASE_RUN_ID"/,
    /signed-rc-\$\{TAGGED_SHA\}-\$\{RC_RELEASE_RUN_ID\}-\$\{RC_RUN_ATTEMPT\}/,
  ]) assert.match(acceptance, pattern);
  assert.match(acceptance, /select\(\."mount-point" == \$mount\)/);
  assert.match(acceptance, /ATTACH_PLIST=.*hdiutil-attach\.plist/);
  for (const name of cleanCheckNames) {
    assert.match(acceptance, new RegExp(name));
    assert.match(release, new RegExp(name));
    assert.match(verifier, new RegExp(name));
  }

  assert.match(release, /rc_release_run_id/);
  assert.doesNotMatch(release, /verify_run\(\)/);
  assert.doesNotMatch(release, /attempt="\$\(verify_run/);
  assert.match(release, /validate-workflow-run\.mjs/);
  assert.match(acceptance, /validate-workflow-run\.mjs/);
  assert.match(release, /rc-artifact-provenance\.mjs/);
  assert.match(release, /signed-rc-\$\{\{ env\.TAGGED_SHA \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(release, /workflow_dispatch/);
  assert.match(release, /validate-release-evidence\.mjs/);
  assert.match(release, /--workflow-path/);
  assert.match(release, /--run-id/);
  assert.match(release, /--run-attempt/);
  assert.match(release, /--repository/);
  assert.match(release, /--report/);
  assert.match(release, /portable-checksum\.mjs verify/);
  assert.doesNotMatch(release, /--artifact "curl=\/usr\/bin\/curl"/);
  assert.match(releaseMacos, /portable-checksum\.mjs["'],\s*["']create/);
  assert.match(verifier, /release-acceptance\.yml/);
  assert.match(verifier, /EXTERNAL_CLIENT_RESULT/);
  assert.match(verifier, /spctl --status/);
  const verifierResult = spawnSync(
    process.execPath,
    [resolve("scripts/verify-release-workflow.mjs")],
    { encoding: "utf8" },
  );
  assert.equal(verifierResult.status, 0, verifierResult.stderr);
});

test("protected release jobs require the dispatch ref to equal the selected tag", () => {
  const workflows = [
    readText(".github/workflows/release.yml"),
    readText(".github/workflows/release-acceptance.yml"),
  ];
  const exactRef = /github\.ref == format\('refs\/tags\/\{0\}', inputs\.tag\)/;

  for (const workflow of workflows) {
    assert.match(workflow, /^[ ]{2}validate-dispatch-ref:\n/m);
    assert.match(workflow, /\[\[ "\$ACTUAL_REF" == "\$EXPECTED_REF" \]\]/);
    for (const [name, block] of workflowJobBlocks(workflow)) {
      if (!/environment:\s*macos-release/.test(block)) continue;
      assert.match(block, exactRef, `${name} must reject a branch-selected dispatch`);
      assert.match(block, /needs:\s*(?:\[[^\]]*\bvalidate-dispatch-ref\b[^\]]*\]|validate-dispatch-ref)/);
    }
  }

  const releaseWorkflow = workflows[0];
  assert.match(releaseWorkflow, /--head-branch "\$expected_head_branch"/);
  assert.match(
    releaseWorkflow,
    /validate_run "\$CI_RUN_ID" "\.github\/workflows\/ci\.yml" push "\$RELEASE_TAG"/,
  );
  assert.match(
    releaseWorkflow,
    /"\$RC_RELEASE_RUN_ID" "\.github\/workflows\/release\.yml" workflow_dispatch v3\.2\.0-rc\.1/,
  );

  const releaseDocs = [
    readText("docs/release-strategy.md"),
    readText("docs/release-checklist.md"),
  ].join("\n");
  assert.match(releaseDocs, /Use workflow from[^\n]*corresponding tag/i);
  assert.match(releaseDocs, /gh workflow run[^\n]*--ref <tag> -f tag=<tag>/);
  assert.match(releaseDocs, /head_branch[^\n]*selected tag/i);
  assert.match(releaseDocs, /main[^\n]*same SHA[^\n]*(?:not|cannot|invalid)/i);
});

test("signed packaging staples the verified app before creating and notarizing the DMG", async (t) => {
  const moduleUrl = new URL("../lib/macos-release-chain.mjs", import.meta.url);
  const releaseChain = await import(moduleUrl).catch((loadError) => ({ loadError }));
  assert.ifError(releaseChain.loadError);
  assert.equal(typeof releaseChain.packageSignedMacRelease, "function");
  const directory = await realpath(await mkdtemp(join(tmpdir(), "illama-signed-chain-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const appPath = join(directory, "iLlama.app");
  const dmgPath = join(directory, "iLlama_3.2.0_aarch64.dmg");
  await mkdir(appPath);
  const identity = "Developer ID Application: Example Developer (TEAM123456)";
  const commands = [];
  const run = (command, args) => {
    commands.push([command, ...args]);
    if (command === "hdiutil" && args[0] === "create") {
      writeFileSync(args.at(-1), "fake signed DMG\n");
    }
  };
  const capture = (command, args) => {
    commands.push([command, ...args]);
    return {
      ok: true,
      status: 0,
      output: [
        `Authority=${identity}`,
        "TeamIdentifier=TEAM123456",
        "flags=0x10000(runtime)",
      ].join("\n"),
    };
  };

  releaseChain.packageSignedMacRelease({
    appPath,
    dmgPath,
    signingIdentity: identity,
    teamId: "TEAM123456",
    notaryProfile: "illama-ci",
    volumeName: "iLlama",
    dmgIdentifier: "com.illama.mac.dmg",
    run,
    capture,
  });

  const commandText = commands.map((command) => command.join(" "));
  const firstIndex = (pattern) => {
    const index = commandText.findIndex((command) => pattern.test(command));
    assert.notEqual(index, -1, `missing command matching ${pattern}`);
    return index;
  };
  const lastIndex = (pattern) => {
    const index = commandText.findLastIndex((command) => pattern.test(command));
    assert.notEqual(index, -1, `missing command matching ${pattern}`);
    return index;
  };
  const appZip = firstIndex(/ditto -c -k --keepParent .*iLlama\.app .*iLlama\.zip$/);
  const appNotary = firstIndex(/xcrun notarytool submit .*iLlama\.zip .*--wait/);
  const appStaple = firstIndex(/xcrun stapler staple .*iLlama\.app$/);
  const appValidate = firstIndex(/xcrun stapler validate .*iLlama\.app$/);
  const dmgCreate = firstIndex(/hdiutil create .* -srcfolder .* -format UDZO .*\.dmg$/);
  const dmgSign = firstIndex(/codesign --force --timestamp --sign .* --identifier com\.illama\.mac\.dmg .*\.dmg$/);
  const dmgNotary = firstIndex(/xcrun notarytool submit .*\.dmg .*--wait/);
  const dmgStaple = firstIndex(/xcrun stapler staple .*\.dmg$/);
  const dmgValidate = firstIndex(/xcrun stapler validate .*\.dmg$/);
  assert.ok(appZip < appNotary);
  assert.ok(appNotary < appStaple);
  assert.ok(appStaple < appValidate);
  assert.ok(lastIndex(/xcrun stapler validate .*iLlama\.app$/) < dmgCreate);
  assert.ok(dmgCreate < dmgSign);
  assert.ok(dmgSign < dmgNotary);
  assert.ok(dmgNotary < dmgStaple);
  assert.ok(dmgStaple < dmgValidate);
  assert.ok(lastIndex(/codesign --display --verbose=4 .*iLlama\.app$/) < dmgCreate);
  assert.match(readText("scripts/release-macos.mjs"), /"--bundles",\s*"app"/);

  for (const [label, details] of [
    ["Developer ID authority", "TeamIdentifier=TEAM123456\nflags=0x10000(runtime)"],
    ["TeamIdentifier", `Authority=${identity}\nflags=0x10000(runtime)`],
    ["hardened runtime", `Authority=${identity}\nTeamIdentifier=TEAM123456`],
  ]) {
    assert.throws(
      () => releaseChain.packageSignedMacRelease({
        appPath,
        dmgPath,
        signingIdentity: identity,
        teamId: "TEAM123456",
        notaryProfile: "illama-ci",
        volumeName: "iLlama",
        dmgIdentifier: "com.illama.mac.dmg",
        run: () => {},
        capture: () => ({ ok: true, status: 0, output: details }),
      }),
      new RegExp(label, "i"),
    );
  }
});

async function validExternalClientReport() {
  const curlPath = await discoveredCurlPath();
  await access(curlPath, fsConstants.X_OK);
  const version = spawnSync(curlPath, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  const transcript = "models:fixture-model\nnon-stream:OK\nstream:Hello\ncancel:SIGTERM\n";
  return {
    schemaVersion: 1,
    kind: "external-client-curl",
    status: "success",
    ...metadata,
    endpoint: "http://127.0.0.1:18181",
    curl: {
      path: curlPath,
      sha256: sha256(await readFile(curlPath)),
      version: version.stdout,
    },
    models: {
      response: { object: "list", data: [{ id: "fixture-model" }] },
      modelIds: ["fixture-model"],
    },
    detectedModelId: "fixture-model",
    nonStream: {
      response: { choices: [{ message: { content: "OK" } }] },
      content: "OK",
    },
    streaming: {
      events: [
        { choices: [{ delta: { content: "Hel" } }] },
        { choices: [{ delta: { content: "lo" } }] },
      ],
      content: "Hello",
      done: true,
      sequence: [
        { type: "event", eventIndex: 0 },
        { type: "event", eventIndex: 1 },
        { type: "done" },
      ],
    },
    cancellation: {
      childPid: 4321,
      streamStarted: true,
      signalSent: "SIGTERM",
      killReturned: true,
      exitCode: null,
      exitSignal: "SIGTERM",
      terminated: true,
    },
    transcript,
    transcriptSha256: sha256(transcript),
    completedAt: new Date().toISOString(),
  };
}

async function discoveredCurlPath() {
  const which = spawnSync("/usr/bin/which", ["curl"], { encoding: "utf8" });
  assert.equal(which.status, 0, "curl is required for the focused release-evidence tests");
  return await realpath(which.stdout.trim());
}

function matrixReport(binaryPath, modelPath, binaryContents, modelContents) {
  const args = [
    "--model", modelPath,
    "--host", "127.0.0.1",
    "--port", "18181",
  ];
  return {
    schemaVersion: 1,
    kind: "native-tauri-gguf-matrix",
    status: "success",
    gitSha: metadata.headSha,
    entries: [{
      status: "success",
      appVersion: "3.2.0",
      gitSha: metadata.headSha,
      binaryPath,
      binaryVersion: "llama-server fixture",
      binarySha256: sha256(binaryContents),
      modelPath,
      modelSha256: sha256(modelContents),
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
      artifacts: {
        binarySha256: sha256(binaryContents),
        modelSha256: sha256(modelContents),
      },
      scan: {
        configuredModel: { path: modelPath, available: true, metadataStatus: "ready" },
      },
      commandSpec: { executable: binaryPath, args },
      activeSnapshot: {
        pid: 4321,
        activeLaunch: {
          binaryPath,
          modelPath,
          port: 18181,
          commandArgs: args,
        },
      },
      modelId: "fixture-model",
      chat: { content: "OK" },
      cancellation: {
        abortControllerAborted: true,
        abortErrorObserved: true,
        streamStarted: true,
      },
      recovery: { recoveryAction: "changePort", exercised: true },
      stop: { pid: null, activeLaunch: null, portReachable: false },
    }],
  };
}

function validNativeExternalReport(binaryPath, modelPath, external) {
  const port = Number(new URL(external.endpoint).port);
  const args = [
    "--model", modelPath,
    "--host", "127.0.0.1",
    "--port", String(port),
  ];
  return {
    schemaVersion: 1,
    kind: "native-tauri",
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
      configuredModel: { path: modelPath, available: true, metadataStatus: "ready" },
    },
    commandSpec: { executable: binaryPath, args },
    activeLaunch: { binaryPath, modelPath, port, commandArgs: args },
    modelId: external.detectedModelId,
    chat: { content: "OK" },
    cancellation: {
      abortControllerAborted: true,
      abortErrorObserved: true,
      streamStarted: true,
    },
    recovery: { recoveryAction: "changePort", exercised: true },
    stop: { pid: null, activeLaunch: null, portReachable: false },
    artifacts: {
      binarySha256: sha256("binary\n"),
      modelSha256: sha256("model\n"),
    },
    externalClient: {
      report: external,
      reportSha256: sha256(JSON.stringify(external)),
    },
  };
}

function createFixtureServer() {
  let streamingRequest = 0;
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "fixture-model" }] }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.stream !== true) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "OK" } }],
      }));
      return;
    }

    streamingRequest += 1;
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`);
    if (streamingRequest === 1) {
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }
    const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 50);
    const stopKeepAlive = () => clearInterval(keepAlive);
    request.once("close", stopKeepAlive);
    response.once("close", stopKeepAlive);
  });
}

function readText(path) {
  return readFileSync(resolve(path), "utf8");
}

function workflowJobBlocks(source) {
  const matches = [...source.matchAll(/^[ ]{2}([a-zA-Z0-9_-]+):\n/g)];
  return matches.map((match, index) => [
    match[1],
    source.slice(match.index, matches[index + 1]?.index ?? source.length),
  ]);
}

async function runNodeCli(args, env) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
