# iLlama 3.2.0 Release Checklist

Target: GitHub Release containing an ad-hoc signed, unnotarized macOS Apple
Silicon DMG. Windows and Linux are test-only targets.

## Repository and automated gates

- [ ] All repository versions resolve to `3.2.0`
- [ ] Tag is exactly `v3.2.0-rc.1` or `v3.2.0` and belongs to protected `main`
- [ ] `src-tauri/binaries/` contains only `.gitkeep`
- [ ] `node scripts/verify-release-workflow.mjs`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test:ui`
- [ ] `npm run test:native-controller`
- [ ] `npm run test:release-policy`
- [ ] `npm run test:release-evidence`
- [ ] `npm run check:project`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [ ] `npm audit --audit-level=high` and `npm audit --omit=dev`
- [ ] Fresh `cargo audit --json --file src-tauri/Cargo.lock` passes

## Real application evidence

- [ ] Configure `ACCEPTANCE_LLAMA_SERVER_PATHS` and
  `ACCEPTANCE_LLAMA_MODEL_PATH` in `macos-release`
- [ ] Dispatch `Release acceptance evidence` / `llama-matrix` from the exact tag
- [ ] Run `npm run release:llama-matrix` against every supplied server
- [ ] Confirm scan → start → health → models → non-stream/SSE chat → cancel → stop
- [ ] Confirm slow-load downgrade/recovery, occupied-port recovery, structured
  errors, active-vs-draft isolation, invalid/limited GGUF, and unsupported flags
- [ ] Dispatch `Release acceptance evidence` / `external-client` from the same tag
- [ ] Confirm the executable `curl` path, version, checksum, model ID, stream
  completion, cancellation, and transcript hash are recorded
- [ ] Retain both exact run/attempt-bound evidence artifacts

## GitHub configuration

- [ ] `macos-release` has the sole maintainer as a self-approving reviewer
- [ ] Environment administrator bypass is disabled
- [ ] Environment tag policies are exactly `v3.2.0-rc.1` and `v3.2.0`
- [ ] Main requires strict automated checks, but no PR approval or review-thread gate
- [ ] Force pushes and branch deletion remain disabled
- [ ] Infrastructure audit reports no configuration, lineage, CI, or evidence error

No Developer ID certificate, Apple ID, app-specific password, team ID, signing
keychain password, notarization profile, or infrastructure-audit secret is
required.

## Build and publish

- [ ] Dispatch `Release 3.2.0` from the exact tag with the CI, `llama-matrix`,
  and `external-client` run IDs
- [ ] GitHub-hosted runner reports `arm64`
- [ ] `ILLAMA_UNSIGNED_RELEASE=1 npm run release:macos` succeeds
- [ ] DMG contains exactly one `iLlama.app`, with arm64 executable and macOS 11.0 minimum
- [ ] App has a valid ad-hoc signature and no Developer ID authority
- [ ] DMG mounts read-only and the packaged app starts through LaunchServices
- [ ] `iLlama_3.2.0_aarch64.dmg.sha256` verifies portably
- [ ] RC is a prerelease; final is marked latest
- [ ] GitHub Release contains only the DMG and checksum
- [ ] Release notes state that the DMG is unnotarized and explain Finder 右键 → “打开”

## Hard blockers

Do not publish when any of these is true:

- tag/SHA/ref, required CI, matrix, or external-client evidence does not match;
- DMG checksum, mount, bundle, architecture, deployment target, or launch fails;
- a bundled/downloaded `llama-server` is present;
- a high/critical npm advisory, production vulnerability, RustSec vulnerability,
  or unreviewed/expired informational advisory remains;
- version, tag, artifact name, or release notes disagree.

Developer ID signing, Apple notarization, staple validation, and Gatekeeper
acceptance are intentionally outside this GitHub-only release policy. Users who
are blocked on first launch must use Finder 右键 → “打开”.
