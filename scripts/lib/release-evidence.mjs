import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { sha256File, verifyPortableChecksum } from "./portable-checksum.mjs";

export const RELEASE_EVIDENCE_SCHEMA_VERSION = 1;
export const RELEASE_ACCEPTANCE_WORKFLOW = ".github/workflows/release-acceptance.yml";
export const RELEASE_EVIDENCE_TYPES = Object.freeze([
  "llama-matrix",
  "external-client",
  "clean-mac",
]);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_PATTERN = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const MANIFEST_FIELDS = new Set([
  "schemaVersion",
  "type",
  "status",
  "headSha",
  "workflowPath",
  "runId",
  "runAttempt",
  "repository",
  "reportName",
  "reportSha256",
  "checksums",
  "completedAt",
]);
const EXTERNAL_REPORT_FIELDS = new Set([
  "schemaVersion",
  "kind",
  "status",
  "headSha",
  "workflowPath",
  "runId",
  "runAttempt",
  "repository",
  "endpoint",
  "curl",
  "models",
  "detectedModelId",
  "nonStream",
  "streaming",
  "cancellation",
  "transcript",
  "transcriptSha256",
  "completedAt",
]);
const STREAMING_EVIDENCE_FIELDS = new Set(["events", "content", "done", "sequence"]);
const SSE_EVENT_SEQUENCE_FIELDS = new Set(["type", "eventIndex"]);
const SSE_DONE_SEQUENCE_FIELDS = new Set(["type"]);
const RC_PROVENANCE_FIELDS = new Set([
  "schemaVersion",
  "type",
  "status",
  "headSha",
  "workflowPath",
  "runId",
  "runAttempt",
  "repository",
  "tag",
  "mode",
  "dmgName",
  "dmgSha256",
  "checksumName",
  "checksumSha256",
  "completedAt",
]);
const CLEAN_REPORT_FIELDS = new Set([
  "schemaVersion",
  "kind",
  "status",
  "headSha",
  "workflowPath",
  "runId",
  "runAttempt",
  "repository",
  "nativeReport",
  "nativeReportSha256",
  "externalClient",
  "externalClientSha256",
  "rcProvenance",
  "rcProvenanceSha256",
  "gatekeeper",
  "checks",
  "binding",
  "completedAt",
]);
const CLEAN_CHECK_NAMES = Object.freeze([
  "codesignDetails",
  "codesignVerify",
  "hdiutilAttach",
  "spctlApp",
  "spctlDmg",
  "staplerApp",
  "staplerDmg",
]);

export async function createRcArtifactProvenance(options = {}) {
  const expected = normalizeRcOptions(options);
  const portable = await verifyPortableChecksum(expected.checksumPath);
  const actualDmgPath = await realpath(expected.dmgPath);
  if (portable.artifactPath !== actualDmgPath) {
    throw new Error("portable checksum does not reference the supplied RC DMG");
  }
  return {
    schemaVersion: 1,
    type: "signed-rc",
    status: "success",
    headSha: expected.headSha,
    workflowPath: expected.workflowPath,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    repository: expected.repository,
    tag: expected.tag,
    mode: expected.mode,
    dmgName: basename(actualDmgPath),
    dmgSha256: portable.digest,
    checksumName: basename(expected.checksumPath),
    checksumSha256: await sha256File(expected.checksumPath),
    completedAt: new Date().toISOString(),
  };
}

export async function validateRcArtifactProvenance(provenance, options = {}) {
  assertRecord(provenance, "signed RC provenance");
  rejectUnknownFields(provenance, RC_PROVENANCE_FIELDS, "signed RC provenance");
  const expected = normalizeRcOptions(options);
  validateEmbeddedRcProvenance(provenance, expected);
  const portable = await verifyPortableChecksum(expected.checksumPath);
  const actualDmgPath = await realpath(expected.dmgPath);
  if (portable.artifactPath !== actualDmgPath) {
    throw new Error("portable checksum does not reference the supplied RC DMG");
  }
  if (provenance.dmgName !== basename(actualDmgPath)) throw new Error("RC DMG name mismatch");
  if (provenance.dmgSha256 !== portable.digest) throw new Error("RC DMG checksum mismatch");
  if (provenance.checksumName !== basename(expected.checksumPath)) {
    throw new Error("RC checksum filename mismatch");
  }
  if (provenance.checksumSha256 !== await sha256File(expected.checksumPath)) {
    throw new Error("RC checksum file hash mismatch");
  }
  return provenance;
}

export async function createCleanMacReport(options = {}) {
  const metadata = normalizeRunMetadata(options);
  const nativeReport = await readJsonFile(options.nativeReportPath, "native report");
  const externalClient = await readJsonFile(options.externalReportPath, "external curl report");
  const rcProvenance = await readJsonFile(options.rcProvenancePath, "RC provenance");
  const gatekeeperRaw = await readFile(options.gatekeeperStatusPath, "utf8");
  if (gatekeeperRaw.trim() !== "assessments enabled") {
    throw new Error("Gatekeeper assessments must be enabled on the clean Mac");
  }
  validateNativeExternalReport(nativeReport, externalClient);
  await validateExternalClientEvidence(externalClient, metadata);
  validateEmbeddedRcProvenance(rcProvenance, {
    headSha: metadata.headSha,
    repository: metadata.repository,
    workflowPath: ".github/workflows/release.yml",
    tag: "v3.2.0-rc.1",
    mode: "signed-release",
  });
  const report = {
    schemaVersion: 1,
    kind: "clean-mac-native-tauri",
    status: "success",
    ...metadata,
    nativeReport,
    nativeReportSha256: sha256Canonical(nativeReport),
    externalClient,
    externalClientSha256: sha256Canonical(externalClient),
    rcProvenance,
    rcProvenanceSha256: sha256Canonical(rcProvenance),
    gatekeeper: {
      status: "assessments enabled",
      rawSha256: sha256Text(gatekeeperRaw),
    },
    checks: await hashExactArtifacts(
      options.checkArtifacts,
      CLEAN_CHECK_NAMES,
      "clean-Mac raw verification outputs",
    ),
    binding: nativeBinding(nativeReport, externalClient),
    completedAt: new Date().toISOString(),
  };
  await validateCleanMacReport(report, metadata);
  return report;
}

