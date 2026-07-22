# iLlama 3.2.0 Release Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace simulated or forgeable release gates with native Tauri, application-level GGUF, external-client, clean-Mac, signing, and provenance checks while making runtime configuration and settings recovery truthful.

**Architecture:** A native acceptance mode runs inside the packaged Tauri WebView and exercises the public IPC commands against an injected external `llama-server`; a Node controller builds/launches the app, coordinates a real versioned external client, and produces a structured report. Release workflows consume those reports as SHA- and run-bound artifacts, while the runtime snapshot represents explicit arguments separately from unknown server defaults.

**Tech Stack:** Tauri 2, Rust, React/TypeScript, Vitest, Playwright, Node.js 22, GitHub Actions, macOS codesign/notarytool/stapler/spctl.

## Global Constraints

- Formal release target is macOS Apple Silicon 11.0 or newer; Windows remains compile/test/preview only.
- `llama-server` remains external and is never bundled or downloaded by iLlama.
- A release report must come from executable checks against the exact tagged SHA; user-entered text or JSON is not evidence.
- Native acceptance must cover WebView, Tauri IPC, application GGUF scanning, capability-filtered CommandSpec, start, health downgrade/recovery, `/v1/models`, chat, cancellation, stop, and a structured recovery action.
- `activeLaunch` must never invent an effective value when a flag was omitted; omitted values are represented as `serverDefault`.
- Signed RC/final releases require Developer ID, hardened runtime, notarization, staple, Gatekeeper, portable SHA-256 verification, and protected environment approval.
- Clean-Mac acceptance runs on an ephemeral GitHub-hosted `macos-15` arm64 runner and tests the downloaded RC app from the mounted DMG.
- Missing Apple credentials, model/server acceptance inputs, or repository protection must fail closed.

---

### Task 1: Truthful runtime parameters and settings recovery

**Files:**
- Modify: `src-tauri/src/parameters.rs`
- Modify: `src-tauri/src/llama_process.rs`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api/tauri.ts`
- Modify: `src/lib/launchDraft.ts`
- Modify: `src/App.tsx`
- Test: `src-tauri/tests/llama_process_tests.rs`
- Test: `src-tauri/tests/settings_tests.rs`
- Test: `src/lib/launchDraft.test.ts`
- Test: `src/App.test.tsx` or a focused settings-warning component test

**Interfaces:**
- Produce `AppliedParameter<T> = { source: "argument", value: T } | { source: "serverDefault", value: null }` and `ResolvedStartupParameters` for every startup field.
- `ActiveLaunchSnapshot.parameters` becomes `ResolvedStartupParameters`; `commandArgs` is required and remains the exact argv.
- Produce `mergeResolvedStartupParameters(draft, resolved)`; only `argument` values overwrite the draft.
- Add `SettingsWarning.recoveryTarget: string | null` and `reveal_settings_backup_command(path)` restricted to timestamped backups in the app-data directory.

- [ ] Write regression tests proving omitted `--ctx-size`, mmap, Flash Attention, and metrics are `serverDefault`, never hard-coded values; run the focused Rust tests and confirm the old implementation fails.
- [ ] Implement `AppliedParameter`/`ResolvedStartupParameters` and resolve each field from the exact CommandSpec plus capabilities.
- [ ] Write frontend tests proving draft comparison and restore use explicit arguments only and retain draft values for server defaults; confirm failure before implementation.
- [ ] Implement the frontend merge/comparison behavior and show the number of server-default fields without claiming their values.
- [ ] Write settings tests proving corrupt recovery includes a canonical recovery target and paths outside app data are rejected; confirm failure.
- [ ] Implement the validated Finder/Explorer reveal command and route the settings warning button through its `recoveryAction` and `recoveryTarget`.
- [ ] Run focused Rust and Vitest suites, then review the complete task diff.

### Task 2: Native Tauri acceptance harness and application-level GGUF matrix

**Files:**
- Create: `src-tauri/src/acceptance.rs`
- Create: `src/acceptance/nativeAcceptance.ts`
- Create: `src/acceptance/NativeAcceptanceView.tsx`
- Create: `scripts/native-tauri-acceptance.mjs`
- Create: `scripts/fixtures/fake-llama-server.mjs`
- Create: `scripts/lib/gguf-fixture.mjs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/api/tauri.ts`
- Modify: `src/main.tsx`
- Modify: `scripts/real-smoke-matrix.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Test: `src-tauri/tests/acceptance_tests.rs`
- Test: `src/acceptance/nativeAcceptance.test.ts`
- Replace: `src/lib/realSmokeMatrix.test.ts`

**Interfaces:**
- `native_acceptance_config_command() -> Option<NativeAcceptanceConfig>` reads only `ILLAMA_ACCEPTANCE_*` environment variables when `ILLAMA_ACCEPTANCE_MODE=1`.
- `write_native_acceptance_report_command(report)` atomically writes only to the configured report path; `finish_native_acceptance_command(report, exitCode)` writes then exits the app.
- The report schema is `{ schemaVersion: 1, kind: "native-tauri", status, appVersion, steps, scan, commandSpec, activeLaunch, modelId, chat, cancellation, recovery, externalClient? }`.
- `scripts/native-tauri-acceptance.mjs` accepts `--app`, `--binary`, `--model`, `--report`, `--external-client`, and `--launch-via-open`; it builds once only when `--app` is absent.

