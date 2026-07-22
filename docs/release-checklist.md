# iLlama 3.2.0 Release Checklist

Formal target: macOS Apple Silicon only. Windows is preview-only and must not
produce a 3.2.0 Release asset. Every unchecked item remains a blocker unless it
is explicitly described as diagnostic-only.

## Repository and contract gates

- [ ] `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` all resolve to `3.2.0`
- [ ] Tag is exactly `v3.2.0-rc.1` or `v3.2.0` and points at the reviewed commit
- [ ] Release filenames are exactly `iLlama_3.2.0_aarch64.dmg` and
  `iLlama_3.2.0_aarch64.dmg.sha256`
- [ ] `node scripts/verify-release-workflow.mjs`
- [ ] `npm run test:release-policy`
- [ ] `npm run test:release-evidence`
- [ ] `npm run check:project` validates the static project, CSP, tracked remote
  resource policy, RustSec review structure/expiry, and current Cargo.lock hash
- [ ] Generate a fresh, no-ignore audit with
  `cargo audit --json --file src-tauri/Cargo.lock > <temporary-json>`, then run
  `node scripts/verify-project-policy.mjs --audit <temporary-json>`
- [ ] The fresh audit reports zero vulnerabilities and every informational
  warning matches the bounded review in `docs/security/rustsec-3.2.0.md`
- [ ] `src-tauri/binaries/` contains no release sidecar except `.gitkeep`
- [ ] README, changelog, compatibility matrix, release notes, and this checklist agree

`npm run check:project` deliberately performs the reproducible static half of
the RustSec gate. It does not replace the fresh JSON comparison above. A local
operator may use `node scripts/verify-project-policy.mjs --live-rustsec` instead.