export async function validateCleanMacReport(report, expected = {}) {
  assertRecord(report, "clean-Mac report");
  rejectUnknownFields(report, CLEAN_REPORT_FIELDS, "clean-Mac report");
  if (report.schemaVersion !== 1) throw new Error("clean-Mac schemaVersion must be 1");
  if (report.kind !== "clean-mac-native-tauri") {
    throw new Error("clean-Mac report kind must be clean-mac-native-tauri");
  }
  if (report.status !== "success") throw new Error("clean-Mac report status is not success");
  const metadata = normalizeRunMetadata({
    headSha: expected.headSha ?? report.headSha,
    workflowPath: expected.workflowPath ?? report.workflowPath,
    runId: expected.runId ?? report.runId,
    runAttempt: expected.runAttempt ?? report.runAttempt,
    repository: expected.repository ?? report.repository,
  });
  for (const field of ["headSha", "workflowPath", "runId", "runAttempt", "repository"]) {
    if (report[field] !== metadata[field]) throw new Error(`clean-Mac ${field} mismatch`);
  }
  assertRecord(report.nativeReport, "clean-Mac native report");
  assertRecord(report.externalClient, "clean-Mac external curl report");
  assertRecord(report.rcProvenance, "clean-Mac RC provenance");
  if (report.nativeReportSha256 !== sha256Canonical(report.nativeReport)) {
    throw new Error("clean-Mac native report SHA-256 mismatch");
  }
  if (report.externalClientSha256 !== sha256Canonical(report.externalClient)) {
    throw new Error("clean-Mac external curl report SHA-256 mismatch");
  }
  if (report.rcProvenanceSha256 !== sha256Canonical(report.rcProvenance)) {
    throw new Error("clean-Mac RC provenance SHA-256 mismatch");
  }
  validateNativeExternalReport(report.nativeReport, report.externalClient);
  await validateExternalClientEvidence(report.externalClient, metadata);
  validateEmbeddedRcProvenance(report.rcProvenance, {
    headSha: metadata.headSha,
    repository: metadata.repository,
    workflowPath: ".github/workflows/release.yml",
    tag: "v3.2.0-rc.1",
    mode: "signed-release",
  });
  assertRecord(report.gatekeeper, "clean-Mac Gatekeeper evidence");
  if (report.gatekeeper.status !== "assessments enabled") {
    throw new Error("clean-Mac Gatekeeper assessments were not enabled");
  }
  requireSha256(report.gatekeeper.rawSha256, "Gatekeeper status output SHA-256");
  validateExactChecks(report.checks, CLEAN_CHECK_NAMES, "clean-Mac raw verification outputs");
  const expectedBinding = nativeBinding(report.nativeReport, report.externalClient);
  if (JSON.stringify(report.binding) !== JSON.stringify(expectedBinding)) {
    throw new Error("clean-Mac native/curl endpoint or model binding mismatch");
  }
  if (!validTimestamp(report.completedAt)) throw new Error("completedAt is missing or invalid");
  return report;
}

export async function createReleaseEvidence(options) {
  const normalized = normalizeEvidenceOptions(options);
  const sourceReport = await validateSourceReport(
    normalized.type,
    normalized.reportPath,
    normalized,
  );
  const checksums = await hashArtifacts(normalized.artifacts);
  requireRelevantArtifacts(normalized.type, checksums);
  await crossCheckReportChecksums(
    normalized.type,
    sourceReport,
    checksums,
    normalized.artifacts,
  );
  return {
    schemaVersion: RELEASE_EVIDENCE_SCHEMA_VERSION,
    type: normalized.type,
    status: "success",
    headSha: normalized.headSha,
    workflowPath: normalized.workflowPath,
    runId: normalized.runId,
    runAttempt: normalized.runAttempt,
    repository: normalized.repository,
    reportName: basename(normalized.reportPath),
    reportSha256: await sha256File(normalized.reportPath),
    checksums,
    completedAt: new Date().toISOString(),
  };
}

