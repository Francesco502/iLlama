#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, rename, stat, writeFile, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/i;

export async function sha256File(path) {
  const file = await stat(path);
  if (!file.isFile()) throw new Error(`checksum source is not a file: ${path}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function parsePortableChecksum(contents) {
  if (typeof contents !== "string") throw new Error("checksum contents must be text");
  const match = contents.match(/^([0-9a-fA-F]{64}) {2}([^\r\n]+)\n?$/);
  if (!match) {
    throw new Error("checksum must contain exactly one '<SHA-256>  <basename>' entry");
  }
  const digest = match[1].toLowerCase();
  const filename = match[2];
  if (
    !DIGEST_PATTERN.test(digest) ||
    !filename ||
    filename !== filename.trim() ||
    filename === "." ||
    filename === ".." ||
    isAbsolute(filename) ||
    basename(filename) !== filename ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    throw new Error("checksum filename must be one safe basename");
  }
  return { digest, filename };
}

export function formatPortableChecksum(digest, filename) {
  const entry = parsePortableChecksum(`${digest}  ${filename}\n`);
  return `${entry.digest}  ${entry.filename}\n`;
}

export async function createPortableChecksum(artifactPath, checksumPath = `${artifactPath}.sha256`) {
  const artifact = resolve(artifactPath);
  const checksum = resolve(checksumPath);
  if (resolve(dirname(artifact)) !== resolve(dirname(checksum))) {
    throw new Error("portable checksum must be written in the same directory as its artifact");
  }
  const digest = await sha256File(artifact);
  const filename = basename(artifact);
  const contents = formatPortableChecksum(digest, filename);
  const temporary = `${checksum}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { flag: "wx" });
  await rename(temporary, checksum);
  return { artifactPath: artifact, checksumPath: checksum, digest, filename };
}

export async function verifyPortableChecksum(checksumPath) {
  const checksum = resolve(checksumPath);
  const entry = parsePortableChecksum(await readFile(checksum, "utf8"));
  const checksumDirectory = await realpath(dirname(checksum));
  const artifactPath = join(checksumDirectory, entry.filename);
  const artifactRealPath = await realpath(artifactPath);
  if (dirname(artifactRealPath) !== checksumDirectory) {
    throw new Error("checksum artifact must resolve inside the checksum file directory");
  }
  const actual = await sha256File(artifactRealPath);
  if (actual !== entry.digest) {
    throw new Error(
      `checksum mismatch for ${entry.filename}: expected ${entry.digest}, got ${actual}`,
    );
  }
  return {
    checksumPath: checksum,
    artifactPath: artifactRealPath,
    filename: entry.filename,
    digest: actual,
  };
}

async function main(argv) {
  const [command, first, second] = argv;
  if (command === "create" && first && !argv[3]) {
    const result = await createPortableChecksum(first, second ?? `${first}.sha256`);
    console.log(`Created portable SHA-256 checksum: ${result.checksumPath}`);
    return;
  }
  if (command === "verify" && first && !second) {
    const result = await verifyPortableChecksum(first);
    console.log(`Verified ${result.filename}: ${result.digest}`);
    return;
  }
  throw new Error(
    "usage: portable-checksum.mjs create <artifact> [checksum] | verify <checksum>",
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
