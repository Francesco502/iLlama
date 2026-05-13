# Release Checklist

Current release target: `v2.1.2`.

## v2.1.2 Hotfix

- [x] Chat composer remains clickable after model launch
- [x] Composer grid reserves stable columns for both attachment buttons and the text input
- [x] Empty conversations show a concise first-message prompt
- [x] App metadata versions aligned to `2.1.2` in npm, Tauri, and Rust crate metadata

## v2.1.1 Maintenance & quality

- [x] App metadata versions aligned to `2.1.1` in npm, Tauri, and Rust crate metadata
- [x] Public README scrubbed of private local paths and pre-release repository reminders
- [x] CHANGELOG covers v2.0.0, v2.1.0, and v2.1.1 release notes
- [x] ESLint added with TypeScript and React Hooks release gates
- [x] GitHub Actions frontend and Rust jobs cover Linux, macOS, and Windows matrices
- [x] Vite vendor chunks split React, Markdown, and icon dependencies without build warnings
- [x] ErrorBoundary reports component stack details into the system log drawer
- [x] Shared budget utils (`getAdaptiveSafetyFactor`, `clampInt`, `estimateMessageTokens`, `createId`)
- [x] Unified prompt-token estimation across runtime and budget hint
- [x] Removed best-effort llama capability probe that triggered ghost chat requests
- [x] Conversation auto-titling from first user message via `createConversationTitle`
- [x] `maxConversations` actually enforced (oldest non-pinned trimmed on save)
- [x] Chat history `schemaVersion` aligned to 2 on every save
- [x] Streaming `saveConversation` writes throttled (~250 ms)
- [x] Conversation sidebar: hover actions for rename / pin / archive / delete
- [x] System prompt editor exposed per conversation
- [x] Sampling panel exposes temperature/top-p/top-k/min-p/repeat-penalty/seed/stop
- [x] Parameter panel exposes `idleSleepSeconds`
- [x] Health check: exponential backoff up to 120 s with cancellation on stop
- [x] Log drawer: stream filter, full-text search, clear button
- [x] Conversation search covers message body (in addition to title/preview)
- [x] Streaming message metrics no longer flash "生成 0 tok"
- [x] Composer drafts cached per conversation id
- [x] Attachment images open enlarged in a popup
- [x] Long URLs / inline code wrap inside user bubble
- [x] Help button + `?` shortcut overlay
- [x] Dead `ChatPanel`-era CSS removed; dark-mode covers all new elements

## v2.1 Local AI Assistant

- [x] Assistant mode selector
- [x] Novel writing actions
- [x] Conversation analysis actions
- [x] Automatic long-context compression
- [x] Manual compression and clear memory controls
- [x] Export includes compressed memory
- [x] Visual QA at `1000x760`, `1180x760`, and `1440x900`
- [x] Real llama-server smoke for compression + normal response

## v2.0 Chat Workspace

- [x] Dedicated chat conversation model and history index
- [x] Persistent local conversation history commands
- [x] Settings migration for chat history controls
- [x] Markdown rendering with GFM, safe HTML handling, highlighting, and code copy
- [x] Assistant reasoning capture and collapsible reasoning UI
- [x] Message copy, edit and resend, regenerate, delete pair, and branch actions
- [x] Conversation sidebar create, select, search, delete, and export-before-delete flow
- [x] JSON and Markdown export with optional reasoning
- [x] Privacy controls for history, image persistence, clear history, and export defaults
- [x] Image persistence sanitization before durable save
- [x] Context budget trimming for chat completion requests
- [x] Keyboard shortcuts: send, cancel, focus search, and new conversation
- [x] Legacy `ChatPanel` and `useChatSession` removed
- [x] Browser visual QA at `1000x760`, `1180x760`, and `1440x900`
- [x] Tauri `.app` bundle build and launch smoke
- [x] Real `llama-server` + GGUF generation smoke on release machine

## 手工回归（续写 / 文本附件 / 多版本 llama-server）

发布前建议用 **至少一个** 真实 `llama-server` 构建跑通（可在不同版本或编译选项下重复，结论写入 PR 或发布备注）：

- [x] **多路径快速探测（本地）**：`npm run release:llama-matrix -- /opt/homebrew/bin/llama-server /opt/homebrew/Cellar/llama.cpp/9100/bin/llama-server`，确认各二进制可执行且 `--version`（或 `-h`）有合理退出码。
- [x] **继续输出（双路径）**：真实 `llama-server` streaming continuation-style 请求通过；低 `max_tokens` 请求返回 `finish_reason=length`。
- [x] **文本伪附件**：Vitest 覆盖文本片段附件合并为 plain string content，以及文本+图片 multipart content。
- [x] **图片附件**：Vitest 覆盖 composer 图片上传、OpenAI `image_url` content parts、图片持久化清理与附件查看入口。当前本机模型目录没有 `mmproj`，未做真实视觉模型推理。
- [x] **Markdown 代码块**：真实 `llama-server` Markdown/code-block 请求通过；Vitest 覆盖 Markdown 渲染与代码复制行为。
- [x] **Prometheus / KV**：真实 `llama-server --metrics` 的 `/metrics` 返回 `llamacpp:*` Prometheus 指标；Rust parser 覆盖默认与自定义子串匹配。

## macOS

- [ ] Confirm no old app/source branding leftovers remain
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run build`
- [x] `cd src-tauri && cargo test`
- [x] `cd src-tauri && cargo fmt --check`
- [x] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [x] Confirm `src-tauri/binaries/` contains no release sidecar except `.gitkeep`
- [ ] `APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" APPLE_NOTARY_PROFILE=illama-notary npm run release:macos`
- [x] `ILLLAMA_UNSIGNED_RELEASE=1 npm run release:macos` for the unsigned v2.1.2 self-download hotfix artifact
- [x] Confirm `iLlama.app/Contents/MacOS/illama`
- [ ] Confirm the DMG has a stapled notarization ticket
- [x] Open generated `.app`
- [ ] Add a model directory containing at least one `.gguf`
- [ ] Select model
- [ ] Verify Balanced preset command preview
- [ ] Start with a valid `llama-server`
- [ ] Confirm logs appear
- [ ] Confirm local health status
- [ ] Send one chat message
- [ ] Stop model and confirm process exits
- [ ] Check app remains responsive during streaming output

Signing/notarization status on 2026-05-13: trusted notarized release mode is blocked because the keychain contains no Developer ID Application identity (`security find-identity -v -p codesigning` reports `0 valid identities found`) and no usable notary profile is configured. The explicit unsigned self-download mode is `ILLLAMA_UNSIGNED_RELEASE=1 npm run release:macos`; it does not produce a stapled notarization ticket.

## Windows

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd src-tauri && cargo test`
- [ ] `npm run tauri:build`
- [ ] Open generated installer/app
- [ ] Repeat launch/chat/stop flow with a Windows `llama-server.exe`
- [ ] Verify file paths with spaces
- [ ] Verify port occupied error

## Visual QA

- [x] Screenshot at `1180x760`
- [x] Screenshot at `1440x900`
- [x] Screenshot near `1000px` width
- [x] No overlapping controls
- [x] No clipped labels
- [x] Start/Stop remain obvious
- [x] UI reads as a native-style desktop utility, not a web dashboard
