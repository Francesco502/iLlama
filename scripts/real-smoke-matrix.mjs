#!/usr/bin/env node
/**
 * Application-level GGUF matrix. Every binary/model entry is exercised by the
 * packaged iLlama WebView through Tauri IPC; this file never starts llama-server.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  ensureAppBundle,
  runNativeTauriAcceptance,
} from "./native-tauri-acceptance.mjs";

const serverPaths = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : (process.env.LLAMA_SERVER_PATHS ?? "").split(/[:;]/);
const requestedBinaries = serverPaths
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => resolve(value));
const modelPath = process.env.LLAMA_MODEL_PATH?.trim();
const outputPath = resolve(
  process.env.LLAMA_MATRIX_REPORT ?? "artifacts/real-smoke-matrix.json",
);
const startupTimeoutMs = positiveInteger(
  process.env.LLAMA_MATRIX_STARTUP_TIMEOUT_MS,
  180_000,
);

if (process.platform !== "darwin") {
  console.error("真实 GGUF native matrix 仅支持 macOS。");
  process.exit(2);
}
if (requestedBinaries.length === 0 || !modelPath) {
  console.error("必须同时设置 LLAMA_SERVER_PATHS 和 LLAMA_MODEL_PATH（真实 GGUF 模型）。");
  process.exit(2);
}

const binaries = await Promise.all(requestedBinaries.map(async (requestedBinary) => (
  await realpath(requestedBinary)
)));
const model = await realpath(resolve(modelPath));
const appPath = process.env.ILLAMA_APP_PATH
  ? resolve(process.env.ILLAMA_APP_PATH)
  : await ensureAppBundle();
const gitSha = currentGitSha();
const matrixDirectory = await mkdtemp(join(tmpdir(), "illama-real-matrix-"));
const modelSha256 = await sha256File(model);
const entries = [];

for (let index = 0; index < binaries.length; index += 1) {
  const binary = binaries[index];
  const nativeReportPath = join(matrixDirectory, `native-${index}.json`);
  try {
    const result = await runNativeTauriAcceptance({
      app: appPath,
      binary,
      model,
      report: nativeReportPath,
      startupTimeoutMs,
      externalClient: process.env.LLAMA_EXTERNAL_CLIENT_PATH,
      fixtureControl: false,
    });
    const native = result.report;
    entries.push({
      status: "success",
      appVersion: native.appVersion,
      gitSha,
      binaryPath: binary,
      binaryVersion: native.commandSpec.capabilities.versionText,
      binarySha256: await sha256File(binary),
      modelPath: model,
      modelSha256,
      steps: native.steps,
      artifacts: result.artifacts,
      scan: native.scan,
      commandSpec: native.commandSpec,
      activeSnapshot: {
        pid: native.startedPid,
        activeLaunch: native.activeLaunch,
      },
      modelId: native.modelId,
      chat: native.chat,
      cancellation: native.cancellation,
      recovery: native.recovery,
      healthTransition: native.healthTransition,
      stop: native.stop,
    });
    console.log(`[ok] ${binary} model=${native.modelId}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    entries.push({
      status: "failure",
      appVersion: null,
      gitSha,
      binaryPath: binary,
      binaryVersion: null,
      binarySha256: await sha256File(binary).catch(() => null),
      modelPath: model,
      modelSha256,
      error: message,
    });
    console.error(`[fail] ${binary}: ${message}`);
  }
}

const report = {
  schemaVersion: 1,
  kind: "native-tauri-gguf-matrix",
  status: entries.every((entry) => entry.status === "success") ? "success" : "failure",
  appPath,
  gitSha,
  generatedAt: new Date().toISOString(),
  entries,
};
await atomicWriteJson(outputPath, report);
console.log(`[report] ${outputPath}`);
process.exitCode = report.status === "success" ? 0 : 1;

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function currentGitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("unable to resolve git SHA for matrix evidence");
  const sha = result.stdout.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("git HEAD is not an exact 40-hex SHA");
  return sha;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