export async function validateReleaseEvidence(manifest, expected) {
  assertRecord(manifest, "release evidence manifest");
  rejectUnknownFields(manifest, MANIFEST_FIELDS, "release evidence manifest");
  const normalized = normalizeEvidenceOptions(expected);
  if (manifest.schemaVersion !== RELEASE_EVIDENCE_SCHEMA_VERSION) {
    throw new Error("release evidence schemaVersion must be 1");
  }
  for (const field of [
    "type",
    "headSha",
    "workflowPath",
    "runId",
    "runAttempt",
    "repository",
  ]) {
    if (manifest[field] !== normalized[field]) {
      const label = field === "headSha" ? "tagged SHA" : field;
      throw new Error(`${label} mismatch in release evidence`);
    }
  }
  if (manifest.status !== "success") throw new Error("status is not success");
  if (!validTimestamp(manifest.completedAt)) throw new Error("completedAt is missing or invalid");
  if (manifest.reportName !== basename(normalized.reportPath)) {
    throw new Error("reportName does not match the source report basename");
  }
  requireSha256(manifest.reportSha256, "report SHA-256");
  const actualReportSha256 = await sha256File(normalized.reportPath);
  if (manifest.reportSha256 !== actualReportSha256) {
    throw new Error("source report SHA-256 changed after evidence creation");
  }
  const sourceReport = await validateSourceReport(
    normalized.type,
    normalized.reportPath,
    normalized,
  );

  assertRecord(manifest.checksums, "checksums");
  requireRelevantArtifacts(normalized.type, manifest.checksums);
  for (const [name, digest] of Object.entries(manifest.checksums)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
      throw new Error(`invalid artifact checksum name: ${name}`);
    }
    requireSha256(digest, `${name} checksum`);
  }
  await crossCheckReportChecksums(
    normalized.type,
    sourceReport,
    manifest.checksums,
    normalized.artifacts,
  );

  const locallyRecomputed = await hashArtifacts(normalized.artifacts);
  for (const [name, digest] of Object.entries(locallyRecomputed)) {
    if (!Object.hasOwn(manifest.checksums, name)) {
      throw new Error(`release evidence is missing locally supplied ${name} checksum`);
    }
    if (manifest.checksums[name] !== digest) {
      throw new Error(`${name} checksum changed after evidence creation`);
    }
  }
  return manifest;
}

export async function validateExternalClientEvidence(report, expected = {}) {
  assertRecord(report, "external-client evidence");
  rejectUnknownFields(report, EXTERNAL_REPORT_FIELDS, "external-client evidence");
  if (report.schemaVersion !== 1) throw new Error("external-client schemaVersion must be 1");
  if (report.kind !== "external-client-curl") {
    throw new Error("external-client kind must be external-client-curl");
  }
  if (report.status !== "success") throw new Error("external-client status is not success");
  const normalizedMetadata = normalizeRunMetadata({
    headSha: expected.headSha ?? report.headSha,
    workflowPath: expected.workflowPath ?? report.workflowPath,
    runId: expected.runId ?? report.runId,
    runAttempt: expected.runAttempt ?? report.runAttempt,
    repository: expected.repository ?? report.repository,
  });
  for (const field of ["headSha", "workflowPath", "runId", "runAttempt", "repository"]) {
    if (report[field] !== normalizedMetadata[field]) {
      const label = field === "headSha" ? "tagged SHA" : field;
      throw new Error(`external-client ${label} mismatch`);
    }
  }

  const endpoint = normalizeEndpoint(report.endpoint);
  if (expected.endpoint !== undefined && endpoint !== normalizeEndpoint(expected.endpoint)) {
    throw new Error("external-client endpoint mismatch");
  }
  validateCurlRecord(report.curl);

  assertRecord(report.models, "models evidence");
  assertRecord(report.models.response, "models response");
  if (!Array.isArray(report.models.response.data) || report.models.response.data.length === 0) {
    throw new Error("models response has no model records");
  }
  const modelIds = report.models.response.data
    .map((entry) => entry?.id)
    .filter((id) => typeof id === "string" && id.length > 0);
  if (modelIds.length === 0 || !sameArray(report.models.modelIds, modelIds)) {
    throw new Error("models evidence does not preserve the detected model IDs");
  }
  if (typeof report.detectedModelId !== "string" || !modelIds.includes(report.detectedModelId)) {
    throw new Error("detected model ID is missing from the models response");
  }

  assertRecord(report.nonStream, "non-stream evidence");
  const nonStreamContent = report.nonStream.response?.choices?.[0]?.message?.content;
  if (
    typeof nonStreamContent !== "string" ||
    !nonStreamContent.trim() ||
    report.nonStream.content !== nonStreamContent
  ) {
    throw new Error("non-stream chat evidence is missing or inconsistent");
  }

  validateStreamingEvidence(report.streaming);

  assertRecord(report.cancellation, "cancellation evidence");
  if (
    !Number.isInteger(report.cancellation.childPid) ||
    report.cancellation.childPid <= 1 ||
    report.cancellation.streamStarted !== true ||
    report.cancellation.signalSent !== "SIGTERM" ||
    report.cancellation.killReturned !== true ||
    report.cancellation.exitCode !== null ||
    report.cancellation.exitSignal !== "SIGTERM" ||
    report.cancellation.terminated !== true
  ) {
    throw new Error(
      "cancellation evidence must prove a spawned curl process terminated from SIGTERM",
    );
  }

  if (typeof report.transcript !== "string" || report.transcript.length === 0) {
    throw new Error("bounded external-client transcript is missing");
  }
  if (Buffer.byteLength(report.transcript, "utf8") > 65_536) {
    throw new Error("external-client transcript exceeds the 64 KiB bound");
  }
  requireSha256(report.transcriptSha256, "transcript SHA-256");
  const actualTranscriptSha256 = sha256Text(report.transcript);
  if (report.transcriptSha256 !== actualTranscriptSha256) {
    throw new Error("transcript SHA-256 changed after collection");
  }
  if (!validTimestamp(report.completedAt)) throw new Error("completedAt is missing or invalid");

  if (expected.verifyCurlExecutable === true) {
    await verifyRecordedCurl(report.curl);
  }
  return report;
}