- [ ] Write failing Rust tests for acceptance-mode gating, report-path restriction, atomic writes, and exit-code validation.
- [ ] Write failing TypeScript tests for the exact scan/probe/spec/occupied-port recovery/start/poll/models/chat/abort/stop sequence.
- [ ] Implement the backend acceptance commands and a minimal native acceptance view that runs only inside real Tauri.
- [ ] Create a structurally valid GGUF fixture generator based on the production scanner contract and a fake executable server supporting version/help/health/models/SSE chat/slow cancellation/exit.
- [ ] Implement the Node controller and make it reject browser-preview reports, missing IPC steps, fabricated PID 1, absent cancellation, or residual child processes.
- [ ] Replace the real matrix header check/direct spawn with launches of the actual Tauri app for each binary and model; retain a structured per-binary report including binary version/SHA-256 and model SHA-256.
- [ ] Change CI `tauri-contract` to run the native packaged-app acceptance on macOS and keep Rust integration tests as a separately named contract job.
- [ ] Prove RED then GREEN with the focused tests and a local packaged Tauri run.

### Task 3: Non-forgeable external-client and clean-Mac release evidence

**Files:**
- Create: `scripts/external-client-curl.mjs`
- Create: `scripts/lib/release-evidence.mjs`
- Create: `scripts/lib/portable-checksum.mjs`
- Modify: `scripts/create-release-evidence.mjs`
- Modify: `scripts/validate-release-evidence.mjs`
- Modify: `scripts/validate-external-client-evidence.mjs`
- Modify: `scripts/release-macos.mjs`
- Modify: `.github/workflows/release-acceptance.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/verify-release-workflow.mjs`
- Test: `scripts/tests/release-evidence.test.mjs`
- Test: `scripts/tests/portable-checksum.test.mjs`

**Interfaces:**
- External-client evidence is produced only by executing a discovered `curl` binary and records executable path/SHA-256, exact `curl --version`, models response, non-stream chat, SSE streaming, cancellation signal, endpoint, detected model ID, tagged SHA, run ID, run attempt, and transcript SHA-256.
- Evidence manifests bind `type`, `headSha`, `workflowPath`, `runId`, `runAttempt`, `repository`, `reportSha256`, relevant binary/model/DMG checksums, and `status: success`.
- Portable checksum files contain `SHA256  basename` and are verified with the checksum file directory as cwd.

- [ ] Write tests that reject the previous arbitrary JSON secret, mismatched run metadata, changed reports, missing streaming/cancellation, and path-dependent checksum files; confirm all fail against the old scripts.
- [ ] Implement the evidence schema/validators and have the native controller coordinate real curl while the iLlama-started service is healthy.
- [ ] Remove `EXTERNAL_CLIENT_RESULT_JSON` completely; the acceptance workflow must run the external client and upload its report.
- [ ] Split acceptance jobs: real-model/self-hosted for matrix where required, and ephemeral GitHub-hosted `macos-15` for clean-Mac.
- [ ] For clean-Mac, download RC DMG/checksum, verify portably, mount read-only, verify nested app signature/TeamIdentifier/hardened runtime, run Gatekeeper, launch the mounted app through LaunchServices in native acceptance mode, repeat real GGUF and curl paths, stop, unmount, and upload the report.
- [ ] Make final promotion validate the exact clean-Mac report and accepted RC checksum before publishing.
- [ ] Run focused Node tests and static workflow validation.

### Task 4: Security record, repository bootstrap, documentation, and final verification

**Files:**
- Create: `docs/security/rustsec-3.2.0.md`
- Create: `scripts/release-infrastructure.mjs`
- Modify: `docs/client-compatibility.md`
- Modify: `docs/release-checklist.md`
- Modify: `docs/release-strategy.md`
- Modify: `docs/releases/v3.2.0.md`
- Modify: `scripts/verify-project-policy.mjs`
- Modify: `package.json`
- Test: `scripts/tests/release-infrastructure.test.mjs`

**Interfaces:**
- `release-infrastructure.mjs` defaults to read-only audit; `--apply` creates/updates `macos-release`, required reviewers/tag restrictions, and main branch protection, but never prints or invents secrets. It requires self-review prevention, no PR-review bypass actors, and canonical checks bound to GitHub Actions App ID 15368. It reports the exact missing secret names and blocks release until all six Apple credentials plus the separate read-only infrastructure-audit token exist.
- RustSec review records every allowed advisory ID, target reachability, release relevance, mitigation, owner, and re-review condition.

- [ ] Write failing tests for infrastructure audit output and fail-closed behavior when environment, reviewers, branch protection, workflow, tags, push CI, any of six Apple credentials, or the separate audit token are absent.
- [ ] Implement safe audit/apply behavior with explicit repository and reviewer inputs; secret values remain operator-supplied through `gh secret set --env`.
- [ ] Record all current RustSec warnings and make project policy verify that every allowed warning has a review entry.
- [ ] Update compatibility docs to mark only the automated, exact-version curl acceptance as verified; GUI client cards remain configuration references until separately tested.
- [ ] Rebuild the unsigned diagnostic app to prove Info.plist and Mach-O both target 11.0; do not call it a release artifact.
- [ ] Run `npm test`, lint, build, native Tauri UI, Rust tests/fmt/clippy, npm audits, cargo audit, project/workflow policy, real GGUF native matrix, signature bundle inspection, and `git diff --check`.
- [ ] Request a whole-branch code review and fix every Critical/Important finding before handoff.
