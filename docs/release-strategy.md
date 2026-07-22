# iLlama 3.2.0 Release Strategy

## Supported release target

iLlama 3.2.0 is formally distributed only as a signed and notarized macOS Apple
Silicon DMG. The release workflow uses a GitHub-hosted `macos-15` runner and
fails unless the build host reports `arm64`.

Windows remains a compile, test, and preview target in CI. Its exact frontend
and Rust required checks must pass for the candidate SHA, but no Windows
installer or archive may be attached to `v3.2.0-rc.1` or `v3.2.0`. Linux is a CI
build and test target only.

## External llama-server policy

The app never bundles or downloads `llama-server`. Users install a compatible
binary themselves or select an existing executable. The release helper refuses
to build when `src-tauri/binaries/` contains anything except `.gitkeep`.

This avoids distributing a Homebrew binary whose dynamic libraries remain under
`/opt/homebrew`. Do not add a sidecar without a separate portability, licensing,
code-signing, notarization, and clean-machine review.

## Protected, evidence-bound release

`.github/workflows/release.yml` has no tag-push trigger. A maintainer manually
selects one of exactly two existing tags:

- `v3.2.0-rc.1`, published as a prerelease;
- `v3.2.0`, published as latest only by promoting the exact accepted RC DMG.

For every protected release or acceptance dispatch, the workflow selector
(`Use workflow from`) must be set to the corresponding tag, not a branch. The
CLI equivalent is `gh workflow run <workflow> --ref <tag> -f tag=<tag>`.
Protected jobs fail unless the workflow run ref exactly equals
`refs/tags/<tag>`. Every supplied CI or acceptance run is independently checked
against the GitHub Actions API: its `head_branch` must equal the selected tag.
A successful `main` push for the same SHA is not valid release evidence; CI must
run again from the exact RC or final tag.

The signed job uses the `macos-release` GitHub Environment. That environment
must require reviewers and allow only the two exact release tags. Branch
protection on `main` must require the exact cross-platform CI check names and
strictly require the branch to be current. Administrators must not be allowed
to bypass the environment protection rules.

The release job accepts numeric run IDs, never free-form success assertions. It
checks that CI and protected acceptance runs succeeded for the same repository,
workflow path, exact tagged SHA, and selected tag ref (`head_branch`). Evidence
is downloaded by the exact name
`evidence-<TYPE>-<HEAD_SHA>-<RUN_ID>-<RUN_ATTEMPT>` and rejected when absent or
expired. The RC requires `llama-matrix` and `external-client`; final additionally
requires `clean-mac`, the signed-RC release run, and the accepted RC SHA-256.

## Acceptance architecture

Real-model acceptance uses protected inputs named
`ACCEPTANCE_LLAMA_SERVER_PATHS` and `ACCEPTANCE_LLAMA_MODEL_PATH`. These are
external operational inputs, not Apple credentials. A self-hosted Apple Silicon
runner supplies the real executable(s) and GGUF for the matrix and executable
external-client gates.

The matrix runs the packaged Tauri application through its actual WebView/IPC
surface. It covers GGUF discovery, start, loading/health downgrade and recovery,
models, non-stream and SSE chat, cancellation, structured failure recovery, and
stop. Browser previews and fake IPC fixtures remain useful tests but are not
native release acceptance.

The only automated 3.2.0 external-client claim is the executed `curl` gate. It
records the canonical executable path, binary SHA-256, exact `curl --version`,
detected model ID, non-stream response, SSE completion, process cancellation,
and a bounded transcript hash. GUI profiles remain Pending configuration
references.

## Clean-Mac boundary

Final acceptance uses an ephemeral GitHub-hosted `macos-15` arm64 runner. It
downloads the exact signed-RC workflow artifact and verifies its provenance and
portable checksum before use. It mounts the DMG read-only, validates the nested
app's deep/strict Developer ID signature, expected team and hardened runtime,
checks app and DMG staples, confirms Gatekeeper is enabled, and runs both
Gatekeeper assessments. It then launches the mounted app through LaunchServices
and repeats the native real-GGUF and executable-curl path.

This is meaningful clean-host evidence, but its scope is precise: it does not
represent every physical Mac, prior macOS version, enterprise/MDM policy, or
upgraded user account. Any broader compatibility claim needs separate evidence.