export function normalizeRunMetadata(metadata) {
  assertRecord(metadata, "workflow run metadata");
  const headSha = requireString(metadata.headSha, "headSha").toLowerCase();
  if (!HEAD_SHA_PATTERN.test(headSha)) throw new Error("headSha must be an exact 40-hex SHA");
  const workflowPath = requireString(metadata.workflowPath, "workflowPath");
  if (!WORKFLOW_PATTERN.test(workflowPath)) {
    throw new Error("workflowPath must name a repository workflow YAML file");
  }
  const repository = requireString(metadata.repository, "repository");
  if (!REPOSITORY_PATTERN.test(repository)) throw new Error("repository must be owner/name");
  const runId = positiveInteger(metadata.runId, "runId");
  const runAttempt = positiveInteger(metadata.runAttempt, "runAttempt");
  return { headSha, workflowPath, runId, runAttempt, repository };
}

export function validateWorkflowRunMetadata(run, expected = {}) {
  assertRecord(run, "GitHub workflow run metadata");
  assertRecord(run.repository, "GitHub workflow run repository");
  const runId = positiveInteger(expected.runId, "expected runId");
  const headSha = requireString(expected.headSha, "expected headSha").toLowerCase();
  const workflowPath = requireString(expected.workflowPath, "expected workflowPath");
  const repository = requireString(expected.repository, "expected repository");
  const headBranch = requireString(expected.headBranch, "expected head branch");
  if (!HEAD_SHA_PATTERN.test(headSha)) {
    throw new Error("expected headSha must be an exact 40-hex SHA");
  }
  if (!WORKFLOW_PATTERN.test(workflowPath)) {
    throw new Error("expected workflow path must name a repository workflow YAML file");
  }
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("expected repository must be owner/name");
  }
  if (run.id !== runId) throw new Error("GitHub workflow run ID mismatch");
  if (run.status !== "completed") throw new Error("GitHub workflow run status is not completed");
  if (run.conclusion !== "success") {
    throw new Error("GitHub workflow run conclusion is not success");
  }
  if (run.head_sha !== headSha) throw new Error("GitHub workflow run head SHA mismatch");
  if (run.head_branch !== headBranch) {
    throw new Error("GitHub workflow run head branch mismatch");
  }
  if (run.path !== workflowPath) throw new Error("GitHub workflow run workflow path mismatch");
  if (run.repository.full_name !== repository) {
    throw new Error("GitHub workflow run repository mismatch");
  }
  if (expected.event !== undefined) {
    const event = requireString(expected.event, "expected event");
    if (run.event !== event) throw new Error("GitHub workflow run event mismatch");
  }
  const runAttempt = positiveInteger(run.run_attempt, "GitHub workflow run attempt");
  if (expected.runAttempt !== undefined && runAttempt !== positiveInteger(
    expected.runAttempt,
    "expected runAttempt",
  )) {
    throw new Error("GitHub workflow run attempt mismatch");
  }
  return runAttempt;
}

function normalizeEvidenceOptions(options) {
  assertRecord(options, "release evidence options");
  const type = requireString(options.type, "type");
  if (!RELEASE_EVIDENCE_TYPES.includes(type)) throw new Error(`unsupported evidence type: ${type}`);
  const reportPath = requireString(options.reportPath, "reportPath");
  const artifacts = options.artifacts ?? {};
  assertRecord(artifacts, "artifacts");
  return {
    type,
    reportPath,
    artifacts,
    ...normalizeRunMetadata(options),
  };
}

async function validateSourceReport(type, reportPath, metadata) {
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    throw new Error(`source report is not valid JSON: ${error.message}`, { cause: error });
  }
  assertRecord(report, "source report");
  if (report.status !== "success") throw new Error("source report status is not success");
  if (type === "llama-matrix") {
    if (report.kind !== "native-tauri-gguf-matrix") {
      throw new Error("llama-matrix source report kind is invalid");
    }
    if (report.gitSha !== metadata.headSha) throw new Error("llama-matrix report tagged SHA mismatch");
    if (!Array.isArray(report.entries) || report.entries.length === 0) {
      throw new Error("llama-matrix report has no executable entries");
    }
    if (report.entries.some((entry) => entry?.status !== "success")) {
      throw new Error("llama-matrix report contains a failed entry");
    }
    report.entries.forEach((entry, index) => validateMatrixEntry(entry, report, index));
  } else if (type === "external-client") {
    await validateExternalClientEvidence(report, metadata);
  } else if (type === "clean-mac") {
    await validateCleanMacReport(report, metadata);
  }
  return report;
}

async function hashArtifacts(artifacts) {
  const checksums = {};
  for (const name of Object.keys(artifacts).sort()) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
      throw new Error(`invalid artifact checksum name: ${name}`);
    }
    checksums[name] = await sha256File(requireString(artifacts[name], `artifact ${name}`));
  }
  return checksums;
}

function requireRelevantArtifacts(type, checksums) {
  const names = Object.keys(checksums);
  const required = {
    "llama-matrix": ["binary", "model"],
    "external-client": ["binary", "curl", "model", "nativeReport"],
    "clean-mac": [
      "binary",
      "curl",
      "externalReport",
      "gatekeeperStatus",
      "model",
      "nativeReport",
      "rcChecksum",
      "rcDmg",
      "rcProvenance",
      ...CLEAN_CHECK_NAMES,
    ],
  }[type];
  for (const name of required) {
    if (!names.includes(name)) throw new Error(`${type} evidence is missing ${name} checksum`);
  }
}

