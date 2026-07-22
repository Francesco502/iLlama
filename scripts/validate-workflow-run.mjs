#!/usr/bin/env node
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateWorkflowRunMetadata } from "./lib/release-evidence.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  const run = JSON.parse(await readFile(resolve(options.runJson), "utf8"));
  const attempt = validateWorkflowRunMetadata(run, options);
  const output = resolve(options.attemptOutput);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${attempt}\n`, { flag: "wx" });
  try {
    await link(temporary, output);
  } finally {
    await unlink(temporary);
  }
  console.log(`Verified GitHub workflow run ${options.runId}, attempt ${attempt}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = {};
  const names = new Map([
    ["--run-json", "runJson"],
    ["--attempt-output", "attemptOutput"],
    ["--run-id", "runId"],
    ["--head-sha", "headSha"],
    ["--workflow-path", "workflowPath"],
    ["--repository", "repository"],
    ["--event", "event"],
    ["--head-branch", "headBranch"],
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
    if (flag !== "--event" && !values[name]) throw usage(`missing ${flag}`);
  }
  return values;
}

function usage(message) {
  return new Error([
    message,
    "usage: validate-workflow-run.mjs --run-json FILE --attempt-output FILE",
    "  --run-id ID --head-sha SHA --workflow-path PATH --repository OWNER/REPO",
    "  --head-branch TAG [--event EVENT]",
  ].join("\n"));
}
