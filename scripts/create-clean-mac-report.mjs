#!/usr/bin/env node
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createCleanMacReport } from "./lib/release-evidence.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  const report = await createCleanMacReport(options);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, output);
  console.log(`Created native/curl-bound clean-Mac report: ${output}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = {};
  const checkArtifacts = {};
  const names = new Map([
    ["--output", "output"],
    ["--native-report", "nativeReportPath"],
    ["--external-report", "externalReportPath"],
    ["--rc-provenance", "rcProvenancePath"],
    ["--gatekeeper-status", "gatekeeperStatusPath"],
    ["--head-sha", "headSha"],
    ["--workflow-path", "workflowPath"],
    ["--run-id", "runId"],
    ["--run-attempt", "runAttempt"],
    ["--repository", "repository"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--check") {
      if (!value) throw usage("incomplete --check argument");
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) {
        throw usage("--check must use NAME=PATH");
      }
      const name = value.slice(0, separator);
      const path = value.slice(separator + 1);
      if (checkArtifacts[name] !== undefined) throw usage(`duplicate --check: ${name}`);
      checkArtifacts[name] = path;
      continue;
    }
    const name = names.get(flag);
    if (!name || !value) throw usage(`unknown or incomplete argument: ${flag ?? "<missing>"}`);
    if (values[name] !== undefined) throw usage(`duplicate argument: ${flag}`);
    values[name] = value;
  }
  for (const [flag, name] of names) {
    if (!values[name]) throw usage(`missing ${flag}`);
  }
  return { ...values, checkArtifacts };
}

function usage(message) {
  return new Error([
    message,
    "usage: create-clean-mac-report.mjs --output FILE --native-report FILE",
    "  --external-report FILE --rc-provenance FILE --gatekeeper-status FILE",
    "  --check NAME=PATH (repeat for every required raw verification output)",
    "  --head-sha SHA --workflow-path PATH --run-id ID --run-attempt N",
    "  --repository OWNER/REPO",
  ].join("\n"));
}
