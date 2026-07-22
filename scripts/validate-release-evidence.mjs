#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateReleaseEvidence } from "./lib/release-evidence.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  const evidence = JSON.parse(await readFile(options.evidence, "utf8"));
  await validateReleaseEvidence(evidence, options);
  console.log(
    `Verified ${options.type} evidence for ${options.headSha} ` +
    `(run ${options.runId}, attempt ${options.runAttempt}).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = { artifacts: {} };
  const names = new Map([
    ["--evidence", "evidence"],
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
  for (const [flag, name] of names) {
    if (!values[name]) throw usage(`missing ${flag}`);
  }
  return values;
}

function usage(message) {
  return new Error([
    message,
    "usage: validate-release-evidence.mjs --evidence FILE --type TYPE --report FILE",
    "  --head-sha SHA --workflow-path PATH --run-id ID --run-attempt N",
    "  --repository OWNER/REPO --artifact NAME=PATH [--artifact NAME=PATH ...]",
  ].join("\n"));
}
