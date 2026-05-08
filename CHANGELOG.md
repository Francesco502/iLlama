# Changelog

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
