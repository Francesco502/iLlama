# iLlama 3.2.0 Release Strategy

## Distribution target

iLlama 3.2.0 is distributed through GitHub Releases as a macOS Apple Silicon
DMG plus a portable SHA-256 file. The application is ad-hoc signed so its bundle
integrity can be checked, but it is not signed with Developer ID and is not
submitted to Apple notarization. No Apple Developer account or Apple credential
is required by the release workflow.

Because the download is unnotarized, macOS may block the first launch. The user
must open the mounted DMG, drag iLlama to Applications, then use Finder 右键 on
`iLlama.app`, choose “打开”, and confirm “打开”. This is an intentional GitHub-only
distribution tradeoff, not an App Store or Gatekeeper approval claim.

Windows and Linux remain compile/test targets. No Windows or Linux artifact is
attached to `v3.2.0-rc.1` or `v3.2.0`.

## External llama-server policy

The app never bundles or downloads `llama-server`. Users install a compatible
binary themselves or select an existing executable. The release helper refuses
to build when `src-tauri/binaries/` contains anything except `.gitkeep`.

## Manual protected publication

`.github/workflows/release.yml` has no automatic tag trigger. The sole
maintainer manually dispatches it from exactly one of these existing tags:

- `v3.2.0-rc.1`, published as a prerelease;
- `v3.2.0`, published as the latest release.

The workflow must itself run from the selected tag. The `macos-release`
Environment permits only those two exact tags and has the sole maintainer as a
self-approving reviewer. Main has no independent review or conversation gate;
strict automated CI remains required and force-push/deletion stays disabled.

The release job requires numeric run IDs for:

- the exact tag's successful CI run;
- real GGUF matrix evidence;
- executable external-client evidence.

Every run is checked against repository, workflow path, tag ref, tagged SHA,
run ID, attempt, and success status. A successful `main` run cannot replace a
tag-bound run.

## Application acceptance

The protected self-hosted Apple Silicon runner uses
`ACCEPTANCE_LLAMA_SERVER_PATHS` and `ACCEPTANCE_LLAMA_MODEL_PATH` for the two
application-level evidence runs. These are the only required Environment
secrets.

The matrix covers GGUF scan, command construction, start, health transition,
model discovery, non-stream chat, SSE chat, cancellation, recovery, stop, and
port cleanup through the real Tauri WebView/IPC surface. The external-client
gate executes the system `curl` binary and binds its version, checksum, model
ID, stream completion, cancellation, and transcript hash to the run.

## DMG build and verification

The GitHub-hosted `macos-15` arm64 release job:

1. validates the exact tag, version, architecture, and external-server policy;
2. validates CI, real GGUF, and executable-client evidence;
3. runs frontend, Rust, UI, native Tauri, dependency, npm-audit, and RustSec gates;
4. builds with `ILLAMA_UNSIGNED_RELEASE=1` and an ad-hoc signing identity;
5. creates and verifies `iLlama_3.2.0_aarch64.dmg.sha256`;
6. mounts the DMG read-only, checks the single app bundle, macOS 11.0 minimum,
   arm64 executable, and ad-hoc signature, then launches the mounted app;
7. uploads a run-bound workflow artifact and publishes the DMG/checksum to the
   selected GitHub Release.

Developer ID, hardened-runtime authority checks, `notarytool`, stapling, and
Gatekeeper acceptance are deliberately not release gates. The workflow fails if
a Developer ID authority unexpectedly appears, so the published trust model is
unambiguous.

## Infrastructure audit

`scripts/release-infrastructure.mjs` audits the default branch, exact Environment
tag policies, sole self-approving maintainer, branch checks, candidate lineage,
tag-bound CI, and the two acceptance artifacts. It does not require Apple
secrets. Apply mode only configures Environment/tag/branch protection and never
creates tags, releases, secrets, or workflow runs.

## Local build

On Apple Silicon:

```bash
ILLAMA_UNSIGNED_RELEASE=1 npm run release:macos
```

The resulting DMG has the same unnotarized trust model as the GitHub asset. A
local build is not a substitute for the tag-bound CI and acceptance evidence.

## Security policy

SHA-256, CSP/remote-resource policy, npm production audit, fresh RustSec audit,
and bounded advisory review remain mandatory. Removing Apple signing does not
remove application security or functional acceptance checks.