async function crossCheckReportChecksums(type, report, checksums, artifacts) {
  if (type === "external-client") {
    await crossCheckExternalEvidence(report, checksums, artifacts);
    return;
  }
  if (type === "clean-mac") {
    await crossCheckCleanMacEvidence(report, checksums, artifacts);
    return;
  }
  if (type !== "llama-matrix") return;
  const expectedNames = ["model"];
  const modelDigests = new Set();
  const modelPaths = new Set();
  const binaryPaths = new Set();
  report.entries.forEach((entry, index) => {
    requireSha256(entry.binarySha256, `matrix entry ${index} binary checksum`);
    requireSha256(entry.modelSha256, `matrix entry ${index} model checksum`);
    const binaryName = index === 0 ? "binary" : `binary-${index}`;
    expectedNames.push(binaryName);
    if (checksums[binaryName] !== entry.binarySha256) {
      throw new Error(`${binaryName} checksum does not match the source report`);
    }
    modelDigests.add(entry.modelSha256);
    modelPaths.add(entry.modelPath);
    binaryPaths.add(entry.binaryPath);
  });
  if (modelDigests.size !== 1 || checksums.model !== [...modelDigests][0]) {
    throw new Error("model checksum does not match every source report entry");
  }
  if (modelPaths.size !== 1) throw new Error("matrix entries do not use one bound model path");
  if (binaryPaths.size !== report.entries.length) {
    throw new Error("matrix entries must use unique one-to-one binary paths");
  }
  const actualNames = Object.keys(checksums).sort();
  if (!sameArray(actualNames, expectedNames.sort())) {
    throw new Error("matrix evidence contains an unbound or missing binary artifact checksum");
  }
  for (let index = 0; index < report.entries.length; index += 1) {
    const binaryName = index === 0 ? "binary" : `binary-${index}`;
    if (artifacts[binaryName] !== undefined) {
      await requireSameFile(
        artifacts[binaryName],
        report.entries[index].binaryPath,
        `${binaryName} path`,
        true,
      );
    }
  }
  if (artifacts.model !== undefined) {
    await requireSameFile(artifacts.model, report.entries[0].modelPath, "model path", true);
  }
}

function validateMatrixEntry(entry, report, index) {
  assertRecord(entry, `matrix entry ${index}`);
  if (entry.status !== "success") throw new Error(`matrix entry ${index} status is not success`);
  if (entry.gitSha !== report.gitSha) throw new Error(`matrix entry ${index} tagged SHA mismatch`);
  if (typeof entry.appVersion !== "string" || !entry.appVersion) {
    throw new Error(`matrix entry ${index} appVersion is missing`);
  }
  if (typeof entry.binaryVersion !== "string" || !entry.binaryVersion) {
    throw new Error(`matrix entry ${index} binary version is missing`);
  }
  requireNativeSteps(entry.steps, `matrix entry ${index}`);
  assertRecord(entry.artifacts, `matrix entry ${index} native artifacts`);
  requireSha256(entry.artifacts.binarySha256, `matrix entry ${index} native binary SHA-256`);
  requireSha256(entry.artifacts.modelSha256, `matrix entry ${index} native model SHA-256`);
  if (entry.artifacts.binarySha256 !== entry.binarySha256) {
    throw new Error(`matrix entry ${index} native artifact binary SHA-256 mismatch`);
  }
  if (entry.artifacts.modelSha256 !== entry.modelSha256) {
    throw new Error(`matrix entry ${index} native artifact model SHA-256 mismatch`);
  }
  validateLifecycle({
    label: `matrix entry ${index}`,
    scan: entry.scan,
    commandSpec: entry.commandSpec,
    activeLaunch: entry.activeSnapshot?.activeLaunch,
    pid: entry.activeSnapshot?.pid,
    binaryPath: entry.binaryPath,
    modelPath: entry.modelPath,
    modelId: entry.modelId,
    chat: entry.chat,
    cancellation: entry.cancellation,
    recovery: entry.recovery,
    stop: entry.stop,
  });
}

async function crossCheckExternalEvidence(external, checksums, artifacts) {
  const expectedNames = ["binary", "curl", "model", "nativeReport"].sort();
  if (!sameArray(Object.keys(checksums).sort(), expectedNames)) {
    throw new Error("external-client evidence has missing or unbound artifact checksums");
  }
  if (checksums.curl !== external.curl.sha256) {
    throw new Error("curl artifact checksum does not match the external-client report");
  }
  if (!artifacts.nativeReport) {
    throw new Error("external-client evidence requires the nativeReport artifact file");
  }
  const native = await readJsonFile(artifacts.nativeReport, "native report");
  validateNativeExternalReport(native, external);
  if (checksums.binary !== native.artifacts.binarySha256) {
    throw new Error("binary checksum does not match the native report");
  }
  if (checksums.model !== native.artifacts.modelSha256) {
    throw new Error("model checksum does not match the native report");
  }
  if (artifacts.binary !== undefined) {
    await requireSameFile(artifacts.binary, native.activeLaunch.binaryPath, "binary path");
  }
  if (artifacts.model !== undefined) {
    await requireSameFile(artifacts.model, native.activeLaunch.modelPath, "model path");
  }
}

