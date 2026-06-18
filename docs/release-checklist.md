# Release Checklist

Current release target: `v3.1.0`.

## v3.1.0 Release

- [x] App metadata versions aligned to `3.1.0` in npm, Tauri, and Rust crate metadata
- [x] Primary navigation is `运行 / 连接 / 测试`
- [x] Parameter modes are reduced to `最大能力 / 自定义`
- [x] Maximum capability mode derives `ctxSize` from model metadata and auto-sets smoke-test `maxTokens`
- [x] Custom mode exposes slider controls for context length and output length
- [x] V2 full chat workspace removed from the main UI and default TypeScript test/build surface
- [x] Removed active V2 chat-history invoke APIs from the frontend
- [x] Rust chat history surface renamed to explicit `legacy_chat_export`
- [x] Connection panel shows Base URL, API Key, Model, Chat Completions, JSON copy, and external client profiles
- [x] Connection panel opens external client sites in a new browser target
- [x] Browser preview mode clearly warns that the endpoint may not be real
- [x] Connection panel can check `/health` and `/v1/models`
- [x] Copy failure falls back to visible manual-copy text
- [x] Smoke-test chat timestamps use wall-clock ISO timestamps, not `performance.now()` values
- [x] V2 history has a legacy JSON export entry
- [x] `docs/client-compatibility.md` exists with client field names and validation gates
- [ ] Fill `docs/client-compatibility.md` with actual tested versions before a signed public release

## Automated Verification

- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml`
- [x] `PATH="$HOME/.cargo/bin:$PATH" cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- [x] `PATH="$HOME/.cargo/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [x] Confirm `src-tauri/binaries/` contains no release sidecar except `.gitkeep`
- [x] `ILLLAMA_UNSIGNED_RELEASE=1 npm run release:macos` for unsigned local artifact validation

## macOS Signed Release

- [ ] `APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" APPLE_NOTARY_PROFILE=illama-notary npm run release:macos`
- [ ] Confirm `iLlama.app/Contents/MacOS/illama`
- [ ] Confirm the DMG has a stapled notarization ticket
- [ ] Open generated `.app`
- [ ] Gatekeeper assessment passes for signed app

Signing/notarization status carried forward from 2026-05-13: trusted notarized release mode is blocked on machines without a Developer ID Application identity and usable notary profile. The explicit unsigned flow is `ILLLAMA_UNSIGNED_RELEASE=1 npm run release:macos`; it does not produce a stapled notarization ticket.

## Manual Runtime QA

- [ ] Add a model directory containing at least one `.gguf`
- [ ] Select model
- [ ] Verify Balanced preset command preview
- [ ] Start with a valid `llama-server`
- [ ] Confirm logs appear
- [ ] Confirm local health status
- [ ] Open `连接` and click `检测连接`
- [ ] Copy connection info into at least one external client and send a text prompt
- [ ] Use `测试` for one transient smoke-test prompt
- [ ] Use `导出 V2 历史` on a fixture with old `chat-history` data
- [ ] Stop model and confirm process exits
- [ ] Check app remains responsive during streaming output

## Windows

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `npm run tauri:build`
- [ ] Open generated installer/app
- [ ] Repeat launch/connect/test/stop flow with a Windows `llama-server.exe`
- [ ] Verify file paths with spaces
- [ ] Verify port occupied fallback
