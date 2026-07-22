import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
const acceptanceWorkflow = readFileSync(
  join(root, ".github/workflows/release-acceptance.yml"),
  "utf8",
);
const releaseScript = readFileSync(join(root, "scripts/release-macos.mjs"), "utf8");
const releaseChain = readFileSync(
  join(root, "scripts/lib/macos-release-chain.mjs"),
  "utf8",
);
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
requireText(workflow, "release workflow", "Block release without every signing, notarization, and audit credential");

for (const secret of [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "RELEASE_INFRASTRUCTURE_AUDIT_TOKEN",
]) {
  requireText(workflow, "release workflow", `secrets.${secret}`);
}

for (const command of [
  "codesign --verify",
  "notarytool store-credentials",
  "stapler validate",
  "spctl --assess",
  "portable-checksum.mjs verify",
  "rc-artifact-provenance.mjs",
]) {
  requireText(workflow, "release workflow", command);
}

requireText(workflow, "release workflow", "ci_run_id");
requireText(workflow, "release workflow", "llama_matrix_run_id");
requireText(workflow, "release workflow", "external_client_run_id");
requireText(workflow, "release workflow", "clean_mac_run_id");
requireText(workflow, "release workflow", "rc_release_run_id");
requireText(workflow, "release workflow", "accepted_rc_sha256");
requireText(workflow, "release workflow", "validate-release-evidence.mjs");
requireText(workflow, "release workflow", ".github/workflows/ci.yml");
requireText(workflow, "release workflow", ".github/workflows/release-acceptance.yml");
requireText(workflow, "release workflow", "npm run check:project");
requireText(workflow, "release workflow", "npm run test:release-policy");
requireText(workflow, "release workflow", "npm run test:release-evidence");
requireText(workflow, "release workflow", "release-infrastructure.mjs");
requireText(workflow, "release workflow", 'GH_TOKEN: ${{ secrets.RELEASE_INFRASTRUCTURE_AUDIT_TOKEN }}');
requireText(workflow, "release workflow", 'cargo audit --json --file src-tauri/Cargo.lock');
requireText(workflow, "release workflow", 'verify-project-policy.mjs --audit');
requireText(
  workflow,
  "release workflow",
  "taiki-e/install-action@43aecc8d72668fbcfe75c31400bc4f890f1c5853",
);
requireText(workflow, "release workflow", "cargo-audit@0.22.2");
requireText(workflow, "release workflow", "fallback: none");
rejectText(workflow, "release workflow", "cargo install cargo-audit");
const chromiumInstallCount = workflow.match(/run: npx playwright install chromium/g)?.length ?? 0;
if (chromiumInstallCount !== 2) {
  failures.push(
    `release workflow must install Playwright Chromium in signed and unsigned jobs; found ${chromiumInstallCount}`,
  );
}
rejectText(workflow, "release workflow", "gh release download v3.2.0-rc.1");
rejectText(workflow, "release workflow", '--artifact "curl=/usr/bin/curl"');
rejectText(workflow, "release workflow", "${ACCEPTED_RC_SHA256,,}");
rejectText(acceptanceWorkflow, "acceptance workflow", "${ACCEPTED_RC_SHA256,,}");
requireText(workflow, "release workflow", '[[ "$ACCEPTED_RC_SHA256" =~ ^[0-9a-f]{64}$ ]]');
requireText(
  acceptanceWorkflow,
  "acceptance workflow",
  '[[ "$ACCEPTED_RC_SHA256" =~ ^[0-9a-f]{64}$ ]]',
);
requireText(workflow, "release workflow", 'gh run download "$RC_RELEASE_RUN_ID"');
requireText(workflow, "release workflow", "signed-rc-${{ env.TAGGED_SHA }}-${{ github.run_id }}-${{ github.run_attempt }}");
requireText(workflow, "release workflow", "validate-workflow-run.mjs");
requireText(workflow, "release workflow", '--head-branch "$expected_head_branch"');
requireText(
  workflow,
  "release workflow",
  'validate_run "$CI_RUN_ID" ".github/workflows/ci.yml" push "$RELEASE_TAG"',
);
requireText(
  workflow,
  "release workflow",
  '"$RC_RELEASE_RUN_ID" ".github/workflows/release.yml" workflow_dispatch v3.2.0-rc.1',
);
requireText(acceptanceWorkflow, "acceptance workflow", "validate-workflow-run.mjs");
requireText(acceptanceWorkflow, "acceptance workflow", "--head-branch v3.2.0-rc.1");
rejectText(workflow, "release workflow", "verify_run()");
rejectText(workflow, "release workflow", 'attempt="$(verify_run');
requireText(workflow, "release workflow", '|| return 1');
requireText(workflow, "release workflow", "workflow_dispatch");
for (const flag of [
  "--report",
  "--head-sha",
  "--workflow-path",
  "--run-id",
  "--run-attempt",
  "--repository",
]) {
  requireText(workflow, "release workflow", flag);
}
requireText(workflow, "release workflow", "prerelease: true");
requireText(workflow, "release workflow", "prerelease: false");
requireText(
  workflow,
  "release workflow",
  "uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
);
requireText(workflow, "release workflow", "if: inputs.mode == 'unsigned-artifact'");
requireText(workflow, "release workflow", "if: inputs.mode == 'signed-release'");

