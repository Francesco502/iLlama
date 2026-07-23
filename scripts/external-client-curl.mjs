#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeRunMetadata,
  validateExternalClientEvidence,
} from "./lib/release-evidence.mjs";
import { sha256File } from "./lib/portable-checksum.mjs";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const STREAM_TIMEOUT_MS = 60_000;
const CANCELLATION_TIMEOUT_MS = 15_000;

export async function discoverCurlExecutable(pathValue = process.env.PATH ?? "") {
  const candidates = [
    "/usr/bin/curl",
    "/usr/local/bin/curl",
    "/opt/homebrew/bin/curl",
    ...pathValue
      .split(delimiter)
      .filter((directory) => isAbsolute(directory))
      .map((directory) => join(directory, "curl")),
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const canonical = await realpath(candidate);
      const info = await stat(canonical);
      if (!info.isFile()) continue;
      await access(canonical, fsConstants.X_OK);
      return canonical;
    } catch {
      // Keep looking for a real executable.
    }
  }
  throw new Error("unable to discover an executable curl binary on this host");
}

export async function runExternalClientCurl(options = {}) {
  const metadata = normalizeRunMetadata(options);
  const endpoint = normalizeEndpoint(options.endpoint);
  const reportPath = requireAbsolutePath(options.reportPath, "reportPath");
  const curlPath = await discoverCurlExecutable(options.path ?? process.env.PATH ?? "");
  const versionResult = await runCurlProcess(curlPath, ["--version"], { timeoutMs: 10_000 });
  const curl = {
    path: curlPath,
    sha256: await sha256File(curlPath),
    version: versionResult.stdout,
  };

  const modelsResult = await runCurlProcess(curlPath, requestArguments({
    endpoint,
    path: "/v1/models",
    method: "GET",
    timeoutSeconds: 30,
  }), { timeoutMs: REQUEST_TIMEOUT_MS });
  const modelsResponse = parseJsonResponse(modelsResult.stdout, "/v1/models");
  const modelIds = Array.isArray(modelsResponse?.data)
    ? modelsResponse.data.map((entry) => entry?.id).filter(nonEmptyString)
    : [];
  if (modelIds.length === 0) throw new Error("curl /v1/models returned no usable model ID");
  const detectedModelId = modelIds[0];

  const nonStreamResult = await runCurlProcess(curlPath, requestArguments({
    endpoint,
    path: "/v1/chat/completions",
    method: "POST",
    body: chatBody(detectedModelId, false, "Reply with exactly OK."),
    timeoutSeconds: 30,
  }), { timeoutMs: REQUEST_TIMEOUT_MS });
  const nonStreamResponse = parseJsonResponse(
    nonStreamResult.stdout,
    "/v1/chat/completions non-stream",
  );
  const nonStreamContent = nonStreamResponse?.choices?.[0]?.message?.content;
  const nonStreamReasoningContent = nonStreamResponse?.choices?.[0]?.message?.reasoning_content;
  if (!nonEmptyString(nonStreamContent) && !nonEmptyString(nonStreamReasoningContent)) {
    throw new Error("curl non-stream chat response did not contain assistant content or reasoning_content");
  }

  const streamingResult = await runCurlProcess(curlPath, requestArguments({
    endpoint,
    path: "/v1/chat/completions",
    method: "POST",
    body: chatBody(detectedModelId, true, "Reply with a short greeting."),
    timeoutSeconds: 60,
    noBuffer: true,
  }), { timeoutMs: STREAM_TIMEOUT_MS });
  const streaming = parseSse(streamingResult.stdout);
  if (
    !streaming.done ||
    streaming.events.length === 0 ||
    (!streaming.content && !streaming.reasoningContent)
  ) {
    throw new Error("curl SSE response did not contain content or reasoning_content followed by [DONE]");
  }

  const cancellation = await runCancellation(curlPath, requestArguments({
    endpoint,
    path: "/v1/chat/completions",
    method: "POST",
    body: chatBody(
      detectedModelId,
      true,
      "Stream a deliberately long response until the client cancels.",
    ),
    timeoutSeconds: 120,
    noBuffer: true,
  }));

  const transcript = boundedRedactedTranscript({
    endpoint,
    curlVersion: curl.version,
    models: modelsResponse,
    nonStream: nonStreamResponse,
    streaming,
    cancellation,
  });
  const report = {
    schemaVersion: 1,
    kind: "external-client-curl",
    status: "success",
    ...metadata,
    endpoint,
    curl,
    models: { response: modelsResponse, modelIds },
    detectedModelId,
    nonStream: {
      response: nonStreamResponse,
      content: nonStreamContent ?? "",
      reasoningContent: nonStreamReasoningContent ?? "",
    },
    streaming,
    cancellation,
    transcript,
    transcriptSha256: createHash("sha256").update(transcript).digest("hex"),
    completedAt: new Date().toISOString(),
  };
  await validateExternalClientEvidence(report, {
    endpoint,
    verifyCurlExecutable: true,
    ...metadata,
  });
  await atomicWriteJson(reportPath, report);
  return report;
}