async function crossCheckCleanMacEvidence(report, checksums, artifacts) {
  const expectedNames = [
    "binary",
    "curl",
    "externalReport",
    "gatekeeperStatus",
    "model",
    "nativeReport",
    "rcChecksum",
    "rcDmg",
    "rcProvenance",
    ...CLEAN_CHECK_NAMES,
  ].sort();
  if (!sameArray(Object.keys(checksums).sort(), expectedNames)) {
    throw new Error("clean-mac evidence has missing or unbound artifact checksums");
  }
  if (checksums.binary !== report.nativeReport.artifacts.binarySha256) {
    throw new Error("clean-Mac binary checksum does not match the native report");
  }
  if (checksums.model !== report.nativeReport.artifacts.modelSha256) {
    throw new Error("clean-Mac model checksum does not match the native report");
  }
  if (checksums.curl !== report.externalClient.curl.sha256) {
    throw new Error("clean-Mac curl checksum does not match the external report");
  }
  if (checksums.gatekeeperStatus !== report.gatekeeper.rawSha256) {
    throw new Error("clean-Mac Gatekeeper status checksum does not match its raw output");
  }
  for (const name of CLEAN_CHECK_NAMES) {
    if (checksums[name] !== report.checks[name]) {
      throw new Error(`clean-Mac ${name} check checksum does not match its raw output`);
    }
  }
  if (checksums.rcDmg !== report.rcProvenance.dmgSha256) {
    throw new Error("clean-Mac RC DMG checksum does not match RC provenance");
  }
  if (checksums.rcChecksum !== report.rcProvenance.checksumSha256) {
    throw new Error("clean-Mac RC checksum file hash does not match RC provenance");
  }

  await requireLinkedJson(
    artifacts.nativeReport,
    report.nativeReport,
    "clean-Mac linked native report",
  );
  await requireLinkedJson(
    artifacts.externalReport,
    report.externalClient,
    "clean-Mac linked external report",
  );
  await requireLinkedJson(
    artifacts.rcProvenance,
    report.rcProvenance,
    "clean-Mac linked RC provenance",
  );

  if (artifacts.rcDmg !== undefined || artifacts.rcChecksum !== undefined) {
    if (!artifacts.rcDmg || !artifacts.rcChecksum) {
      throw new Error("clean-Mac RC DMG and portable checksum must be supplied together");
    }
    await validateRcArtifactProvenance(report.rcProvenance, {
      dmgPath: artifacts.rcDmg,
      checksumPath: artifacts.rcChecksum,
      headSha: report.headSha,
      workflowPath: ".github/workflows/release.yml",
      runId: report.rcProvenance.runId,
      runAttempt: report.rcProvenance.runAttempt,
      repository: report.repository,
      tag: "v3.2.0-rc.1",
      mode: "signed-release",
    });
  }
}

function validateNativeExternalReport(native, external) {
  assertRecord(native, "native external-client report");
  if (native.schemaVersion !== 1 || native.kind !== "native-tauri") {
    throw new Error("native external-client report must be schemaVersion 1 native-tauri");
  }
  if (native.status !== "success") throw new Error("native external-client report status is not success");
  if (typeof native.appVersion !== "string" || !native.appVersion) {
    throw new Error("native external-client report appVersion is missing");
  }
  requireNativeSteps(native.steps, "native external-client report");
  validateLifecycle({
    label: "native external-client report",
    scan: native.scan,
    commandSpec: native.commandSpec,
    activeLaunch: native.activeLaunch,
    pid: native.startedPid,
    binaryPath: native.commandSpec?.executable,
    modelPath: native.scan?.configuredModel?.path,
    modelId: native.modelId,
    chat: native.chat,
    cancellation: native.cancellation,
    recovery: native.recovery,
    stop: native.stop,
  });
  assertRecord(native.artifacts, "native artifact hashes");
  requireSha256(native.artifacts.binarySha256, "native binary SHA-256");
  requireSha256(native.artifacts.modelSha256, "native model SHA-256");
  assertRecord(native.externalClient, "native embedded external curl evidence");
  assertRecord(native.externalClient.report, "native embedded external curl report");
  requireSha256(native.externalClient.reportSha256, "native external report SHA-256");
  const canonical = sha256Canonical(native.externalClient.report);
  if (native.externalClient.reportSha256 !== canonical) {
    throw new Error("native embedded external report SHA-256 mismatch");
  }
  if (canonical !== sha256Canonical(external)) {
    throw new Error("native report embeds a different external curl report");
  }
  const endpoint = new URL(external.endpoint);
  const endpointPort = Number(endpoint.port || 80);
  if (endpointPort !== native.activeLaunch.port) {
    throw new Error("external curl endpoint does not match the native service port");
  }
  if (external.detectedModelId !== native.modelId) {
    throw new Error("external curl model ID does not match the native report");
  }
}

