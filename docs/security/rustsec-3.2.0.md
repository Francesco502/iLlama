# RustSec review for iLlama 3.2.0

Review date: 2026-07-22 (Asia/Hong_Kong)  
Owner: iLlama maintainers / release owner  
Mandatory re-review deadline: 2026-10-22

## Audit provenance and decision

The review was captured from the current `src-tauri/Cargo.lock` with:

```text
cargo audit --json --file src-tauri/Cargo.lock
```

`cargo-audit` 0.22.2 used advisory database commit
`b5fc89b8be99e96f79194d8a6f11e9b4143b99f0`, last updated
2026-07-17. The lockfile contained 468 packages. The result contained zero
vulnerabilities, 16 `unmaintained` warnings, one `unsound` warning, and no
ignored advisory IDs.

The warnings below are temporarily accepted for 3.2.0 only under their stated
target and re-review conditions. A vulnerability is never accepted by this
record. `npm run check:project` validates this record's structure, expiry, and
exact `Cargo.lock` hash. CI and Release additionally create fresh no-ignore JSON
and run `node scripts/verify-project-policy.mjs --audit <FILE>`; that comparison
fails on a new advisory, category change, expired or incomplete entry, or a
crate/version mismatch.

Target reachability was checked with target-specific inverse dependency trees
for `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`, and
`x86_64-unknown-linux-gnu`. The GTK3 family, `glib` 0.18.5, and
`proc-macro-error` 1.0.4 are Linux-only lockfile dependencies. The five
`unic-*` crates are reachable through `urlpattern` and `tauri-utils` on the
formal macOS target and Windows preview target.

## Advisory review summary

| Advisory | Crate | Category | Dependency path | macOS arm64 / Windows preview | Release decision |
| --- | --- | --- | --- | --- | --- |
| RUSTSEC-2024-0413 | `atk 0.18.2` | unmaintained | `illama → tauri → gtk → atk` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0416 | `atk-sys 0.18.2` | unmaintained | `illama → tauri → gtk → atk → atk-sys` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0412 | `gdk 0.18.2` | unmaintained | `illama → tauri → tauri-runtime-wry → wry → gdkx11 → gdk` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0418 | `gdk-sys 0.18.2` | unmaintained | `illama → tauri → tauri-runtime-wry → wry → gdk → gdk-sys` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0411 | `gdkwayland-sys 0.18.2` | unmaintained | `illama → tauri → tauri-runtime-wry → tao → gdkwayland-sys` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0417 | `gdkx11 0.18.2` | unmaintained | `illama → tauri → tauri-runtime-wry → wry → gdkx11` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0414 | `gdkx11-sys 0.18.2` | unmaintained | `illama → tauri → tauri-runtime-wry → tao → gdkx11-sys` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0415 | `gtk 0.18.2` | unmaintained | `illama → tauri → tray-icon/tao/wry/webkit2gtk → gtk` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0420 | `gtk-sys 0.18.2` | unmaintained | `illama → tauri-plugin-dialog → rfd → gtk-sys` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0419 | `gtk3-macros 0.18.2` | unmaintained | `illama → tauri → gtk → gtk3-macros` | not reachable / not reachable | Accept temporarily; Linux is not distributed. |
| RUSTSEC-2024-0370 | `proc-macro-error 1.0.4` | unmaintained | `illama → tauri → gtk → gtk3-macros → proc-macro-error` | not reachable / not reachable | Accept temporarily as a Linux-only build dependency. |
| RUSTSEC-2025-0081 | `unic-char-property 0.9.0` | unmaintained | `illama → tauri/tauri-build → tauri-utils → urlpattern → unic-ucd-ident → unic-char-property` | reachable / reachable | Accept informational maintenance risk while monitoring Tauri/urlpattern. |
| RUSTSEC-2025-0075 | `unic-char-range 0.9.0` | unmaintained | previous path, then `unic-char-property → unic-char-range` | reachable / reachable | Accept informational maintenance risk while monitoring Tauri/urlpattern. |
| RUSTSEC-2025-0080 | `unic-common 0.9.0` | unmaintained | previous Tauri path, then `unic-ucd-ident → unic-ucd-version → unic-common` | reachable / reachable | Accept informational maintenance risk while monitoring Tauri/urlpattern. |
| RUSTSEC-2025-0100 | `unic-ucd-ident 0.9.0` | unmaintained | `illama → tauri/tauri-build → tauri-utils → urlpattern → unic-ucd-ident` | reachable / reachable | Accept informational maintenance risk while monitoring Tauri/urlpattern. |
| RUSTSEC-2025-0098 | `unic-ucd-version 0.9.0` | unmaintained | previous path, then `unic-ucd-ident → unic-ucd-version` | reachable / reachable | Accept informational maintenance risk while monitoring Tauri/urlpattern. |
| RUSTSEC-2024-0429 | `glib 0.18.5` | unsound | `illama → tauri → gtk/webkit2gtk → glib` | not reachable / not reachable | Accept only because affected crate is Linux-only and no Linux asset ships. |

