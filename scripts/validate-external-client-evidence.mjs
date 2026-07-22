#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateExternalClientEvidence } from "./lib/release-evidence.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  const report = JSON.parse(await readFile(options.report, "utf8"));
  await validateExternalClientEvidence(report, options);
  console.log(
    `Verified executable curl evidence for ${options.headSha} ` +
    `(run ${options.runId}, attempt ${options.runAttempt}).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = { verifyCurlExecutable: false };
  const names = new Map([
    ["--report", "report"],
    ["--endpoint", "endpoint"],
    ["--head-sha", "headSha"],
    ["--workflow-path", "workflowPath"],
    ["--run-id", "runId"],
    ["--run-attempt", "runAttempt"],
    ["--repository", "repository"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--verify-curl-executable") {
      if (values.verifyCurlExecutable) throw usage(`duplicate argument: ${flag}`);
      values.verifyCurlExecutable = true;
      continue;
    }
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
  if (!values.verifyCurlExecutable) throw usage("--verify-curl-executable is required");
  return values;
}

function usage(message) {
  return new Error([
    message,
    "usage: validate-external-client-evidence.mjs --report FILE --endpoint URL",
    "  --head-sha SHA --workflow-path PATH --run-id ID --run-attempt N",
    "  --repository OWNER/REPO --verify-curl-executable",
  ].join("\n"));
}
