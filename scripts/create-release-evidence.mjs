#!/usr/bin/env node
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createReleaseEvidence } from "./lib/release-evidence.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  const manifest = await createReleaseEvidence(options);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, output);
  console.log(`Created ${manifest.type} evidence manifest: ${output}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = { artifacts: {} };
  const names = new Map([
    ["--output", "output"],
    ["--type", "type"],
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
    if (flag === "--artifact") {
      if (!value) throw usage(`missing value for ${flag}`);
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) {
        throw usage("--artifact must be NAME=PATH");
      }
      const name = value.slice(0, separator);
      if (Object.hasOwn(values.artifacts, name)) throw usage(`duplicate artifact: ${name}`);
      values.artifacts[name] = value.slice(separator + 1);
      index += 1;
      continue;
    }
    const name = names.get(flag);
    if (!name || !value) throw usage(`unknown or incomplete argument: ${flag ?? "<missing>"}`);
    if (values[name] !== undefined) throw usage(`duplicate argument: ${flag}`);
    values[name] = value;
    index += 1;
  }
  for (const name of names.values()) {
    if (!values[name]) throw usage(`missing --${name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`);
  }
  return values;
}

function usage(message) {
  return new Error([
    message,
    "usage: create-release-evidence.mjs --output FILE --type TYPE --report FILE",
    "  --head-sha SHA --workflow-path PATH --run-id ID --run-attempt N",
    "  --repository OWNER/REPO --artifact NAME=PATH [--artifact NAME=PATH ...]",
  ].join("\n"));
}