## Automated verification

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test:ui`
- [ ] `npm run test:native-controller`
- [ ] `npm run test:rust-contract`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [ ] `npm audit --audit-level=high` reports no high or critical advisories
- [ ] `npm audit --omit=dev` reports zero production dependency vulnerabilities
- [ ] The exact required checks for the candidate SHA succeed on Linux, macOS,
  and Windows, including the packaged macOS Tauri WebView + IPC acceptance check

## Native real-runtime acceptance

- [ ] Set protected acceptance inputs `ACCEPTANCE_LLAMA_SERVER_PATHS` and
  `ACCEPTANCE_LLAMA_MODEL_PATH` to executable real server builds and a real GGUF
- [ ] Dispatch `Release acceptance evidence` / `llama-matrix` on a self-hosted
  Apple Silicon runner and retain its exact run-bound artifact
- [ ] Run `npm run release:llama-matrix`; cover every supplied server executable
- [ ] Launch the packaged Tauri application and exercise its real WebView/IPC
  bridge; a browser preview, fake invoke shim, or backend-only process is not
  native acceptance
- [ ] Confirm real GGUF scan -> start -> `/health` -> `/v1/models` -> non-stream
  chat -> SSE chat -> cancellation -> stop
- [ ] Confirm startup health downgrades while loading and recovers to healthy,
  and that loading remains stoppable
- [ ] Confirm structured start, health, chat, cancellation, and stop failures are
  visible and the app can recover without a stale active-runtime snapshot
- [ ] Confirm the connection and test pages use the model ID returned by `/v1/models`
- [ ] Confirm a running model A/port 8080 remains active after draft changes to
  model B/port 9090
- [ ] Confirm invalid GGUF cannot launch and limited GGUF requires a visible warning
- [ ] Confirm unsupported optional server flags are omitted from the actual command
- [ ] Confirm settings, tray choice, and log dock layout survive restart
- [ ] Confirm corrupt settings recover with a timestamped backup
- [ ] Complete the full keyboard flow at 1000x680 and 1280x720
  on a dedicated Mac without simultaneous human input. GitHub-hosted macOS
  runners gate the packaged WebView/IPC runtime through the deep runner; their
  System Events injection is not accepted as a substitute for physical-keyboard
  activation evidence.

## Executable external client

- [ ] Dispatch `Release acceptance evidence` / `external-client` for the same tag
- [ ] Confirm the native harness executes the discovered `curl` binary, rather
  than accepting a caller-supplied success result
- [ ] Record canonical binary path, binary SHA-256, exact `curl --version`, active
  endpoint, detected model ID, non-stream result, SSE `[DONE]`, and cancellation
- [ ] Retain `evidence-external-client-<HEAD_SHA>-<RUN_ID>-<RUN_ATTEMPT>` and its
  bounded transcript hash
- [ ] Keep all GUI rows in `docs/client-compatibility.md` Pending unless a future
  protected executable validator is added

## GitHub infrastructure audit

- [ ] Run the read-only audit against the exact candidate, for example:

  ```bash
  node scripts/release-infrastructure.mjs \
    --repo OWNER/REPO \
    --sha 0123456789abcdef0123456789abcdef01234567 \
    --tag v3.2.0-rc.1 \
    --reviewer-id REVIEWER_ID \
    --json
  ```

- [ ] Status is `ready`; verify default branch `main`, protected environment
  `macos-release`, exactly one self-approving maintainer reviewer, exact tag
  restrictions, all six Apple
  credential names plus `RELEASE_INFRASTRUCTURE_AUDIT_TOKEN`, branch protection,
  no independent PR-approval requirement, exact required checks
  bound to the GitHub Actions App (`app_id` 15368), default-branch workflow
  files, candidate tag/SHA,
  compare-API proof that the candidate belongs to protected `main`, a successful
  `push` CI run, and `workflow_dispatch` run-bound acceptance artifacts
- [ ] If configuration must be applied, re-run with the sole maintainer reviewer ID,
  exact required check names, `--apply`, and `--confirm-apply`; review the diff
  first because apply mode mutates repository settings, and use a separate
  short-lived Administration-write token rather than the release audit token
- [ ] Do not create tags, releases, secrets, or workflow runs with the audit tool;
  missing credentials and evidence remain external blockers

## Signed RC (`v3.2.0-rc.1`)

- [ ] Configure the sole maintainer as the required reviewer, allow self-approval,
  add the exact tag restrictions on GitHub Environment `macos-release`, and
  disable administrator bypass
- [ ] Dispatch with `Use workflow from` set to the corresponding tag. CLI:
  `gh workflow run <workflow> --ref <tag> -f tag=<tag>`
- [ ] Use CI and acceptance runs whose GitHub API `head_branch` equals the
  selected tag; a `main` run for the same SHA is not valid release evidence
- [ ] Configure the six Apple credential names and the separate least-privilege
  `RELEASE_INFRASTRUCTURE_AUDIT_TOKEN` listed in `docs/release-strategy.md`;
  verify their values without printing them
- [ ] Confirm the signed workflow's read-only infrastructure audit reports
  `ready` for the tagged SHA before it consumes acceptance evidence or signs
- [ ] Dispatch `Release 3.2.0` / `signed-release` with exact CI,
  `llama-matrix`, and `external-client` run IDs
- [ ] Workflow runs on GitHub-hosted `macos-15` and reports `arm64`
- [ ] `codesign --verify --deep --strict` succeeds for `iLlama.app`, with the
  expected TeamIdentifier and hardened-runtime flag
- [ ] The zipped signed app and the signed DMG each receive an Accepted
  `notarytool submit --wait` result
- [ ] `stapler staple` and `stapler validate` succeed for both the app and DMG
- [ ] `spctl` accepts the app and DMG with assessments enabled
- [ ] The checksum file contains exactly `<SHA256><two spaces><basename>` and
  `node scripts/lib/portable-checksum.mjs verify <checksum>` succeeds when run
  from any working directory (resolution is relative to the checksum file)
- [ ] Release is a prerelease and contains only the signed DMG and checksum

## Clean Apple Silicon Mac and final (`v3.2.0`)

- [ ] Preserve the exact signed-RC workflow artifact and provenance; do not
  rebuild the accepted DMG for final promotion
- [ ] Dispatch `Release acceptance evidence` / `clean-mac` on the ephemeral
  GitHub-hosted `macos-15` arm64 runner, bound to the signed RC run ID and
  accepted checksum
- [ ] Understand the runner boundary: it is a fresh ephemeral GitHub-hosted Mac,
  not proof for every physical Mac, historical OS, MDM policy, or upgraded user
  profile
- [ ] Download the exact run/attempt-bound RC artifact and verify provenance and
  checksum before mounting it
- [ ] Mount the DMG read-only with `hdiutil attach -readonly -nobrowse`
- [ ] Verify the nested app with deep/strict code-sign validation, expected team,
  hardened runtime, app and DMG staple validation, and Gatekeeper assessments
  while Gatekeeper is enabled
- [ ] Launch the mounted app through LaunchServices and repeat native WebView/IPC,
  real GGUF, executable curl, cancellation, recovery, and stop coverage
- [ ] Retain `evidence-clean-mac-<HEAD_SHA>-<RUN_ID>-<RUN_ATTEMPT>` plus all raw,
  hashed verification outputs
- [ ] Dispatch final `v3.2.0` with CI, matrix, external-client, clean-Mac, signed
  RC run IDs, and the accepted RC SHA-256
- [ ] Final Release is not a prerelease and contains the exact accepted RC DMG

## Deployment-target diagnostic

- [ ] In an unsigned/ad-hoc diagnostic rebuild, confirm both the application
  `Info.plist` deployment target and every release Mach-O load command resolve to
  macOS 11.0
- [ ] Record the diagnostic commands and output, but do not treat an unsigned or
  ad-hoc artifact as signing, notarization, Gatekeeper, or release evidence

## Windows preview

- [ ] Exact Windows frontend and Rust required checks pass for the candidate SHA
- [ ] Optional preview build starts/stops an external `llama-server.exe`
- [ ] Paths containing spaces and occupied-port fallback work
- [ ] No Windows installer or archive is attached to the 3.2.0 GitHub Release

## Hard blockers

Do not create a signed RC or final Release if any item below is true:

- Developer ID certificate, protected secret, acceptance input, or notarization
  credential is missing
- GitHub protection, tag policy, required-check, workflow, tag/SHA, or evidence
  audit is not `ready`
- notarization, staple validation, `codesign`, `spctl`, or portable checksum fails
- native real-GGUF matrix or executable external-client evidence is absent,
  expired, or bound to a different repository/SHA/workflow/run/attempt
- final release lacks the clean Apple Silicon Mac artifact and signed-RC provenance
- a bundled/downloaded `llama-server` is present
- a high/critical npm advisory, production npm vulnerability, or RustSec
  vulnerability remains; the 17 currently informational unmaintained/unsound
  warnings must remain explicitly reviewed and unexpired
- version, tag, evidence, provenance, or artifact names disagree

Use `unsigned-artifact` only for diagnosis. It uploads a short-lived workflow
artifact and must never create or populate a GitHub Release.
