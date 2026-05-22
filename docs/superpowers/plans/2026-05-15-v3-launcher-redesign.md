# iLlama V3 Launcher Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship iLlama v3.0.0 as a launcher-first local GGUF control center with external OpenAI-compatible client handoff and only a lightweight smoke-test chat.

**Architecture:** Keep the existing Tauri v2, React, TypeScript, and Rust process-management core. Remove the full chat workspace from the primary product path, add a connection model for external clients, and replace persisted multi-conversation UX with a transient runtime smoke chat that talks directly to the active `llama-server` endpoint.

**Tech Stack:** Tauri v2, Rust stable, React 18, TypeScript, Vite, Vitest, Testing Library, `llama-server`, OpenAI-compatible `/v1/chat/completions`.

---

## Task 1: External Client Connection Model

**Files:**
- Create: `src/lib/externalClients.ts`
- Test: `src/lib/externalClients.test.ts`

- [x] Write failing tests for runtime connection URL generation and client profiles.
- [x] Implement `buildRuntimeConnection`, built-in client profiles, and copy payload builders.
- [x] Verify targeted test passes.

## Task 2: Runtime Smoke Chat

**Files:**
- Create: `src/hooks/useRuntimeSmokeChat.ts`
- Create: `src/components/RuntimeSmokeChat.tsx`
- Test: `src/hooks/useRuntimeSmokeChat.test.tsx`
- Test: `src/components/RuntimeSmokeChat.test.tsx`

- [x] Write failing tests for transient send/cancel behavior and disabled copy.
- [x] Implement a local-only message model and direct streaming generation.
- [x] Render a compact smoke-test surface with no history, modes, branches, export, or memory.
- [x] Verify targeted tests pass.

## Task 3: Connection Panel And App Shell

**Files:**
- Create: `src/components/ConnectionPanel.tsx`
- Test: `src/components/ConnectionPanel.test.tsx`
- Modify: `src/components/AppLayout.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [x] Write failing tests for launcher-first navigation and connection copy fields.
- [x] Replace `config/chat` tabs with `run/connect/test` surfaces.
- [x] Remove primary imports and state wiring for full chat workspace/history.
- [x] Route successful health checks to the connection view.
- [x] Verify targeted tests pass.

## Task 4: Settings And Rust Command Surface

**Files:**
- Modify: `src/api/tauri.ts`
- Modify: `src/state/appState.ts`
- Modify: `src/state/appState.test.ts`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`

- [x] Keep legacy chat settings readable for migration compatibility.
- [x] Stop writing active V3 settings that imply persistent chat as a first-class feature.
- [x] Remove chat history commands from the Tauri invoke handler while keeping settings migration tolerant.
- [x] Verify frontend and Rust settings tests pass.

## Task 5: Version, Docs, And Release Notes

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Create: `docs/releases/v3.0.0.md`

- [x] Update package, Rust crate, and Tauri metadata to `3.0.0`.
- [x] Rewrite public README around launcher-first positioning.
- [x] Add V3 release notes and migration guidance.
- [x] Verify build, lint, frontend tests, and Rust tests.
