# iLlama 3.2.0 Release Strategy

## Supported release target

iLlama 3.2.0 is formally distributed only as a macOS Apple Silicon DMG. The
release workflow uses an `arm64` macOS runner and refuses to continue on another
architecture.

Windows remains a compile, test, and preview target in CI. A Windows installer
must not be attached to either `v3.2.0-rc.1` or `v3.2.0`. Linux is a CI build and
test target only.

## External llama-server policy

The app never bundles or downloads `llama-server`. Users install a compatible
binary themselves or select an existing executable. The release helper refuses
to build when `src-tauri/binaries/` contains anything except `.gitkeep`.

This avoids distributing a Homebrew binary whose dynamic libraries remain under
`/opt/homebrew`. Do not add a sidecar without a separate portability, licensing,
code-signing, notarization, and clean-machine review.

## Protected manual release

`.github/workflows/release.yml` has no tag-push trigger. A maintainer manually
selects one of exactly two tags:

- `v3.2.0-rc.1`, published as a prerelease;
- `v3.2.0`, published as the latest release only after clean-machine acceptance.

The signed job uses the `macos-release` GitHub Environment. Configure required
reviewers and restrict deployment branches/tags for that environment in the
repository settings. The workflow additionally requires links or run IDs for the
real GGUF matrix and external-client acceptance. The final tag also requires a
clean Apple Silicon Mac acceptance record.

The tag must already point at the checked-out commit, and npm, Tauri, and Cargo
metadata must all be `3.2.0`. Release notes come from
`docs/releases/v3.2.0.md`.

## Signing and notarization credentials

Store these secrets in the protected `macos-release` Environment, not as values
in the repository:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`;
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12`;
- `APPLE_KEYCHAIN_PASSWORD`: ephemeral CI keychain password;
- `APPLE_ID`: notarization Apple ID;
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password;
- `APPLE_TEAM_ID`: Apple Developer team ID.

The workflow validates every value before checkout or build. A missing
certificate, identity, password, team ID, or working notary profile is a release
blocker. It is never converted into an unsigned public release.

The trusted path performs:

1. frontend, UI, Rust, dependency, and release-policy checks;
2. Developer ID import into an ephemeral keychain;
3. hardened-runtime Tauri build;
4. `codesign --verify` on the `.app`;
5. `notarytool submit --wait` on the DMG;
6. `stapler staple` and `stapler validate`;
7. `spctl` assessment for the app and DMG;
8. SHA-256 generation and verification;
9. prerelease or final GitHub Release creation.

The CI keychain is deleted even if the job fails.

## Unsigned diagnostic artifacts

The same manual workflow offers `unsigned-artifact`. It uses ad-hoc signing only,
expects Gatekeeper assessment to fail, creates a checksum, and uploads a workflow
artifact with seven-day retention. The job has read-only repository permissions
and contains no GitHub Release action.

For a local diagnostic build on Apple Silicon:

```bash
ILLAMA_UNSIGNED_RELEASE=1 npm run release:macos
```

The older misspelled `ILLLAMA_UNSIGNED_RELEASE` variable remains temporarily
accepted for compatibility, but new automation must use `ILLAMA_UNSIGNED_RELEASE`.
Unsigned artifacts are never suitable for public Release distribution.

## Acceptance evidence

Before dispatching the signed job, archive evidence for:

- `npm test`, `npm run lint`, `npm run build`, and `npm run test:ui`;
- `cargo test`, formatting, clippy, RustSec, and npm audit gates;
- `npm run release:llama-matrix` against a real external `llama-server` and GGUF;
- GGUF scan → start → health → `/v1/models` → chat → stop;
- at least one external client, including its exact version and model ID;
- final-only acceptance on a clean Apple Silicon Mac;
- checksum verification after downloading the published DMG.

See `docs/release-checklist.md` for the operator checklist and blocking rules.