## Signing and notarization credentials

Store exactly these six secrets in the protected `macos-release` Environment,
not as values in the repository:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`;
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12`;
- `APPLE_KEYCHAIN_PASSWORD`: ephemeral CI keychain password;
- `APPLE_ID`: notarization Apple ID;
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password;
- `APPLE_TEAM_ID`: Apple Developer team ID.

Store one additional, separate protected-environment secret:

- `RELEASE_INFRASTRUCTURE_AUDIT_TOKEN`: a least-privilege fine-grained token
  used only for the read-only, fail-closed repository audit. It needs repository
  Contents read, Actions read, Administration read, and Environments read for
  this repository. It is not a signing credential and must not have secret-write,
  tag-write, or release-write permission.

The workflow validates all seven protected values before checkout or build. A missing
certificate, identity, password, team ID, working notary profile, real acceptance
input, or required evidence run is a release blocker. It is never converted into
an unsigned public release.

The trusted path performs:

1. exact-tag/version validation and a read-only protected-infrastructure audit
   for the tagged SHA, including protected-`main` ancestry and an exact
   successful `push` CI run;
2. workflow-policy, dependency, and fresh RustSec gates;
3. run/SHA-bound native matrix and executable external-client evidence checks;
4. Developer ID import into an ephemeral keychain;
5. hardened-runtime Tauri app build and strict Developer ID verification;
6. app ZIP notarization followed by app stapling, validation, and signature
   re-verification;
7. DMG creation, explicit signing, notarization, stapling, and validation;
8. app and DMG Gatekeeper assessment;
9. portable SHA-256 creation and verification;
10. run-bound artifact upload and prerelease/final GitHub Release creation.

The checksum line is `<SHA256><two spaces><basename>`. Verification resolves the
payload from the checksum file's directory, so it is portable across working
directories. The CI keychain is deleted even if the job fails.

## RustSec policy

`npm run check:project` validates the static policy, review expiry, and current
Cargo.lock hash. A release gate must additionally generate fresh no-ignore
`cargo audit --json` output and pass it to
`node scripts/verify-project-policy.mjs --audit <FILE>` (or use
`--live-rustsec`). Any vulnerability blocks release. Every informational warning
must exactly match the bounded, owned review in
`docs/security/rustsec-3.2.0.md`; new, changed, expired, or ignored advisories
fail closed.

## Infrastructure audit and controlled apply

`scripts/release-infrastructure.mjs` provides a read-only GitHub audit by
default. Given an explicit repository, candidate SHA, exact tag, and expected
reviewer IDs, it checks `main`, `macos-release`, exact tag policies, secret names,
reviewer self-approval prevention, branch protection without review-bypass actors,
required checks bound to the GitHub Actions App (`app_id` 15368), workflow files
on the default branch, CI,
tag binding, protected-`main` ancestry, and workflow-dispatch acceptance
artifacts. Stable states are `ready`,
`pending-external`, `missing`, and `misconfigured`; reports never include secret
values.

Apply mode requires `--apply --confirm-apply`, explicit reviewer IDs, and exact
required-check names. It is limited to protected-environment/tag-policy and
branch-protection configuration, preserves stronger compatible protection, and
does not create tags, releases, secrets, or workflow runs. It must be run
separately with an operator-supplied, short-lived token that has Administration
write permission; the release workflow's read-only
`RELEASE_INFRASTRUCTURE_AUDIT_TOKEN` is intentionally insufficient for apply.

## Unsigned diagnostics

The manual workflow's `unsigned-artifact` mode uses ad-hoc signing only, expects
Gatekeeper assessment to fail, creates a checksum, and uploads a seven-day
workflow artifact with read-only repository permissions. It contains no GitHub
Release action.

For a local Apple Silicon diagnostic build:

```bash
ILLAMA_UNSIGNED_RELEASE=1 npm run release:macos
```

An unsigned/ad-hoc rebuild may demonstrate that both the application Info.plist
and release Mach-O load commands target macOS 11.0. That is diagnostic evidence
only; it cannot prove Developer ID signing, notarization, stapling, Gatekeeper,
or clean-Mac behavior. Unsigned artifacts are never suitable for public Release
distribution.

See `docs/release-checklist.md` for the operator sequence and blocking rules.
