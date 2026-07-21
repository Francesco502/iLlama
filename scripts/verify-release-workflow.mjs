import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
const releaseScript = readFileSync(join(root, "scripts/release-macos.mjs"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const releaseStrategy = readFileSync(join(root, "docs/release-strategy.md"), "utf8");
const releaseChecklist = readFileSync(join(root, "docs/release-checklist.md"), "utf8");
const compatibility = readFileSync(join(root, "docs/client-compatibility.md"), "utf8");
const releaseNotes = readFileSync(join(root, "docs/releases/v3.2.0.md"), "utf8");

const failures = [];

function requireText(source, label, text) {
  if (!source.includes(text)) {
    failures.push(`${label} is missing ${JSON.stringify(text)}`);
  }
}

function rejectText(source, label, text) {
  if (source.includes(text)) {
    failures.push(`${label} must not contain ${JSON.stringify(text)}`);
  }
}

requireText(workflow, "release workflow", "workflow_dispatch:");
rejectText(workflow, "release workflow", "push:\n    tags:");
requireText(workflow, "release workflow", "- v3.2.0-rc.1");
requireText(workflow, "release workflow", "- v3.2.0");
requireText(workflow, "release workflow", "environment: macos-release");
requireText(workflow, "release workflow", "runs-on: macos-15");
requireText(workflow, "release workflow", '[[ "$(uname -m)" == "arm64" ]]');
requireText(workflow, "release workflow", "Block release without every signing and notarization credential");

for (const secret of [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
]) {
  requireText(workflow, "release workflow", `secrets.${secret}`);
}

for (const command of [
  "codesign --verify",
  "notarytool store-credentials",
  "stapler validate",
  "spctl --assess",
  "shasum -a 256",
  "shasum -a 256 -c",
]) {
  requireText(workflow, "release workflow", command);
}

requireText(workflow, "release workflow", "llama_matrix_evidence");
requireText(workflow, "release workflow", "external_client_evidence");
requireText(workflow, "release workflow", "clean_mac_evidence");
requireText(workflow, "release workflow", "prerelease: true");
requireText(workflow, "release workflow", "prerelease: false");
requireText(workflow, "release workflow", "uses: actions/upload-artifact@v4");
requireText(workflow, "release workflow", "if: inputs.mode == 'unsigned-artifact'");
requireText(workflow, "release workflow", "if: inputs.mode == 'signed-release'");

const releaseActionCount = workflow.match(/uses: softprops\/action-gh-release@v2/g)?.length ?? 0;
if (releaseActionCount !== 2) {
  failures.push(`release workflow must have exactly two signed publish actions; found ${releaseActionCount}`);
}

const unsignedJob = workflow.split("  unsigned-artifact:")[1] ?? "";
rejectText(unsignedJob, "unsigned artifact job", "softprops/action-gh-release");
rejectText(unsignedJob, "unsigned artifact job", "contents: write");
requireText(unsignedJob, "unsigned artifact job", 'ILLAMA_UNSIGNED_RELEASE: "1"');

requireText(releaseScript, "release script", "ensureAppleSiliconBuildHost");
requireText(releaseScript, "release script", "ensureExternalLlamaServerStrategy");
requireText(releaseScript, "release script", 'run("codesign", ["--verify"');
requireText(releaseScript, "release script", 'run("xcrun", ["notarytool", "submit"');
requireText(releaseScript, "release script", 'run("xcrun", ["stapler", "staple"');
requireText(releaseScript, "release script", 'run("spctl", [');
requireText(releaseScript, "release script", "generateAndVerifyChecksum();");
requireText(releaseScript, "release script", 'run("npm", ["run", "test:ui"]);');

for (const [label, source] of [
  ["README", readme],
  ["changelog", changelog],
  ["release strategy", releaseStrategy],
  ["release checklist", releaseChecklist],
  ["release notes", releaseNotes],
]) {
  requireText(source, label, "3.2.0");
}

requireText(readme, "README", "macOS Apple Silicon");
requireText(releaseStrategy, "release strategy", "macos-release");
requireText(releaseStrategy, "release strategy", "unsigned-artifact");
requireText(releaseChecklist, "release checklist", "release:llama-matrix");
requireText(releaseChecklist, "release checklist", "clean Apple Silicon Mac");
requireText(compatibility, "compatibility matrix", "/v1/models");
requireText(compatibility, "compatibility matrix", "Verified");
requireText(releaseNotes, "release notes", "signed and notarized macOS Apple Silicon DMG");

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("3.2.0 release workflow policy verified.");
