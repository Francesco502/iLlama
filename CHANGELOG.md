# Changelog

## v3.2.0 - 2026-07-21

### Added

- Add authoritative active-launch snapshots containing the actual model, port, PID, uptime, detected model ID, and server capabilities.
- Add settings schema v3 with serialized patches, atomic persistence, corrupt-file backups, and complete launch/UI preference restoration.
- Add `llama-server` capability probing and a shared command specification for actual launch and POSIX/PowerShell previews.
- Add ready, limited, and invalid GGUF classifications with asynchronous progress and stale-scan rejection.
- Add Playwright and automated accessibility coverage for narrow windows, keyboard flow, dark mode, reduced motion, log docking, and tab scroll restoration.

### Changed

- Redesign the run page as a launch workbench with a fixed actual-runtime card, grouped advanced settings, next-launch draft indication, and a resizable persistent log dock.
- Rename “最大能力” to “自动配置” and derive the default smoke-test output limit from context size.
- Make connection and test pages consume the active endpoint and `/v1/models` model ID instead of draft values, file names, or hardcoded aliases.
- Make macOS Apple Silicon the only formal 3.2.0 distribution target; retain Windows build, test, and preview support without Release assets.
- Keep `llama-server` external: no bundled sidecar and no binary download.
- Replace automatic tag publishing with a manual protected workflow for `v3.2.0-rc.1` and `v3.2.0`.
- Publish an ad-hoc signed, unnotarized Apple Silicon DMG on GitHub Releases without requiring an Apple Developer account; when macOS blocks first launch, use Finder 右键 → “打开”.

### Fixed

- Keep slow but live server processes in a stoppable starting state instead of reporting false failure after 120 seconds.
- Prevent draft model or port edits from changing the displayed active connection.
- Prevent concurrent setting, tray, and debounced UI writes from overwriting one another.
- Reject invalid GGUF files and omit optional flags unsupported by the selected server.
- Preserve the last runtime snapshot across temporary IPC polling failures and retain logs after abnormal exits.
- Keep checksum, real-GGUF, executable-client, mounted-DMG launch, dependency, and cross-platform CI gates while removing Developer ID, notarization, staple, and Gatekeeper approval requirements.

## v3.1.0 - 2026-06-18

### Added

- Add multimodal projector workflow improvements: same-directory `mmproj` candidates, automatic single-candidate selection, explicit projector status, and runtime capability preflight before sending image requests.
- Show sent image/text attachments in the smoke-test message thread so multimodal requests have visible confirmation.
- Add focused tests for multimodal request serialization, projector capability checks, `mmproj` selection, attachment UI state, and image attachment replay.

### Fixed

- Disable every attachment entry point while the runtime is unavailable or streaming.
- Keep the bottom status bar on one line on narrow screens by scrolling horizontally instead of wrapping metric labels.
- Compile the macOS Dock reopen handler only on macOS so Ubuntu and Windows Rust CI builds pass.
- Add the v3.1.0 release notes source file and align workflow/documentation defaults with the current release.

## v3.0.0 - 2026-05-15

### Changed

- Reposition iLlama as a launcher-first local GGUF control center instead of a full chat workspace.
- Replace the primary `配置 / 对话` navigation with `运行 / 连接 / 测试`.
- Add an OpenAI-compatible connection panel with Base URL, API key, model name, JSON copy, and external client profiles for Chatbox, Cherry Studio, Open WebUI, AnythingLLM, and custom clients.
- Add connection checking for `/health` and `/v1/models`, plus browser-preview warnings in the connection page.
- Add an explicit V2 legacy history export command and connection-page action for users migrating old data.
- Replace the old low-memory/balanced/performance parameter presets with `最大能力 / 自定义`.
- Add automatic max-capability derivation from GGUF context metadata and sliders for custom context/output length.
- Replace the full in-app conversation workspace with a transient smoke-test chat that does not save history.
- Stop writing V3 settings that imply persistent chat history is enabled by default.
- Optimize macOS window close behavior: clicking the close (X) button now hides the window to the background (retaining it in the Dock) instead of exiting.
- Support reopening and refocusing the main window when clicking the Dock icon.
- Guarantee clean termination of background `llama-server` processes when fully quitting the application (via Cmd+Q or Dock quit).
- Update connection settings copy to explicitly clarify the "macOS system status bar (wifi, battery indicators area)" toggle, preventing layout ambiguity.


### Removed

- Remove the full chat workspace from the main product path: conversation history, branching, archive/pin/search, exports, assistant modes, writing actions, conversation memory, and automatic chat compression are no longer first-class V3 UI features.
- Remove active chat-history Tauri commands and TypeScript V2 workspace modules from the main build. Legacy chat history files are not deleted.

## v2.1.2 - 2026-05-13

### Fixed

- Fix the chat composer becoming effectively unclickable after launch by automatically preparing a usable conversation when the runtime is ready.
- Correct the composer grid so the attachment buttons and message input keep stable columns.
- Improve empty-chat and disabled-state copy for clearer first-message behavior.
- Add an explicit unsigned macOS release mode for self-download hotfix builds when Developer ID notarization is not available.

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