function validateLifecycle({
  label,
  scan,
  commandSpec,
  activeLaunch,
  pid,
  binaryPath,
  modelPath,
  modelId,
  chat,
  cancellation,
  recovery,
  stop,
}) {
  assertRecord(scan, `${label} scan`);
  const configuredModel = scan.configuredModel;
  if (
    configuredModel?.path !== modelPath ||
    configuredModel?.available !== true ||
    !["ready", "limited"].includes(configuredModel?.metadataStatus)
  ) {
    throw new Error(`${label} scan did not accept the bound production model`);
  }
  assertRecord(commandSpec, `${label} commandSpec`);
  if (commandSpec.executable !== binaryPath || !Array.isArray(commandSpec.args)) {
    throw new Error(`${label} commandSpec is not bound to the binary path`);
  }
  assertRecord(activeLaunch, `${label} active launch`);
  if (
    activeLaunch.binaryPath !== binaryPath ||
    activeLaunch.modelPath !== modelPath ||
    !sameArray(activeLaunch.commandArgs, commandSpec.args)
  ) {
    throw new Error(`${label} active launch does not match CommandSpec paths/argv`);
  }
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`${label} active PID is not a real child`);
  if (!Number.isInteger(activeLaunch.port) || activeLaunch.port < 1 || activeLaunch.port > 65_535) {
    throw new Error(`${label} active port is invalid`);
  }
  if (
    argValue(commandSpec.args, "--model") !== modelPath ||
    argValue(commandSpec.args, "--host") !== "127.0.0.1" ||
    argValue(commandSpec.args, "--port") !== String(activeLaunch.port)
  ) {
    throw new Error(`${label} CommandSpec model/host/port arguments are incomplete`);
  }
  if (typeof modelId !== "string" || !modelId) throw new Error(`${label} modelId is missing`);
  if (typeof chat?.content !== "string" || !chat.content.trim()) {
    throw new Error(`${label} chat evidence is missing`);
  }
  if (
    cancellation?.abortControllerAborted !== true ||
    cancellation?.abortErrorObserved !== true ||
    cancellation?.streamStarted !== true
  ) {
    throw new Error(`${label} cancellation evidence is incomplete`);
  }
  if (recovery?.recoveryAction !== "changePort" || recovery?.exercised !== true) {
    throw new Error(`${label} structured recovery evidence is missing`);
  }
  if (stop?.pid !== null || stop?.activeLaunch !== null || stop?.portReachable !== false) {
    throw new Error(`${label} stop evidence is incomplete`);
  }
}

function requireNativeSteps(steps, label) {
  if (!Array.isArray(steps)) throw new Error(`${label} steps are missing`);
  const webview = new Set(["non-stream-chat", "stream-cancellation"]);
  let previousIndex = -1;
  for (const name of [
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
  ]) {
    const expectedTransport = webview.has(name) ? "webview-http" : "tauri-ipc";
    const matches = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step?.name === name);
    if (matches.length !== 1) {
      throw new Error(`${label} step ${name} must appear exactly once`);
    }
    const [{ step, index }] = matches;
    if (step?.status !== "success" || step?.transport !== expectedTransport) {
      throw new Error(`${label} is missing successful ${expectedTransport} step ${name}`);
    }
    if (index <= previousIndex) throw new Error(`${label} required steps are out of order at ${name}`);
    previousIndex = index;
  }
}

async function hashExactArtifacts(artifacts, names, label) {
  assertRecord(artifacts, label);
  if (!sameArray(Object.keys(artifacts).sort(), [...names].sort())) {
    throw new Error(`${label} must contain exactly: ${names.join(", ")}`);
  }
  return hashArtifacts(artifacts);
}

function validateExactChecks(checks, names, label) {
  assertRecord(checks, label);
  if (!sameArray(Object.keys(checks).sort(), [...names].sort())) {
    throw new Error(`${label} must contain exactly: ${names.join(", ")}`);
  }
  for (const name of names) requireSha256(checks[name], `${label} ${name} SHA-256`);
}

async function requireLinkedJson(path, embedded, label) {
  if (path === undefined) return;
  const linked = await readJsonFile(path, label);
  if (sha256Canonical(linked) !== sha256Canonical(embedded)) {
    throw new Error(`${label} does not match the embedded report`);
  }
}

async function requireSameFile(left, right, label, requireCanonicalRight = false) {
  let leftReal;
  let rightReal;
  try {
    [leftReal, rightReal] = await Promise.all([realpath(left), realpath(right)]);
  } catch (error) {
    throw new Error(`${label} cannot be resolved for artifact binding: ${error.message}`, {
      cause: error,
    });
  }
  if (requireCanonicalRight && rightReal !== right) {
    throw new Error(`${label} source report path is not canonical`);
  }
  if (leftReal !== rightReal) throw new Error(`${label} does not match the source report`);
}