const releaseActionCount = workflow.match(
  /uses: softprops\/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65/g,
)?.length ?? 0;
if (releaseActionCount !== 2) {
  failures.push(`release workflow must have exactly two signed publish actions; found ${releaseActionCount}`);
}

const unsignedJob = workflow.split("  unsigned-artifact:")[1] ?? "";
rejectText(unsignedJob, "unsigned artifact job", "softprops/action-gh-release");
rejectText(unsignedJob, "unsigned artifact job", "contents: write");
requireText(unsignedJob, "unsigned artifact job", 'ILLAMA_UNSIGNED_RELEASE: "1"');

requireText(releaseScript, "release script", "ensureAppleSiliconBuildHost");
requireText(releaseScript, "release script", "ensureExternalLlamaServerStrategy");
requireText(releaseScript, "release script", "packageSignedMacRelease");
requireText(releaseScript, "release script", '"--bundles",');
requireText(releaseScript, "release script", '"app",');
requireText(releaseChain, "signed release chain", 'run("codesign", ["--verify"');
requireText(releaseChain, "signed release chain", '"notarytool",');
requireText(releaseChain, "signed release chain", 'run("xcrun", ["stapler", "staple"');
requireText(releaseChain, "signed release chain", 'run("spctl", [');
requireText(releaseChain, "signed release chain", 'run("hdiutil", [');
requireText(releaseChain, "signed release chain", '"--keepParent"');
requireText(releaseChain, "signed release chain", "TeamIdentifier");
requireText(releaseChain, "signed release chain", "hardened runtime");
requireText(releaseChain, "signed release chain", '"--identifier"');
requireText(releaseScript, "release script", "generateAndVerifyChecksum();");
requireText(releaseScript, "release script", "scripts/lib/portable-checksum.mjs");
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

requireText(acceptanceWorkflow, "acceptance workflow", "workflow_dispatch:");
requireText(acceptanceWorkflow, "acceptance workflow", "runs-on: macos-15");
requireText(acceptanceWorkflow, "acceptance workflow", "runs-on: [self-hosted, macOS, ARM64]");
requireText(acceptanceWorkflow, "acceptance workflow", "environment: macos-release");
rejectText(acceptanceWorkflow, "acceptance workflow", "EXTERNAL_CLIENT_RESULT");
rejectText(acceptanceWorkflow, "acceptance workflow", "EXTERNAL_CLIENT_RESULT_JSON");
rejectText(acceptanceWorkflow, "acceptance workflow", "gh release download v3.2.0-rc.1");
for (const command of [
  '[[ "$(uname -m)" == "arm64" ]]',
  'gh run download "$RC_RELEASE_RUN_ID"',
  "rc-artifact-provenance.mjs validate",
  "hdiutil attach",
  "-readonly",
  "-nobrowse",
  "codesign --verify --deep --strict --verbose=2",
  "TeamIdentifier",
  "flags=.*runtime",
  "spctl --status",
  "assessments enabled",
  "stapler validate",
  "spctl --assess --type execute",
  "native-tauri-acceptance.mjs",
  "external-client-curl.mjs",
  "create-clean-mac-report.mjs",
  "--launch-via-open",
  "hdiutil detach",
  "if: always()",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_REPOSITORY",
  "signed-rc-${TAGGED_SHA}-${RC_RELEASE_RUN_ID}-${RC_RUN_ATTEMPT}",
  'select(."mount-point" == $mount)',
  "hdiutil-attach.plist",
]) {
  requireText(acceptanceWorkflow, "acceptance workflow", command);
}
for (const rawEvidenceName of [
  "codesignDetails",
  "codesignVerify",
  "hdiutilAttach",
  "spctlApp",
  "spctlDmg",
  "staplerApp",
  "staplerDmg",
]) {
  requireText(acceptanceWorkflow, "acceptance workflow", rawEvidenceName);
  requireText(workflow, "release workflow", rawEvidenceName);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("3.2.0 release workflow policy verified.");
