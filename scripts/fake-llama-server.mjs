#!/usr/bin/env node

import http from "node:http";

const HELP = `fake llama-server test double

Usage: fake-llama-server [options]
  --model <path>
  --host <address>
  --port <number>
  --ctx-size <number>
  --n-gpu-layers <number>
  --threads <number>
  --batch-size <number>
  --ubatch-size <number>
  --flash-attn
  --no-mmap
  --mlock
  --mmproj <path>
  --metrics
  --temp <number>
  --top-p <number>
  --top-k <number>
  --min-p <number>
  --repeat-penalty <number>
  --seed <number>
  --version
  --help

Test controls are supplied through environment variables:
  FAKE_LLAMA_LISTEN_DELAY_MS, FAKE_LLAMA_STARTUP_DELAY_MS,
  FAKE_LLAMA_MODEL_ID, FAKE_LLAMA_CHAT_DELAY_MS,
  FAKE_LLAMA_EXIT_AFTER_MS, FAKE_LLAMA_EXIT_CODE
`;

if (process.argv.includes("--version")) {
  console.log(process.env.FAKE_LLAMA_VERSION || "llama-server fake 3.2.0");
  process.exit(0);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined
    ? process.argv[index + 1]
    : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const host = optionValue("--host", "127.0.0.1");
const port = nonNegativeInteger(optionValue("--port", "8080"), 8080);
const modelId = process.env.FAKE_LLAMA_MODEL_ID || "fake-model";
const listenDelayMs = nonNegativeInteger(process.env.FAKE_LLAMA_LISTEN_DELAY_MS);
const startupDelayMs = nonNegativeInteger(process.env.FAKE_LLAMA_STARTUP_DELAY_MS);
const chatDelayMs = nonNegativeInteger(process.env.FAKE_LLAMA_CHAT_DELAY_MS);
const exitAfterMs = nonNegativeInteger(process.env.FAKE_LLAMA_EXIT_AFTER_MS);
const requestedExitCode = nonNegativeInteger(process.env.FAKE_LLAMA_EXIT_CODE, 42);
const exitCode = Math.min(requestedExitCode, 255);
let readyAt = Number.POSITIVE_INFINITY;
let shuttingDown = false;

function json(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-length": Buffer.byteLength(encoded),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(encoded);
}

function healthy() {
  return Date.now() >= readyAt;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw new Error("request body exceeds 1 MiB");
    }
  }
  return body.length > 0 ? JSON.parse(body) : {};
}

function completionText(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message && message.role === "user");
  const prompt = typeof lastUserMessage?.content === "string"
    ? lastUserMessage.content
    : "ready";
  return `Fake response: ${prompt}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-origin": "*",
    });
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, healthy() ? 200 : 503, {
      status: healthy() ? "ok" : "loading model",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/models") {
    if (!healthy()) {
      json(response, 503, { error: { message: "model is still loading" } });
      return;
    }
    json(response, 200, {
      object: "list",
      data: [{ id: modelId, object: "model", owned_by: "fake-llama-server" }],
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    if (!healthy()) {
      json(response, 503, { error: { message: "model is still loading" } });
      return;
    }
    try {
      const payload = await readJson(request);
      if (chatDelayMs > 0) await wait(chatDelayMs);
      const content = completionText(payload);
      const created = Math.floor(Date.now() / 1000);
      if (payload.stream === true) {
        response.writeHead(200, {
          "access-control-allow-origin": "*",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
        });
        for (const token of content.match(/\S+\s*/g) || [content]) {
          response.write(`data: ${JSON.stringify({
            id: "chatcmpl-fake",
            object: "chat.completion.chunk",
            created,
            model: modelId,
            choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
          })}\n\n`);
        }
        response.write(`data: ${JSON.stringify({
          id: "chatcmpl-fake",
          object: "chat.completion.chunk",
          created,
          model: modelId,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`);
        response.end("data: [DONE]\n\n");
        return;
      }
      json(response, 200, {
        id: "chatcmpl-fake",
        object: "chat.completion",
        created,
        model: modelId,
        choices: [{
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    } catch (error) {
      json(response, 400, { error: { message: String(error.message || error) } });
    }
    return;
  }

  json(response, 404, { error: { message: "not found" } });
});

function terminate(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server.listening) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 1_000).unref();
  console.log(JSON.stringify({ event: "shutdown", signal }));
}

server.on("error", (error) => {
  const code = error.code === "EADDRINUSE" ? 98 : 1;
  console.error(JSON.stringify({
    event: "error",
    code: error.code || "SERVER_ERROR",
    message: error.message,
  }));
  process.exitCode = code;
});

process.on("SIGINT", () => terminate("SIGINT"));
process.on("SIGTERM", () => terminate("SIGTERM"));

if (exitAfterMs > 0) {
  setTimeout(() => {
    console.error(JSON.stringify({ event: "forced-exit", exitCode }));
    process.exit(exitCode);
  }, exitAfterMs);
}

setTimeout(() => {
  server.listen(port, host, () => {
    readyAt = Date.now() + startupDelayMs;
    const address = server.address();
    console.log(JSON.stringify({
      event: "listening",
      host,
      port: typeof address === "object" && address ? address.port : port,
      modelId,
      startupDelayMs,
    }));
  });
}, listenDelayMs);
