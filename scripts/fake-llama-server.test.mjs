import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const binary = fileURLToPath(new URL("./fake-llama-server.mjs", import.meta.url));

function launch(extraEnv = {}, args = ["--host", "127.0.0.1", "--port", "0"]) {
  return spawn(process.execPath, [binary, ...args], {
    env: {
      ...process.env,
      FAKE_LLAMA_CHAT_DELAY_MS: "0",
      FAKE_LLAMA_EXIT_AFTER_MS: "0",
      FAKE_LLAMA_LISTEN_DELAY_MS: "0",
      FAKE_LLAMA_STARTUP_DELAY_MS: "0",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForJsonLine(stream, event, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    let pending = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      stream.off("data", onData);
    }
    function onData(chunk) {
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.event === event) {
            cleanup();
            resolve(parsed);
            return;
          }
        } catch {
          // Non-JSON diagnostic output is irrelevant to structured lifecycle events.
        }
      }
    }
    stream.on("data", onData);
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
}

test("reports a probe-compatible version and help surface", () => {
  const version = spawnSync(process.execPath, [binary, "--version"], {
    encoding: "utf8",
    env: { ...process.env, FAKE_LLAMA_VERSION: "llama-server test-build" },
  });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), "llama-server test-build");

  const help = spawnSync(process.execPath, [binary, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  for (const flag of ["--model", "--host", "--port", "--ctx-size", "--flash-attn"]) {
    assert.match(help.stdout, new RegExp(flag));
  }
});

test("delays listening, transitions health, and serves models and chat", async (t) => {
  const startedAt = Date.now();
  const child = launch({
    FAKE_LLAMA_LISTEN_DELAY_MS: "60",
    FAKE_LLAMA_STARTUP_DELAY_MS: "250",
    FAKE_LLAMA_MODEL_ID: "test-model-id",
  });
  t.after(() => stop(child));
  const listening = await waitForJsonLine(child.stdout, "listening");
  assert.ok(Date.now() - startedAt >= 40, "listen delay should be observable");
  const endpoint = `http://127.0.0.1:${listening.port}`;

  const loading = await fetch(`${endpoint}/health`);
  assert.equal(loading.status, 503);
  assert.deepEqual(await loading.json(), { status: "loading model" });

  await new Promise((resolve) => setTimeout(resolve, 280));
  const health = await fetch(`${endpoint}/health`);
  assert.equal(health.status, 200);

  const models = await (await fetch(`${endpoint}/v1/models`)).json();
  assert.equal(models.data[0].id, "test-model-id");

  const completion = await (await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "test-model-id",
      messages: [{ role: "user", content: "hello" }],
    }),
  })).json();
  assert.equal(completion.model, "test-model-id");
  assert.equal(completion.choices[0].message.content, "Fake response: hello");

  const stream = await (await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: true,
      messages: [{ role: "user", content: "stream me" }],
    }),
  })).text();
  assert.match(stream, /chat\.completion\.chunk/);
  const streamedContent = stream
    .split("\n")
    .filter((line) => line.startsWith("data: {") && line.includes("delta"))
    .map((line) => JSON.parse(line.slice(6)).choices[0].delta.content || "")
    .join("");
  assert.equal(streamedContent, "Fake response: stream me");
  assert.match(stream, /data: \[DONE\]/);
});

test("exits deterministically after startup when requested", async () => {
  const child = launch({
    FAKE_LLAMA_EXIT_AFTER_MS: "80",
    FAKE_LLAMA_EXIT_CODE: "23",
  });
  await waitForJsonLine(child.stdout, "listening");
  const [code] = await once(child, "exit");
  assert.equal(code, 23);
});

test("reports a stable failure when the requested port is occupied", async (t) => {
  const blocker = createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  t.after(() => blocker.close());
  const address = blocker.address();
  assert.equal(typeof address, "object");

  const child = launch({}, ["--host", "127.0.0.1", "--port", String(address.port)]);
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const [code] = await once(child, "exit");
  assert.equal(code, 98);
  assert.match(stderr, /EADDRINUSE/);
});