export function requestArguments({
  endpoint,
  path,
  method,
  body,
  timeoutSeconds,
  noBuffer = false,
}) {
  const args = [
    "--noproxy",
    "*",
    "--silent",
    "--show-error",
    "--fail-with-body",
    "--connect-timeout",
    "5",
    "--max-time",
    String(timeoutSeconds),
  ];
  if (noBuffer) args.push("--no-buffer");
  args.push("--request", method);
  if (body !== undefined) {
    args.push(
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      JSON.stringify(body),
    );
  }
  args.push(`${endpoint}${path}`);
  return args;
}

function chatBody(model, stream, content) {
  return {
    model,
    messages: [{ role: "user", content }],
    stream,
  };
}

export async function runCurlProcess(
  executable,
  args,
  { timeoutMs, maxResponseBytes = MAX_RESPONSE_BYTES } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("curl timeoutMs must be a positive integer");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error("curl maxResponseBytes must be a positive integer");
  }
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let terminalError = null;
    const timer = setTimeout(() => {
      if (settled) return;
      terminate(new Error(`curl timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const append = (current, chunk) => {
      if (terminalError) return current;
      const next = Buffer.concat([current, chunk]);
      if (next.length > maxResponseBytes) {
        terminate(new Error(`curl response exceeded the ${maxResponseBytes}-byte evidence bound`));
        return current;
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", (error) => {
      terminalError ??= error;
    });
    child.once("close", (code, signal) => {
      if (terminalError) {
        finish(withCloseEvidence(terminalError, child.pid));
        return;
      }
      if (code !== 0) {
        finish(withCloseEvidence(new Error([
          `curl exited with code ${code ?? "null"} signal ${signal ?? "none"}`,
          redact(stderr.toString("utf8")).slice(-2_000),
        ].filter(Boolean).join("\n")), child.pid));
        return;
      }
      finish(null, {
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });

    function terminate(error) {
      if (terminalError || settled) return;
      terminalError = error;
      child.kill("SIGKILL");
    }

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(result);
    }
  });
}

async function runCancellation(executable, args) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const childPid = child.pid;
    let output = "";
    let stderr = "";
    let streamStarted = false;
    let killReturned = false;
    let settled = false;
    let terminalError = null;
    const timer = setTimeout(() => {
      terminalError = new Error("curl cancellation stream did not start before its deadline");
      child.kill("SIGKILL");
    }, CANCELLATION_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      output = appendBounded(output, chunk.toString("utf8"));
      if (!streamStarted && hasSseData(output)) {
        streamStarted = true;
        killReturned = child.kill("SIGTERM");
        if (!killReturned) {
          terminalError = new Error("failed to deliver SIGTERM to spawned curl process");
          child.kill("SIGKILL");
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"));
    });
    child.once("error", (error) => {
      terminalError ??= error;
    });
    child.once("close", (exitCode, exitSignal) => {
      if (terminalError) {
        finish(withCloseEvidence(terminalError, childPid));
        return;
      }
      if (!streamStarted || !killReturned) {
        finish(new Error(`curl cancellation exited before streaming began: ${redact(stderr)}`));
        return;
      }
      if (exitCode !== null || exitSignal !== "SIGTERM") {
        finish(new Error(
          `curl cancellation was not terminated by SIGTERM (code=${exitCode}, signal=${exitSignal})`,
        ));
        return;
      }
      finish(null, {
        childPid,
        streamStarted: true,
        signalSent: "SIGTERM",
        killReturned: true,
        exitCode,
        exitSignal,
        terminated: true,
      });
    });

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(result);
    }
  });
}

function withCloseEvidence(error, childPid) {
  error.childPid = childPid;
  error.closed = true;
  return error;
}

function parseJsonResponse(raw, label) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("response is not an object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${error.message}`, { cause: error });
  }
}

export function parseSse(raw) {
  const events = [];
  const sequence = [];
  let done = false;
  let contentEventSeen = false;
  let content = "";
  let reasoningContent = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trimStart();
    if (data === "[DONE]") {
      if (done) throw new Error("curl SSE contained a duplicate [DONE] frame");
      if (!contentEventSeen) {
        throw new Error("curl SSE [DONE] appeared before an event containing content");
      }
      done = true;
      sequence.push({ type: "done" });
      continue;
    }
    if (!data) continue;
    if (done) {
      throw new Error("curl SSE contained a non-empty data event after [DONE]");
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      throw new Error(`curl SSE event is not valid JSON: ${error.message}`, { cause: error });
    }
    const eventIndex = events.push(event) - 1;
    sequence.push({ type: "event", eventIndex });
    const delta = event?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") {
      content += delta;
      if (delta.length > 0) contentEventSeen = true;
    }
    const reasoningDelta = event?.choices?.[0]?.delta?.reasoning_content;
    if (typeof reasoningDelta === "string") {
      reasoningContent += reasoningDelta;
      if (reasoningDelta.length > 0) contentEventSeen = true;
    }
  }
  return { events, content, reasoningContent, done, sequence };
}