The GTK3 entries share one mitigation: iLlama does not call GTK3/glib APIs
directly, macOS and Windows target graphs omit these versions, and no Linux
artifact is distributed. Making Linux a release target blocks release until the
GTK stack is replaced or the warnings are resolved. The `glib` unsoundness must
also be re-reviewed immediately if its affected `VariantStrIter` functions
become reachable through application code.

The `unic-*` entries are reachable but are maintenance notices, not known
vulnerabilities or unsoundness reports. iLlama does not call these crates
directly. They remain pinned transitively through Tauri's URL-pattern support;
a Tauri/urlpattern update is preferred over a local dependency override. Any
new vulnerability or unsoundness in this path blocks release.

## Machine-readable review

The project policy consumes only the bounded JSON object below. Human prose does
not add or waive an advisory.

<!-- rustsec-review-json:start -->
```json
{
  "schemaVersion": 1,
  "release": "3.2.0",
  "reviewedOn": "2026-07-22",
  "audit": {
    "command": "cargo audit --json --file src-tauri/Cargo.lock",
    "cargoAuditVersion": "0.22.2",
    "cargoLockSha256": "c9f2ddd16bbab2751ddc30be3f3874030df427736c933d8c79c2cbb69a4c24c4",
    "advisoryDatabaseCommit": "b5fc89b8be99e96f79194d8a6f11e9b4143b99f0",
    "advisoryDatabaseUpdated": "2026-07-17T17:52:38+02:00",
    "dependencyCount": 468,
    "vulnerabilityCount": 0,
    "warningCount": 17,
    "ignoredAdvisories": []
  },
  "reviews": [
    {
      "advisoryId": "RUSTSEC-2024-0413",
      "crate": "atk",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> gtk -> atk (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0416",
      "crate": "atk-sys",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> gtk -> atk/gtk-sys -> atk-sys (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0412",
      "crate": "gdk",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> tauri-runtime-wry -> wry -> gdkx11/gtk -> gdk (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0418",
      "crate": "gdk-sys",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> tauri-runtime-wry -> wry/tao -> gdk/gtk-sys -> gdk-sys (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0411",
      "crate": "gdkwayland-sys",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> tauri-runtime-wry -> tao -> gdkwayland-sys (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0417",
      "crate": "gdkx11",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> tauri-runtime-wry -> wry -> gdkx11 (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0414",
      "crate": "gdkx11-sys",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> tauri-runtime-wry -> tao/wry -> gdkx11-sys (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0415",
      "crate": "gtk",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> tray-icon/tao/wry/webkit2gtk -> gtk (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0420",
      "crate": "gtk-sys",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri-plugin-dialog -> rfd -> gtk-sys; also tauri -> gtk -> gtk-sys (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0419",
      "crate": "gtk3-macros",
      "version": "0.18.2",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> gtk -> gtk3-macros (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "build-transitive" },
      "releaseRelevance": "Not present in the formal macOS arm64 or Windows preview target graph; Linux is CI-only and has no release asset.",
      "mitigation": "Keep Linux non-distributed, avoid direct GTK3 use, and take the upstream Tauri/GTK replacement when available.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK target, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0370",
      "crate": "proc-macro-error",
      "version": "1.0.4",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri -> gtk/glib -> gtk3-macros/glib-macros -> proc-macro-error (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "build-transitive" },
      "releaseRelevance": "Only a Linux-target proc-macro dependency; absent from formal macOS and Windows target graphs.",
      "mitigation": "Keep Linux non-distributed and take the upstream GTK/glib macro migration; do not add a direct dependency.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, Tauri, GTK/glib macro, advisory category, or Linux distribution changes."
    },
    {
      "advisoryId": "RUSTSEC-2025-0081",
      "crate": "unic-char-property",
      "version": "0.9.0",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri/tauri-build -> tauri-utils -> urlpattern -> unic-ucd-ident -> unic-char-property",
      "targetReachability": { "macosArm64": "build-and-runtime-transitive", "windowsPreview": "build-and-runtime-transitive", "linuxCi": "build-and-runtime-transitive" },
      "releaseRelevance": "Reachable transitively on the formal target, but the advisory is an informational maintenance notice without a reported vulnerability.",
      "mitigation": "No direct API use; retain the Tauri-managed version and take an upstream tauri-utils/urlpattern migration rather than overriding one crate locally.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, tauri-utils, urlpattern, rust-unic, or advisory category/affected-range changes."
    },
    {
      "advisoryId": "RUSTSEC-2025-0075",
      "crate": "unic-char-range",
      "version": "0.9.0",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri/tauri-build -> tauri-utils -> urlpattern -> unic-ucd-ident -> unic-char-property -> unic-char-range",
      "targetReachability": { "macosArm64": "build-and-runtime-transitive", "windowsPreview": "build-and-runtime-transitive", "linuxCi": "build-and-runtime-transitive" },
      "releaseRelevance": "Reachable transitively on the formal target, but the advisory is an informational maintenance notice without a reported vulnerability.",
      "mitigation": "No direct API use; retain the Tauri-managed version and take an upstream tauri-utils/urlpattern migration rather than overriding one crate locally.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, tauri-utils, urlpattern, rust-unic, or advisory category/affected-range changes."
    },
    {
      "advisoryId": "RUSTSEC-2025-0080",
      "crate": "unic-common",
      "version": "0.9.0",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri/tauri-build -> tauri-utils -> urlpattern -> unic-ucd-ident -> unic-ucd-version -> unic-common",
      "targetReachability": { "macosArm64": "build-and-runtime-transitive", "windowsPreview": "build-and-runtime-transitive", "linuxCi": "build-and-runtime-transitive" },
      "releaseRelevance": "Reachable transitively on the formal target, but the advisory is an informational maintenance notice without a reported vulnerability.",
      "mitigation": "No direct API use; retain the Tauri-managed version and take an upstream tauri-utils/urlpattern migration rather than overriding one crate locally.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, tauri-utils, urlpattern, rust-unic, or advisory category/affected-range changes."
    },
    {
      "advisoryId": "RUSTSEC-2025-0100",
      "crate": "unic-ucd-ident",
      "version": "0.9.0",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri/tauri-build -> tauri-utils -> urlpattern -> unic-ucd-ident",
      "targetReachability": { "macosArm64": "build-and-runtime-transitive", "windowsPreview": "build-and-runtime-transitive", "linuxCi": "build-and-runtime-transitive" },
      "releaseRelevance": "Reachable transitively on the formal target, but the advisory is an informational maintenance notice without a reported vulnerability.",
      "mitigation": "No direct API use; retain the Tauri-managed version and take an upstream tauri-utils/urlpattern migration rather than overriding one crate locally.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, tauri-utils, urlpattern, rust-unic, or advisory category/affected-range changes."
    },
    {
      "advisoryId": "RUSTSEC-2025-0098",
      "crate": "unic-ucd-version",
      "version": "0.9.0",
      "category": "unmaintained",
      "dependencyPath": "illama -> tauri/tauri-build -> tauri-utils -> urlpattern -> unic-ucd-ident -> unic-ucd-version",
      "targetReachability": { "macosArm64": "build-and-runtime-transitive", "windowsPreview": "build-and-runtime-transitive", "linuxCi": "build-and-runtime-transitive" },
      "releaseRelevance": "Reachable transitively on the formal target, but the advisory is an informational maintenance notice without a reported vulnerability.",
      "mitigation": "No direct API use; retain the Tauri-managed version and take an upstream tauri-utils/urlpattern migration rather than overriding one crate locally.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately on Cargo.lock, tauri-utils, urlpattern, rust-unic, or advisory category/affected-range changes."
    },
    {
      "advisoryId": "RUSTSEC-2024-0429",
      "crate": "glib",
      "version": "0.18.5",
      "category": "unsound",
      "dependencyPath": "illama -> tauri -> gtk/webkit2gtk -> glib (Linux target only)",
      "targetReachability": { "macosArm64": "not-reachable", "windowsPreview": "not-reachable", "linuxCi": "runtime-transitive" },
      "releaseRelevance": "Affected glib version is absent from macOS and Windows target graphs; Linux is CI-only and no Linux asset is released.",
      "mitigation": "Do not distribute Linux assets or call glib VariantStrIter APIs; move with the upstream Tauri GTK stack to glib >=0.20 before Linux distribution.",
      "owner": "iLlama maintainers / release owner",
      "reviewedOn": "2026-07-22",
      "reviewExpires": "2026-10-22",
      "rereviewCondition": "Re-review by 2026-10-22; immediately if VariantStrIter becomes reachable, Linux becomes distributable, Cargo.lock/Tauri/glib changes, or the advisory category/affected range changes."
    }
  ]
}
```
<!-- rustsec-review-json:end -->
