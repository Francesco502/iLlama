import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeMinimalGgufFixture } from "../lib/gguf-fixture.mjs";

test("writes a structurally complete GGUF with tensor info and aligned data", async () => {
  const path = join(tmpdir(), `illama-gguf-fixture-${process.pid}-${Date.now()}.gguf`);
  await writeMinimalGgufFixture(path);
  const bytes = await readFile(path);

  assert.equal(bytes.subarray(0, 4).toString("ascii"), "GGUF");
  assert.equal(bytes.readUInt32LE(4), 3);
  assert.equal(Number(bytes.readBigUInt64LE(8)), 1, "must declare a real tensor");
  assert.ok(Number(bytes.readBigUInt64LE(16)) > 0, "must include production metadata");
  assert.ok((await stat(path)).size > 32, "must not be an eight-byte header fixture");
});