function argValue(args, flag) {
  if (!Array.isArray(args)) return undefined;
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeRcOptions(options) {
  assertRecord(options, "signed RC provenance options");
  const metadata = normalizeRunMetadata(options);
  if (metadata.workflowPath !== ".github/workflows/release.yml") {
    throw new Error("signed RC workflowPath must be .github/workflows/release.yml");
  }
  const tag = requireString(options.tag, "tag");
  if (tag !== "v3.2.0-rc.1") throw new Error("signed RC tag must be v3.2.0-rc.1");
  const mode = requireString(options.mode, "mode");
  if (mode !== "signed-release") throw new Error("signed RC mode must be signed-release");
  return {
    ...metadata,
    tag,
    mode,
    dmgPath: requireString(options.dmgPath, "dmgPath"),
    checksumPath: requireString(options.checksumPath, "checksumPath"),
  };
}

function validateEmbeddedRcProvenance(provenance, expected) {
  assertRecord(provenance, "signed RC provenance");
  rejectUnknownFields(provenance, RC_PROVENANCE_FIELDS, "signed RC provenance");
  if (provenance.schemaVersion !== 1 || provenance.type !== "signed-rc") {
    throw new Error("signed RC provenance schema/type mismatch");
  }
  if (provenance.status !== "success") throw new Error("signed RC provenance status is not success");
  for (const field of ["headSha", "workflowPath", "repository", "tag", "mode"]) {
    if (expected[field] !== undefined && provenance[field] !== expected[field]) {
      const label = field === "headSha" ? "tagged SHA" : field;
      throw new Error(`signed RC ${label} mismatch`);
    }
  }
  for (const field of ["runId", "runAttempt"]) {
    if (!Number.isSafeInteger(provenance[field]) || provenance[field] <= 0) {
      throw new Error(`signed RC ${field} must be a positive integer`);
    }
    if (expected[field] !== undefined && provenance[field] !== expected[field]) {
      throw new Error(`signed RC ${field} mismatch`);
    }
  }
  requireSha256(provenance.dmgSha256, "signed RC DMG SHA-256");
  requireSha256(provenance.checksumSha256, "signed RC checksum file SHA-256");
  if (typeof provenance.dmgName !== "string" || basename(provenance.dmgName) !== provenance.dmgName) {
    throw new Error("signed RC DMG name must be a basename");
  }
  if (
    typeof provenance.checksumName !== "string" ||
    basename(provenance.checksumName) !== provenance.checksumName
  ) {
    throw new Error("signed RC checksum name must be a basename");
  }
  if (!validTimestamp(provenance.completedAt)) {
    throw new Error("signed RC completedAt is missing or invalid");
  }
}

function nativeBinding(nativeReport, externalClient) {
  return {
    endpoint: externalClient.endpoint,
    port: nativeReport.activeLaunch.port,
    modelId: nativeReport.modelId,
  };
}

async function readJsonFile(path, label) {
  try {
    return JSON.parse(await readFile(requireString(path, `${label} path`), "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
}

function validateCurlRecord(curl) {
  assertRecord(curl, "curl executable evidence");
  rejectUnknownFields(curl, new Set(["path", "sha256", "version"]), "curl executable evidence");
  if (typeof curl.path !== "string" || !isAbsolute(curl.path)) {
    throw new Error("curl executable path must be absolute");
  }
  requireSha256(curl.sha256, "curl executable SHA-256");
  if (typeof curl.version !== "string" || !curl.version.startsWith("curl ") || !curl.version.endsWith("\n")) {
    throw new Error("exact curl --version output is missing");
  }
}

function validateStreamingEvidence(streaming) {
  assertRecord(streaming, "streaming evidence");
  rejectUnknownFields(streaming, STREAMING_EVIDENCE_FIELDS, "streaming evidence");
  if (
    streaming.done !== true ||
    !Array.isArray(streaming.events) ||
    streaming.events.length === 0 ||
    !Array.isArray(streaming.sequence) ||
    streaming.sequence.length !== streaming.events.length + 1
  ) {
    throw new Error("streaming SSE sequence evidence is incomplete");
  }

  let content = "";
  let contentEventSeen = false;
  for (let index = 0; index < streaming.events.length; index += 1) {
    const entry = streaming.sequence[index];
    assertRecord(entry, `streaming SSE sequence entry ${index}`);
    rejectUnknownFields(
      entry,
      SSE_EVENT_SEQUENCE_FIELDS,
      `streaming SSE sequence entry ${index}`,
    );
    if (entry.type !== "event" || entry.eventIndex !== index) {
      throw new Error("streaming SSE event order is inconsistent with its sequence evidence");
    }
    const delta = streaming.events[index]?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") {
      content += delta;
      if (delta.length > 0) contentEventSeen = true;
    }
  }

  const terminal = streaming.sequence.at(-1);
  assertRecord(terminal, "streaming SSE terminal sequence entry");
  rejectUnknownFields(terminal, SSE_DONE_SEQUENCE_FIELDS, "streaming SSE terminal sequence entry");
  if (terminal.type !== "done") {
    throw new Error("streaming SSE [DONE] must be the unique terminal sequence entry");
  }
  if (!contentEventSeen || !content || streaming.content !== content) {
    throw new Error("streaming SSE content evidence is missing or inconsistent");
  }
}

async function verifyRecordedCurl(curl) {
  let executable;
  try {
    executable = await realpath(curl.path);
    const info = await stat(executable);
    if (!info.isFile()) throw new Error("not a file");
    await access(executable, fsConstants.X_OK);
  } catch (error) {
    throw new Error(`recorded curl executable path is unavailable: ${curl.path}`, { cause: error });
  }
  if (executable !== curl.path) {
    throw new Error("recorded curl executable path is not canonical");
  }
  if (await sha256File(executable) !== curl.sha256) {
    throw new Error("recorded curl executable SHA-256 does not match the local executable");
  }
  const version = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (version.status !== 0) throw new Error("recorded curl executable cannot report its version");
  if (version.stdout !== curl.version) {
    throw new Error("recorded curl version does not match exact curl --version output");
  }
}

function normalizeEndpoint(value) {
  const raw = requireString(value, "endpoint");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("endpoint must be an absolute URL");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("endpoint must use plain HTTP on loopback");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("endpoint must be an uncredentialed loopback origin");
  }
  return url.origin;
}

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} contains unknown or legacy field: ${field}`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required`);
  return value;
}

function positiveInteger(value, label) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index]);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value) {
  return sha256Text(JSON.stringify(value));
}