function hasSseData(raw) {
  return raw.split(/\r?\n/).some((line) => {
    const value = line.startsWith("data:") ? line.slice(5).trim() : "";
    return value && value !== "[DONE]";
  });
}

function boundedRedactedTranscript(value) {
  const redacted = redact(`${JSON.stringify(value, null, 2)}\n`);
  const encoded = Buffer.from(redacted, "utf8");
  if (encoded.length <= MAX_TRANSCRIPT_BYTES) return redacted;
  const marker = Buffer.from("\n...[transcript truncated]\n", "utf8");
  return Buffer.concat([
    encoded.subarray(0, MAX_TRANSCRIPT_BYTES - marker.length),
    marker,
  ]).toString("utf8");
}

function redact(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"']+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|password)\s*[:=]\s*)[^\s,"']+/gi, "$1[REDACTED]");
}

function appendBounded(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length <= MAX_RESPONSE_BYTES
    ? next
    : next.slice(next.length - MAX_RESPONSE_BYTES);
}

function normalizeEndpoint(value) {
  if (typeof value !== "string" || !value) throw new Error("endpoint is required");
  let url;
  try {
    url = new URL(value);
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

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return resolve(value);
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, path);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function parseArguments(argv) {
  const values = {};
  const names = new Map([
    ["--endpoint", "endpoint"],
    ["--report", "reportPath"],
    ["--head-sha", "headSha"],
    ["--workflow-path", "workflowPath"],
    ["--run-id", "runId"],
    ["--run-attempt", "runAttempt"],
    ["--repository", "repository"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const name = names.get(flag);
    if (!name || !value) throw usage(`unknown or incomplete argument: ${flag ?? "<missing>"}`);
    if (values[name] !== undefined) throw usage(`duplicate argument: ${flag}`);
    values[name] = value;
    index += 1;
  }
  for (const [flag, name] of names) {
    if (!values[name]) throw usage(`missing ${flag}`);
  }
  return values;
}

function usage(message) {
  return new Error([
    message,
    "usage: external-client-curl.mjs --endpoint URL --report FILE --head-sha SHA",
    "  --workflow-path PATH --run-id ID --run-attempt N --repository OWNER/REPO",
  ].join("\n"));
}

async function main(argv) {
  const report = await runExternalClientCurl(parseArguments(argv));
  console.log(JSON.stringify({
    status: report.status,
    client: "curl",
    version: report.curl.version.split(/\r?\n/, 1)[0],
    modelId: report.detectedModelId,
    report: resolve(parseArguments(argv).reportPath),
  }, null, 2));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
