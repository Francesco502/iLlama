# Changelog

## v2.1.1 - 2026-05-13

### Fixed

- Align app metadata versions across npm, Tauri, and Rust crate metadata for the v2.1.1 release train.
- Remove private local validation paths and pre-release reminders from public README content.
- Improve release readiness docs for manual llama-server, Prometheus, and notarization checks.

### Changed

- Add frontend linting and cross-platform CI coverage for macOS, Windows, and Linux.
- Split large Vite vendor chunks for Markdown, React, icons, and remaining dependencies.

## v2.1.0 - 2026-05-12

### Added

- Assistant modes for general chat, novel writing, analysis, coding, and translation.
- Conversation-level system prompt editing, writing actions, and conversation memory controls.
- Adaptive context compression, long-reply and long-memory sampling presets, and continuation fallback handling.
- Prometheus KV/TPS hints with configurable metric-name substrings and maxTokens suggestions.
- Text pseudo-attachments, multimodal image attachments, image preview enlargement, and `mmproj` selection support.

## v2.0.0 - 2026-05-10

### Added

- Dedicated multi-conversation chat workspace with local history persistence and migration from v1 chat data.
- Conversation create, search, rename, pin, archive, branch, delete, and export flows.
- Markdown rendering with GFM, code highlighting, code copy, and safe HTML handling.
- Streaming OpenAI-compatible chat completions with reasoning capture, usage-token parsing, and estimated fallback metrics.
- Keyboard shortcuts, per-conversation drafts, privacy controls, and log filtering/search.

## v1.0.0 - 2026-05-08

### Added

- Initial iLlama desktop launcher built with Tauri v2, React, TypeScript, and Rust.
- Local GGUF model directory scanning with metadata extraction.
- `llama-server` binary discovery, user-selected binary support, and process start/stop controls.
- Launch parameter validation, command preview, presets, auto-port selection, and health checks.
- OpenAI-compatible streaming chat UI with cancellation and runtime metrics.
- Optional multimodal image request formatting and `mmproj` argument support.
- macOS `.app` and `.dmg` build flow.
- macOS release strategy, checklist, and signing/notarization helper script.

### Release Notes

- v1.0.0 uses an external `llama-server` strategy. Users must install `llama-server` or choose an existing executable from the app.
- The release process refuses to bundle Homebrew `llama-server` binaries because they depend on non-portable `/opt/homebrew` dynamic libraries.
- Public macOS distribution requires Developer ID signing and Apple notarization before publishing a trusted DMG.

### Verification

- `npm test`
- `npm run build`
- `cargo test`
- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `npm run tauri:build`
