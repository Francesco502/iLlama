import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const moduleUrl = new URL("../lib/portable-checksum.mjs", import.meta.url);
const portable = await import(moduleUrl).catch((loadError) => ({ loadError }));

function api(name) {
  assert.ifError(portable.loadError);
  assert.equal(typeof portable[name], "function", `${name} must be exported`);
  return portable[name];
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "illama-portable-checksum-"));
  const elsewhere = join(directory, "elsewhere");
  const artifactPath = join(directory, "iLlama_3.2.0_aarch64.dmg");
  const checksumPath = `${artifactPath}.sha256`;
  await mkdir(elsewhere);
  await writeFile(artifactPath, "signed release candidate\n");
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, elsewhere, artifactPath, checksumPath };
}

test("writes one basename-only checksum entry and verifies it from another cwd", async (t) => {
  const { artifactPath, checksumPath, elsewhere } = await fixture(t);
  const createPortableChecksum = api("createPortableChecksum");

  const created = await createPortableChecksum(artifactPath, checksumPath);
  const digest = createHash("sha256").update("signed release candidate\n").digest("hex");
  assert.equal(
    await readFile(checksumPath, "utf8"),
    `${digest}  ${basename(artifactPath)}\n`,
  );
  assert.equal(created.digest, digest);

  const result = spawnSync(
    process.execPath,
    [moduleUrl.pathname, "verify", checksumPath],
    { cwd: elsewhere, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified/i);
});

test("rejects traversal, absolute paths, separators, malformed digests, and extra entries", () => {
  const parsePortableChecksum = api("parsePortableChecksum");
  const digest = "a".repeat(64);
  const invalid = [
    `${digest}  ../release.dmg\n`,
    `${digest}  /tmp/release.dmg\n`,
    `${digest}  nested/release.dmg\n`,
    `${digest}  nested\\release.dmg\n`,
    `${digest.slice(1)}  release.dmg\n`,
    `${digest} release.dmg\n`,
    `${digest}  release.dmg\n${digest}  release.dmg\n`,
    `${digest}  release.dmg\n\n`,
  ];

  for (const contents of invalid) {
    assert.throws(() => parsePortableChecksum(contents), /checksum/i, contents);
  }
});

test("rejects a checksum mismatch without depending on process cwd", async (t) => {
  const { artifactPath, checksumPath } = await fixture(t);
  const createPortableChecksum = api("createPortableChecksum");
  const verifyPortableChecksum = api("verifyPortableChecksum");
  await createPortableChecksum(artifactPath, checksumPath);
  await writeFile(artifactPath, "tampered\n");

  await assert.rejects(verifyPortableChecksum(checksumPath), /mismatch/i);
});

test("refuses to create a non-portable checksum away from its artifact", async (t) => {
  const { artifactPath, elsewhere } = await fixture(t);
  const createPortableChecksum = api("createPortableChecksum");

  await assert.rejects(
    createPortableChecksum(artifactPath, join(elsewhere, "release.sha256")),
    /same directory|portable/i,
  );
});
