# iLlama 3.2.0 Release Checklist

Formal target: macOS Apple Silicon only. Windows is preview-only and must not
produce a 3.2.0 Release asset.

## Repository and contract gates

- [ ] `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` all resolve to `3.2.0`
- [ ] Tag is exactly `v3.2.0-rc.1` or `v3.2.0` and points at the reviewed commit
- [ ] Release filenames are exactly `iLlama_3.2.0_aarch64.dmg` and `.dmg.sha256`
- [ ] `node scripts/verify-release-workflow.mjs`
- [ ] `src-tauri/binaries/` contains no release sidecar except `.gitkeep`
- [ ] CSP and remote-resource checks pass
- [ ] README, changelog, compatibility matrix, release notes, and this checklist agree

## Automated verification

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test:ui`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [ ] `npm audit --audit-level=high` reports no high or critical advisories
- [ ] `npm audit --omit=dev` reports zero production dependency vulnerabilities
- [ ] `cargo audit --file src-tauri/Cargo.lock`

## Runtime acceptance

- [ ] Use a release-compatible, external `llama-server`; record its exact version
- [ ] Run `npm run release:llama-matrix` with a real GGUF and retain its report/run ID
- [ ] Confirm real GGUF scan → start → `/health` → `/v1/models` → chat → stop
- [ ] Confirm the connection and test pages use the model ID returned by `/v1/models`
- [ ] Confirm a running model A/port 8080 remains the displayed active runtime after draft changes to model B/port 9090
- [ ] Confirm a service loading beyond 120 seconds stays stoppable and later becomes healthy
- [ ] Confirm invalid GGUF cannot launch and limited GGUF requires a visible warning
- [ ] Confirm unsupported optional server flags are omitted from the actual command
- [ ] Confirm settings, tray choice, and log dock layout survive restart
- [ ] Confirm corrupt settings recover with a timestamped backup
- [ ] Complete the full keyboard flow at 1000×680 and 1280×720

## External-client compatibility

- [ ] Test at least one client listed in `docs/client-compatibility.md`
- [ ] Record client name, exact version, platform, field names, streaming result, and detected model ID
- [ ] Do not label an untested profile “verified”
- [ ] Save the acceptance record URL/run ID for the protected workflow input

## Signed RC (`v3.2.0-rc.1`)

- [ ] Configure required reviewers and tag restrictions on GitHub Environment `macos-release`
- [ ] Verify all six signing/notarization secrets listed in `docs/release-strategy.md`
- [ ] Dispatch `Release 3.2.0` with `signed-release`, real matrix evidence, and external-client evidence
- [ ] Workflow runs on `macos-15` and reports `arm64`
- [ ] `codesign --verify --deep --strict` succeeds for `iLlama.app`
- [ ] `notarytool submit --wait` returns Accepted
- [ ] `stapler staple` and `stapler validate` succeed for the DMG
- [ ] `spctl` accepts the app and DMG
- [ ] `shasum -a 256 -c` succeeds
- [ ] GitHub Release is marked prerelease and contains only the signed DMG and checksum

## Final (`v3.2.0`)

- [ ] Download the RC onto a clean Apple Silicon Mac
- [ ] Gatekeeper opens the downloaded DMG/app without bypass instructions
- [ ] Repeat the real GGUF and external-client path on that clean Mac
- [ ] Record clean-Mac evidence and all RC regressions/fixes
- [ ] Dispatch the final tag with all three evidence inputs
- [ ] Final Release is not a prerelease and checksum matches the downloaded DMG

## Windows preview

- [ ] Windows frontend and Rust CI pass
- [ ] Optional preview build starts/stops an external `llama-server.exe`
- [ ] Paths containing spaces and occupied-port fallback work
- [ ] No Windows installer or archive is attached to the 3.2.0 GitHub Release

## Hard blockers

Do not create a signed RC or final Release if any item below is true:

- Developer ID certificate, protected secret, or notarization credential is missing
- notarization, staple validation, `codesign`, `spctl`, or checksum verification fails
- real GGUF matrix or external-client evidence is absent
- final release lacks clean Apple Silicon Mac evidence
- a bundled/downloaded `llama-server` is present
- a high/critical npm advisory, production npm vulnerability, or RustSec advisory remains
- version/tag/artifact names disagree

Use `unsigned-artifact` only for diagnosis. It uploads a short-lived workflow
artifact and must never create or populate a GitHub Release.
