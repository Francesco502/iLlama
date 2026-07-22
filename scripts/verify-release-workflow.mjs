import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
const acceptanceWorkflow = readFileSync(
  join(root, ".github/workflows/release-acceptance.yml"),
  "utf8",
);
const releaseScript = readFileSync(join(root, "scripts/release-macos.mjs"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const releaseStrategy = readFileSync(join(root, "docs/release-strategy.md"), "utf8");
const releaseChecklist = readFileSync(join(root, "docs/release-checklist.md"), "utf8");
const compatibility = readFileSync(join(root, "docs/client-compatibility.md"), "utf8");
const releaseNotes = readFileSync(join(root, "docs/releases/v3.2.0.md"), "utf8");

const failures = [];

function requireText(source, label, text) {
  if (!source.includes(text)) failures.push(`${label} is missing ${JSON.stringify(text)}`);
}

function rejectText(source, label, text) {
  if (source.includes(text)) failures.push(`${label} must not contain ${JSON.stringify(text)}`);
}

for (const text of [
  "workflow_dispatch:",
  "- v3.2.0-rc.1",
  "- v3.2.0",
  "github-release:",
  "environment: macos-release",
  "runs-on: macos-15",
  "contents: write",
  'ILLAMA_UNSIGNED_RELEASE: "1"',
  "ci_run_id",
  "llama_matrix_run_id",
  "external_client_run_id",
  'validate_run "$CI_RUN_ID" ".github/workflows/ci.yml" push "$RELEASE_TAG"',
  "verify_evidence llama-matrix",
  "verify_evidence external-client",
  "validate-release-evidence.mjs",
  "npm run check:project",
  "npm run test:release-policy",
  "npm run test:release-evidence",
  "npm run test:tauri -- --surface deep-runner",
  "cargo audit --json --file src-tauri/Cargo.lock",
  "portable-checksum.mjs verify",
  "hdiutil attach",
  "-readonly",
  "realpathSync",
  "CFBundleExecutable",
  "Signature=adhoc",
  "open -n",
  "github-release-dmg-${{ env.TAGGED_SHA }}-${{ github.run_id }}-${{ github.run_attempt }}",
  "prerelease: true",
  "prerelease: false",
]) {
  requireText(workflow, "release workflow", text);
}

for (const forbidden of [
  "signed-release",
  "unsigned-artifact",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "RELEASE_INFRASTRUCTURE_AUDIT_TOKEN",
  "notarytool",
  "stapler",
  "spctl --assess",
  "clean_mac_run_id",
  "rc_release_run_id",
  "accepted_rc_sha256",
]) {
  rejectText(workflow, "release workflow", forbidden);
}

rejectText(workflow, "release workflow", "push:\n    tags:");
rejectText(workflow, "release workflow", "gh release download v3.2.0-rc.1");
requireText(
  workflow,
  "release workflow",
  "uses: taiki-e/install-action@43aecc8d72668fbcfe75c31400bc4f890f1c5853",
);
requireText(workflow, "release workflow", "cargo-audit@0.22.2");
rejectText(workflow, "release workflow", "cargo install cargo-audit");

const releaseActionCount = workflow.match(
  /uses: softprops\/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65/g,
)?.length ?? 0;
if (releaseActionCount !== 2) {
  failures.push(`release workflow must have exactly two GitHub publish actions; found ${releaseActionCount}`);
}

for (const text of [
  "workflow_dispatch:",
  "options: [llama-matrix, external-client]",
  "runs-on: [self-hosted, macOS, ARM64]",
  "environment: macos-release",
  "ACCEPTANCE_LLAMA_SERVER_PATHS",
  "ACCEPTANCE_LLAMA_MODEL_PATH",
  "release:llama-matrix",
  "native-tauri-acceptance.mjs",
  "external-client-curl.mjs",
  "validate-release-evidence.mjs",
]) {
  requireText(acceptanceWorkflow, "acceptance workflow", text);
}

for (const forbidden of [
  "clean-mac",
  "APPLE_TEAM_ID",
  "EXTERNAL_CLIENT_RESULT",
  "signed RC",
  "stapler",
  "spctl",
  "codesign",
]) {
  rejectText(acceptanceWorkflow, "acceptance workflow", forbidden);
}

for (const text of [
  'ILLAMA_UNSIGNED_RELEASE === "1"',
  'signingIdentity: "-"',
  "hardenedRuntime: false",
  "Unnotarized GitHub Release DMG built at",
  "generateAndVerifyChecksum();",
]) {
  requireText(releaseScript, "release script", text);
}

for (const [label, source] of [
  ["README", readme],
  ["changelog", changelog],
  ["release strategy", releaseStrategy],
  ["release checklist", releaseChecklist],
  ["release notes", releaseNotes],
]) {
  requireText(source, label, "3.2.0");
  requireText(source, label, "右键");
}

requireText(readme, "README", "macOS Apple Silicon");
requireText(releaseStrategy, "release strategy", "macos-release");
requireText(releaseChecklist, "release checklist", "release:llama-matrix");
requireText(compatibility, "compatibility matrix", "/v1/models");
requireText(compatibility, "compatibility matrix", "Verified");

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("3.2.0 unsigned GitHub DMG release workflow policy verified.");
