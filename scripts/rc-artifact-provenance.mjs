#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createRcArtifactProvenance,
  validateRcArtifactProvenance,
} from "./lib/release-evidence.mjs";

try {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArguments(command, argv);
  if (command === "create") {
    const provenance = await createRcArtifactProvenance(options);
    await atomicWriteJson(resolve(options.output), provenance);
    console.log(`Created run-bound signed RC provenance: ${resolve(options.output)}`);
  } else {
    const provenance = JSON.parse(await readFile(options.provenance, "utf8"));
    await validateRcArtifactProvenance(provenance, options);
    console.log(
      `Verified signed RC provenance for run ${options.runId}, attempt ${options.runAttempt}.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(command, argv) {
  if (!["create", "validate"].includes(command)) throw usage("command must be create or validate");
  const values = {};
  const names = new Map([
    [command === "create" ? "--output" : "--provenance", command === "create" ? "output" : "provenance"],
    ["--dmg", "dmgPath"],
    ["--checksum", "checksumPath"],
    ["--tag", "tag"],
    ["--mode", "mode"],
    ["--head-sha", "headSha"],
    ["--workflow-path", "workflowPath"],
    ["--run-id", "runId"],
    ["--run-attempt", "runAttempt"],
    ["--repository", "repository"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    const name = names.get(flag);
    if (!name || !value) throw usage(`unknown or incomplete argument: ${flag ?? "<missing>"}`);
    if (values[name] !== undefined) throw usage(`duplicate argument: ${flag}`);
    values[name] = value;
  }
  for (const [flag, name] of names) {
    if (!values[name]) throw usage(`missing ${flag}`);
  }
  return values;
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, path);
}

function usage(message) {
  return new Error([
    message,
    "usage: rc-artifact-provenance.mjs create --output FILE | validate --provenance FILE",
    "  --dmg FILE --checksum FILE --tag v3.2.0-rc.1 --mode signed-release",
    "  --head-sha SHA --workflow-path .github/workflows/release.yml",
    "  --run-id ID --run-attempt N --repository OWNER/REPO",
  ].join("\n"));
}
