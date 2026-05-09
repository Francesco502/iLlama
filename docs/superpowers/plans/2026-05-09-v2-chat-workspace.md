# iLlama v2 Chat Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade iLlama v2.0 from a launcher with a temporary chat panel into a local ChatGPT-style chat workspace with persistent conversation history, robust Markdown rendering, collapsible model reasoning, message actions, privacy controls, and context-aware generation.

**Architecture:** Keep the current Tauri v2 + React split: React owns chat workspace state, streaming UI, Markdown rendering, and interaction; Rust owns local durable storage, settings migration, atomic file writes, export file writes, and app-data paths. The existing `llama-server` OpenAI-compatible API remains the only generation backend for v2.0; no RAG, plugins, cloud sync, or multi-model orchestration is introduced in this release.

**Tech Stack:** Tauri v2, Rust stable, React 18, TypeScript, Vite, Vitest, Testing Library, Cargo tests, `llama-server`, OpenAI-compatible `/v1/chat/completions`, `react-markdown`, `remark-gfm`, `rehype-sanitize`, `highlight.js`, local JSON storage under the Tauri app data directory.

---

## Product Positioning

v2.0 should make the chat experience feel complete without turning iLlama into a general AI platform. The app remains a local-first GGUF model launcher. The new chat surface should answer this user need:

1. Start a local model.
2. Open a familiar conversation workspace.
3. Continue previous conversations.
4. Read Markdown and code comfortably.
5. See thinking-model reasoning in a controlled, collapsible area.
6. Retry, edit, copy, export, and manage conversations.
7. Understand when a long conversation exceeds the selected model context.
8. Keep all content on the local machine with explicit history and attachment controls.

The v2.0 chat workspace should be useful even when the active model is stopped. Users must be able to browse, search, rename, export, and delete saved conversations while no `llama-server` process is running. Sending and regenerating messages still requires runtime status `healthy`.

## Current Context

The v1 implementation already includes:

- `src/components/ChatPanel.tsx`: one temporary chat panel, text input, image attachment selection, streaming stop button, clear button.
- `src/hooks/useChatSession.ts`: in-memory messages, streaming controller, browser-preview fallback, token speed estimation.
- `src/api/chat.ts`: OpenAI-compatible request body construction and SSE parsing.
- `src/components/MarkdownContent.tsx`: lightweight custom Markdown renderer.
- `src/types/domain.ts`: `ChatMessage`, `PendingChatMessage`, and `ChatImageAttachment` embedded in the broad domain file.
- `src/api/tauri.ts` and `src-tauri/src/settings.rs`: `saveChatHistory` exists but is not functionally wired; `src/state/appState.ts` currently persists it as `false`.
- `src/components/AppLayout.tsx`: two main tabs, `config` and `chat`, plus log drawer and status bar.

The main v2.0 structural change is to split chat into its own focused domain, storage service, hooks, and components. This avoids overloading `ChatPanel.tsx` and makes history, reasoning, Markdown, and message actions testable in isolation.

## v2.0 Scope

### Included

- Conversation history sidebar with create, select, rename, delete, pin, search, and date grouping.
- Local chat history persistence under Tauri app data.
- Settings migration from schema version 1 to schema version 2.
- Privacy controls:
  - history enabled or disabled;
  - image persistence mode;
  - clear all history;
  - export before delete.
- Message model that separates:
  - assistant visible answer;
  - assistant reasoning content;
  - message status;
  - errors;
  - attachments;
  - generation stats;
  - model and sampling snapshot.
- Streaming parser that distinguishes `content` and `reasoning_content`.
- Compatibility parser for `<think>...</think>` reasoning tags in models that do not emit `reasoning_content`.
- Collapsible reasoning UI:
  - streaming reasoning is visible in a compact disclosure;
  - completed reasoning defaults to collapsed;
  - no reasoning control appears when a message has no reasoning.
- Markdown rendering upgrade:
  - GitHub Flavored Markdown;
  - tables;
  - task lists;
  - blockquotes;
  - headings;
  - links;
  - fenced code blocks;
  - syntax highlighting;
  - code block copy button;
  - safe HTML handling.
- Message actions:
  - copy message;
  - copy code block;
  - edit user message and resend;
  - regenerate assistant response;
  - delete message pair;
  - branch conversation from message.
- Context budget display and request trimming:
  - approximate token count;
  - warning when near configured context;
  - deterministic trimming of old turns;
  - optional pinned system prompt retention.
- Export conversation as Markdown and JSON.
- Focused unit tests for parser, storage, migration, hooks, Markdown rendering, and key UI actions.
- Manual visual QA at `1000x760`, `1180x760`, and `1440x900`.

### Excluded From v2.0

- Built-in model download.
- Cloud sync or account system.
- RAG, embeddings, document indexing, or vector database.
- Plugin architecture.
- Multiple simultaneous model processes.
- Multi-model chat routing.
- Voice input/output.
- Web browsing.
- Automatic llama.cpp updater.
- Full tokenization using model-specific tokenizer bindings. v2.0 uses a documented approximation for context budgeting.

These exclusions keep v2.0 focused on the chat workspace while preserving the reliable local launcher foundation from v1.

## UX Requirements

### Layout

The chat tab becomes a three-region workspace:

1. **Conversation Sidebar:** new conversation button, search field, pinned conversations, date groups, per-row menu.
2. **Chat Thread:** selected conversation title, active model summary, context meter, message list, input composer.
3. **Inspector Strip:** compact status controls already present in the app status bar remain visible; advanced conversation details are shown through small disclosure panels instead of a large always-open inspector.

The existing model directory sidebar should remain focused on models and configuration. The chat tab should include its own conversation list inside the main content area so model selection and conversation selection do not compete for the same sidebar semantics.

### Empty States

- If no conversation exists, show a centered chat empty state with one primary action: "新建对话".
- If history is disabled, show a local-only in-memory state label and a "开启本地历史" action.
- If the model is stopped, history remains browsable and the composer is disabled with "启动模型后即可发送".
- If a conversation references a missing model path, show a non-blocking warning near the title and allow browsing/export/deletion.

### ChatGPT-Style Behavior

- New conversation starts with an empty message list, not with a persisted welcome assistant message.
- The composer is pinned to the bottom.
- The list auto-scrolls while the user is already near the bottom.
- If the user scrolls up during streaming, do not force-scroll; show a small "跳到底部" button.
- Pressing `Cmd+Enter` sends on macOS, `Ctrl+Enter` sends on Windows and Linux.
- `Esc` cancels generation when streaming and closes open menus when not streaming.
- `Cmd+K` focuses conversation search when focus is outside the composer.
- `Cmd+Shift+O` creates a new conversation.

### Reasoning UI

- Label reasoning as "思考过程".
- During streaming, show a disclosure row with live token text and a small elapsed-time label.
- After completion, collapse by default and show "思考过程 · 12 秒" or "思考过程" when elapsed time is unavailable.
- Store reasoning content with the message when history is enabled.
- Exported Markdown should include reasoning only when the user chooses "包含思考过程".

## Data Model

Create a dedicated chat type module and migrate old broad chat types out of `src/types/domain.ts`.

### Frontend Types

Create `src/types/chat.ts`:

```ts
export type ChatMessageRole = "system" | "user" | "assistant";

export type ChatMessageStatus =
  | "complete"
  | "streaming"
  | "cancelled"
  | "failed";

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  thumbnailUrl?: string;
  persistedPath?: string;
  persistence: "memory" | "thumbnail" | "full";
}

export interface ChatGenerationStats {
  startedAt: string;
  completedAt: string | null;
  generatedTokens: number;
  tokensPerSecond: number | null;
  reasoningStartedAt?: string;
  reasoningCompletedAt?: string;
}

export interface ChatModelSnapshot {
  modelPath: string | null;
  modelName: string | null;
  port: number;
  sampling: SamplingParameters;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  reasoningContent?: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  updatedAt?: string;
  status: ChatMessageStatus;
  error?: string;
  stats?: ChatGenerationStats;
  modelSnapshot?: ChatModelSnapshot;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  messageCount: number;
  lastMessagePreview: string;
  modelPath: string | null;
  modelName: string | null;
}

export interface ChatConversation extends ChatConversationSummary {
  schemaVersion: 1;
  systemPrompt: string;
  messages: ChatMessage[];
}

export interface PendingChatMessage {
  text: string;
  attachments: ChatAttachment[];
}
```

`SamplingParameters` can continue to live in `src/types/domain.ts`; `src/types/chat.ts` should import it. `src/types/domain.ts` should re-export chat types temporarily if that reduces churn, but the final component imports should prefer `src/types/chat.ts`.

### Rust Storage Types

Create `src-tauri/src/chat_history.rs` with serde-compatible structs that mirror the persisted JSON shape. Rust does not need to understand every frontend-only field semantically; it should validate the top-level schema, IDs, file paths, timestamps as strings, and atomic writes.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub pinned: bool,
    pub archived: bool,
    pub message_count: usize,
    pub last_message_preview: String,
    pub model_path: Option<String>,
    pub model_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryIndex {
    pub schema_version: u32,
    pub conversations: Vec<ChatConversationSummary>,
}
```

Conversation documents can be stored as `serde_json::Value` after basic validation. That keeps Rust from duplicating all frontend chat message fields while still letting Rust perform path-safe storage.

### Storage Layout

Use the Tauri app data directory:

```text
<app_data_dir>/
  settings.json
  chat-history/
    index.json
    conversations/
      <conversation-id>.json
    attachments/
      <conversation-id>/
        <attachment-id>.json
        <attachment-id>.<ext>
```

`index.json` contains summaries only. Each conversation document contains the full message list. Attachments are only persisted according to `settings.chatHistory.imagePersistence`.

### Settings Schema Version 2

Replace the v1 single boolean with a structured object while preserving migration compatibility:

```ts
export interface ChatHistorySettings {
  enabled: boolean;
  imagePersistence: "none" | "thumbnail" | "full";
  includeReasoningInExportDefault: boolean;
  maxConversations: number;
}

export interface AppSettings {
  schemaVersion: number;
  modelDirectories: string[];
  llamaServerPath: string | null;
  defaultPresetId: string;
  lastSelectedModelPath: string | null;
  autoPort: boolean;
  defaultPort: number;
  idleSleepSeconds: number;
  saveChatHistory?: boolean;
  chatHistory: ChatHistorySettings;
}
```

Migration rule:

- New v2 installs default to `chatHistory.enabled = true`.
- Existing v1 installs map `saveChatHistory` to `chatHistory.enabled`.
- Existing v1 installs with missing `saveChatHistory` use `false`, matching v1 behavior.
- `imagePersistence` defaults to `"thumbnail"` for new installs and `"none"` for migrated installs unless `saveChatHistory` was `true`.

## Request And Context Rules

### Request Messages

Only send supported message roles and model-visible content:

- `system`: include `systemPrompt` when non-empty.
- `user`: include text and current-turn image attachments with full `dataUrl`.
- `assistant`: include visible `content` only.
- Do not send `reasoningContent` back into the model as assistant content.
- Do not send failed or cancelled assistant messages.
- Do not send deleted messages.

### Context Budget

Approximate token counts with a stable heuristic in `src/lib/contextBudget.ts`:

```ts
export function estimateTokenCount(text: string): number {
  const asciiWords = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
  const otherChars = text.replace(/[A-Za-z0-9_\s\u3400-\u9FFF\uF900-\uFAFF]/g, "").length;
  return Math.ceil(asciiWords * 1.3 + cjkChars * 1.1 + otherChars * 0.5);
}
```

Budget rule:

- Use `startupParameters.ctxSize` as the active context limit.
- Reserve `sampling.maxTokens` for the answer.
- Use 85% of the remaining context as the prompt budget.
- Always retain the system prompt and the newest user message.
- Trim oldest complete user+assistant turns first.
- If a single newest user message exceeds budget, send it and display a warning that the model may truncate context.

## File Structure

### Create

- `src/types/chat.ts`: chat-specific frontend types.
- `src/api/chatHistory.ts`: TypeScript wrappers for Tauri chat history commands.
- `src/lib/chatTitle.ts`: deterministic title generation from the first user message.
- `src/lib/contextBudget.ts`: token estimation and request trimming.
- `src/lib/reasoning.ts`: `<think>` extraction and streaming reasoning state helpers.
- `src/components/chat/ChatWorkspace.tsx`: top-level chat workspace composition.
- `src/components/chat/ConversationSidebar.tsx`: history list, search, date grouping, row actions.
- `src/components/chat/ChatThread.tsx`: message list, auto-scroll, jump-to-bottom.
- `src/components/chat/ChatMessageItem.tsx`: single message rendering and actions.
- `src/components/chat/ReasoningDisclosure.tsx`: collapsible reasoning UI.
- `src/components/chat/ChatComposer.tsx`: input, attachments, submit/cancel.
- `src/components/chat/MessageActions.tsx`: copy, edit, regenerate, delete, branch.
- `src/components/chat/ConversationTitleBar.tsx`: title editing, model badge, context meter.
- `src/hooks/useChatWorkspace.ts`: load/create/select/update/delete conversations.
- `src/hooks/useChatGeneration.ts`: streaming generation for the active conversation.
- `src-tauri/src/chat_history.rs`: local history storage service.
- `src-tauri/tests/chat_history_tests.rs`: Rust storage tests.

### Modify

- `package.json`: add Markdown dependencies.
- `package-lock.json`: lock new dependencies.
- `src/types/domain.ts`: remove or re-export old chat types.
- `src/api/chat.ts`: change parser from token-only to typed deltas.
- `src/api/chat.test.ts`: expand SSE parser and request body tests.
- `src/api/tauri.ts`: add chat history commands and settings schema v2.
- `src/hooks/useChatSession.ts`: replace with `useChatGeneration` and remove after integration.
- `src/hooks/useChatSession.test.tsx`: replace with workspace/generation hook tests.
- `src/components/ChatPanel.tsx`: replace with new chat components and remove after integration.
- `src/components/MarkdownContent.tsx`: rewrite using Markdown libraries.
- `src/components/ChatPanel.test.tsx`: replace with focused component tests under `src/components/chat/`.
- `src/components/AppLayout.tsx`: accept richer `chatContent` without assuming a single panel.
- `src/App.tsx`: wire chat workspace to selected model, runtime status, port, profile sampling, and startup parameters.
- `src/styles.css`: replace old chat block with workspace, Markdown, reasoning, and history styles.
- `src/state/appState.ts`: produce schema v2 settings snapshots.
- `src/state/appState.test.ts`: cover settings migration snapshot behavior.
- `src-tauri/src/settings.rs`: schema v2 settings, migration defaults.
- `src-tauri/tests/settings_tests.rs`: schema v1 to v2 migration coverage.
- `src-tauri/src/commands.rs`: expose chat history commands.
- `src-tauri/src/lib.rs`: register `chat_history` module and commands.
- `README.md`: update v2 feature summary after implementation.
- `CHANGELOG.md`: add v2.0 entry before release.

## Implementation Tasks

### Task 1: Add Chat Domain Types

**Files:**

- Create: `src/types/chat.ts`
- Modify: `src/types/domain.ts`
- Test: `npm run build`

- [ ] **Step 1: Create chat-specific TypeScript types**

Add the `src/types/chat.ts` definitions shown in the Data Model section. Import `SamplingParameters` from `./domain`.

- [ ] **Step 2: Re-export compatibility types**

In `src/types/domain.ts`, remove the old inline `ChatImageAttachment`, `PendingChatMessage`, and `ChatMessage` interfaces only after all imports are migrated. During the first commit, add:

```ts
export type {
  ChatAttachment as ChatImageAttachment,
  ChatMessage,
  PendingChatMessage,
} from "./chat";
```

- [ ] **Step 3: Verify type build**

Run:

```bash
npm run build
```

Expected: TypeScript build passes or reports only import locations that still need migration in later tasks.

- [ ] **Step 4: Commit**

```bash
git add src/types/chat.ts src/types/domain.ts
git commit -m "feat(chat): add v2 chat domain types"
```

### Task 2: Upgrade Streaming Parser For Reasoning

**Files:**

- Modify: `src/api/chat.ts`
- Modify: `src/api/chat.test.ts`
- Create: `src/lib/reasoning.ts`
- Test: `npm test -- src/api/chat.test.ts`

- [ ] **Step 1: Write parser tests**

Extend `src/api/chat.test.ts` with:

```ts
import { parseDeltaEvent } from "./chat";
import { splitThinkTags } from "../lib/reasoning";

it("reads visible content deltas separately from reasoning deltas", () => {
  expect(parseDeltaEvent('{"choices":[{"delta":{"content":"答案"}}]}')).toEqual({
    contentDelta: "答案",
    reasoningDelta: "",
  });
  expect(parseDeltaEvent('{"choices":[{"delta":{"reasoning_content":"推理"}}]}')).toEqual({
    contentDelta: "",
    reasoningDelta: "推理",
  });
});

it("extracts completed think tags from visible content", () => {
  expect(splitThinkTags("<think>先分析</think>最终答案")).toEqual({
    reasoning: "先分析",
    content: "最终答案",
    open: false,
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/api/chat.test.ts
```

Expected: fails because `parseDeltaEvent` and `splitThinkTags` do not exist.

- [ ] **Step 3: Implement typed parser**

In `src/api/chat.ts`, replace token-only parsing with:

```ts
export interface ChatStreamDelta {
  contentDelta: string;
  reasoningDelta: string;
}

export function parseDeltaEvent(payload: string): ChatStreamDelta {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
    };
    return {
      contentDelta: parsed.choices?.[0]?.delta?.content ?? "",
      reasoningDelta: parsed.choices?.[0]?.delta?.reasoning_content ?? "",
    };
  } catch {
    return { contentDelta: "", reasoningDelta: "" };
  }
}
```

Keep `parseDeltaToken` as a temporary compatibility wrapper until `useChatSession` is replaced:

```ts
export function parseDeltaToken(payload: string): string {
  const delta = parseDeltaEvent(payload);
  return delta.contentDelta || delta.reasoningDelta;
}
```

- [ ] **Step 4: Implement think-tag helper**

Create `src/lib/reasoning.ts`:

```ts
export interface SplitThinkResult {
  reasoning: string;
  content: string;
  open: boolean;
}

export function splitThinkTags(text: string): SplitThinkResult {
  const openTag = text.indexOf("<think>");
  if (openTag < 0) {
    return { reasoning: "", content: text, open: false };
  }
  const before = text.slice(0, openTag);
  const afterOpen = text.slice(openTag + "<think>".length);
  const closeTag = afterOpen.indexOf("</think>");
  if (closeTag < 0) {
    return { reasoning: afterOpen, content: before, open: true };
  }
  return {
    reasoning: afterOpen.slice(0, closeTag),
    content: `${before}${afterOpen.slice(closeTag + "</think>".length)}`,
    open: false,
  };
}
```

- [ ] **Step 5: Update stream callback signature**

Change `streamChatCompletion` options from `onToken: (token: string) => void` to `onDelta: (delta: ChatStreamDelta) => void`. Keep a wrapper branch for existing callers during this task:

```ts
onDelta?.(delta);
if (!onDelta && onToken && (delta.contentDelta || delta.reasoningDelta)) {
  onToken(delta.contentDelta || delta.reasoningDelta);
}
```

- [ ] **Step 6: Verify tests**

Run:

```bash
npm test -- src/api/chat.test.ts
```

Expected: parser tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/api/chat.ts src/api/chat.test.ts src/lib/reasoning.ts
git commit -m "feat(chat): parse reasoning stream deltas"
```

### Task 3: Add Rust Chat History Storage

**Files:**

- Create: `src-tauri/src/chat_history.rs`
- Create: `src-tauri/tests/chat_history_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `cd src-tauri && cargo test chat_history`

- [ ] **Step 1: Write storage tests**

Create tests covering empty index, save/load conversation, delete conversation, and path traversal rejection:

```rust
#[test]
fn saves_and_loads_chat_history_index() {
    let dir = tempfile::tempdir().unwrap();
    let index = load_chat_history_index(dir.path()).unwrap();
    assert_eq!(index.schema_version, 1);
    assert!(index.conversations.is_empty());
}

#[test]
fn rejects_path_traversal_conversation_ids() {
    let dir = tempfile::tempdir().unwrap();
    let conversation = serde_json::json!({
        "schemaVersion": 1,
        "id": "../bad",
        "title": "bad",
        "createdAt": "2026-05-09T00:00:00.000Z",
        "updatedAt": "2026-05-09T00:00:00.000Z",
        "pinned": false,
        "archived": false,
        "messageCount": 0,
        "lastMessagePreview": "",
        "modelPath": null,
        "modelName": null,
        "systemPrompt": "",
        "messages": []
    });
    let error = save_chat_conversation(dir.path(), &conversation).unwrap_err();
    assert!(error.to_string().contains("invalid conversation id"));
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd src-tauri && cargo test chat_history
```

Expected: fails because the module and functions do not exist.

- [ ] **Step 3: Implement storage paths and atomic JSON writes**

In `src-tauri/src/chat_history.rs`, implement:

```rust
pub fn chat_history_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("chat-history")
}

pub fn load_chat_history_index(app_data_dir: &Path) -> io::Result<ChatHistoryIndex> {
    let path = chat_history_dir(app_data_dir).join("index.json");
    if !path.exists() {
        return Ok(ChatHistoryIndex { schema_version: 1, conversations: Vec::new() });
    }
    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn write_json_atomic(path: &Path, value: &serde_json::Value) -> io::Result<()> {
    ensure_parent(path)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    fs::rename(tmp, path)
}
```

Use the existing `ensure_parent` pattern from `settings.rs` inside this module.

- [ ] **Step 4: Validate conversation IDs**

Accept IDs matching this regex shape without importing a regex crate:

```rust
fn validate_conversation_id(id: &str) -> io::Result<()> {
    let valid = !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid {
        Ok(())
    } else {
        Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid conversation id"))
    }
}
```

- [ ] **Step 5: Add Tauri commands**

In `commands.rs`, add:

```rust
#[tauri::command]
pub fn load_chat_history_index_command(app: AppHandle) -> Result<ChatHistoryIndex, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    load_chat_history_index(&app_data_dir).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_chat_conversation_command(
    app: AppHandle,
    conversation: serde_json::Value,
) -> Result<ChatHistoryIndex, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    save_chat_conversation(&app_data_dir, &conversation).map_err(|error| error.to_string())
}
```

Also expose load, delete, export, and clear commands with explicit names:

- `load_chat_conversation_command`
- `delete_chat_conversation_command`
- `export_chat_conversation_command`
- `clear_chat_history_command`

- [ ] **Step 6: Register module and commands**

Add `pub mod chat_history;` in `lib.rs` and register all new commands in `tauri::generate_handler!`.

- [ ] **Step 7: Verify Rust tests**

Run:

```bash
cd src-tauri && cargo test chat_history
```

Expected: all chat history tests pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/chat_history.rs src-tauri/tests/chat_history_tests.rs src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat(chat): add local history storage"
```

### Task 4: Migrate Settings To Schema Version 2

**Files:**

- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/tests/settings_tests.rs`
- Modify: `src/api/tauri.ts`
- Modify: `src/state/appState.ts`
- Modify: `src/state/appState.test.ts`
- Test: `npm test -- src/state/appState.test.ts && cd src-tauri && cargo test settings`

- [ ] **Step 1: Add settings migration tests**

In `src-tauri/tests/settings_tests.rs`, add a test that writes v1 JSON with `saveChatHistory: false` and asserts v2 settings preserve disabled history:

```rust
#[test]
fn migrates_v1_chat_history_setting_to_v2() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    fs::write(
        &path,
        r#"{
          "schemaVersion": 1,
          "modelDirectories": [],
          "llamaServerPath": null,
          "defaultPresetId": "balanced",
          "lastSelectedModelPath": null,
          "autoPort": true,
          "defaultPort": 8080,
          "idleSleepSeconds": 0,
          "saveChatHistory": false
        }"#,
    )
    .unwrap();

    let loaded = load_settings_from(&path).unwrap();
    assert_eq!(loaded.schema_version, 2);
    assert!(!loaded.chat_history.enabled);
    assert_eq!(loaded.chat_history.image_persistence, "none");
}
```

- [ ] **Step 2: Run settings tests and verify failure**

Run:

```bash
cd src-tauri && cargo test settings
```

Expected: fails because `chat_history` settings do not exist.

- [ ] **Step 3: Add Rust settings struct**

Add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistorySettings {
    pub enabled: bool,
    pub image_persistence: String,
    pub include_reasoning_in_export_default: bool,
    pub max_conversations: usize,
}
```

Update `AppSettings`:

```rust
pub struct AppSettings {
    pub schema_version: u32,
    ...
    #[serde(default)]
    pub save_chat_history: Option<bool>,
    pub chat_history: ChatHistorySettings,
}
```

Use an intermediate `RawAppSettings` so missing v2 fields load cleanly. `RawAppSettings` should make `schema_version`, `save_chat_history`, and `chat_history` optional, then convert into a fully populated `AppSettings` through `migrate_settings`.

- [ ] **Step 4: Implement migration**

`load_settings_from` should call a migration function:

```rust
fn migrate_settings(mut settings: AppSettings) -> AppSettings {
    if settings.schema_version < 2 {
        let enabled = settings.save_chat_history.unwrap_or(false);
        settings.schema_version = 2;
        settings.chat_history = ChatHistorySettings {
            enabled,
            image_persistence: if enabled { "thumbnail".to_string() } else { "none".to_string() },
            include_reasoning_in_export_default: false,
            max_conversations: 200,
        };
    }
    settings
}
```

New default settings should set `enabled: true`, `image_persistence: "thumbnail"`, `include_reasoning_in_export_default: false`, and `max_conversations: 200`.

- [ ] **Step 5: Update frontend settings types**

In `src/api/tauri.ts`, add `ChatHistorySettings` and update `AppSettings`. Keep `saveChatHistory?: boolean` during migration.

- [ ] **Step 6: Update settings snapshot**

In `src/state/appState.ts`, `buildSettingsSnapshot` should set:

```ts
schemaVersion: 2,
chatHistory: previousChatHistorySettings ?? {
  enabled: true,
  imagePersistence: "thumbnail",
  includeReasoningInExportDefault: false,
  maxConversations: 200,
},
```

If `buildSettingsSnapshot` does not have previous settings in scope, extend `SettingsSnapshotInput` with `chatHistory`.

- [ ] **Step 7: Verify tests**

Run:

```bash
npm test -- src/state/appState.test.ts
cd src-tauri && cargo test settings
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/tests/settings_tests.rs src/api/tauri.ts src/state/appState.ts src/state/appState.test.ts
git commit -m "feat(settings): migrate chat history preferences"
```

### Task 5: Add Frontend Chat History API

**Files:**

- Create: `src/api/chatHistory.ts`
- Modify: `src/api/tauri.ts`
- Test: `npm run build`

- [ ] **Step 1: Create TypeScript wrappers**

Create wrappers with typed command names:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { ChatConversation, ChatConversationSummary } from "../types/chat";

export interface ChatHistoryIndex {
  schemaVersion: number;
  conversations: ChatConversationSummary[];
}

export async function loadChatHistoryIndex(): Promise<ChatHistoryIndex> {
  return invoke<ChatHistoryIndex>("load_chat_history_index_command");
}

export async function loadChatConversation(id: string): Promise<ChatConversation | null> {
  return invoke<ChatConversation | null>("load_chat_conversation_command", { id });
}

export async function saveChatConversation(conversation: ChatConversation): Promise<ChatHistoryIndex> {
  return invoke<ChatHistoryIndex>("save_chat_conversation_command", { conversation });
}

export async function deleteChatConversation(id: string): Promise<ChatHistoryIndex> {
  return invoke<ChatHistoryIndex>("delete_chat_conversation_command", { id });
}
```

- [ ] **Step 2: Add export and clear wrappers**

Add:

```ts
export async function exportChatConversation(
  id: string,
  format: "markdown" | "json",
  includeReasoning: boolean,
): Promise<string> {
  return invoke<string>("export_chat_conversation_command", { id, format, includeReasoning });
}

export async function clearChatHistory(): Promise<void> {
  await invoke("clear_chat_history_command");
}
```

- [ ] **Step 3: Verify build**

Run:

```bash
npm run build
```

Expected: build passes once Rust command names are registered.

- [ ] **Step 4: Commit**

```bash
git add src/api/chatHistory.ts src/api/tauri.ts
git commit -m "feat(chat): add history api wrappers"
```

### Task 6: Add Conversation Title And Context Utilities

**Files:**

- Create: `src/lib/chatTitle.ts`
- Create: `src/lib/contextBudget.ts`
- Create: `src/lib/contextBudget.test.ts`
- Test: `npm test -- src/lib/contextBudget.test.ts`

- [ ] **Step 1: Write utility tests**

Create tests:

```ts
import { createConversationTitle } from "./chatTitle";
import { buildContextWindow, estimateTokenCount } from "./contextBudget";

it("creates a short title from the first user message", () => {
  expect(createConversationTitle("请帮我写一个 Rust 文件存储方案，要求安全可靠")).toBe(
    "请帮我写一个 Rust 文件存储方案",
  );
});

it("estimates cjk and ascii text without returning zero", () => {
  expect(estimateTokenCount("hello world 你好")).toBeGreaterThan(3);
});

it("keeps newest user message when trimming context", () => {
  const result = buildContextWindow({
    systemPrompt: "你是助手",
    messages: [
      { id: "old", role: "user", content: "旧消息".repeat(100), createdAt: "1", status: "complete" },
      { id: "new", role: "user", content: "最新问题", createdAt: "2", status: "complete" },
    ],
    contextSize: 64,
    maxTokens: 16,
  });
  expect(result.messages.at(-1)?.id).toBe("new");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/lib/contextBudget.test.ts
```

Expected: fails because utilities do not exist.

- [ ] **Step 3: Implement deterministic title generation**

In `chatTitle.ts`, normalize whitespace, remove Markdown markers, cap at 18 Chinese characters or 36 Latin characters, and fall back to `"新对话"`.

- [ ] **Step 4: Implement context budget**

In `contextBudget.ts`, export:

```ts
export interface ContextWindowInput {
  systemPrompt: string;
  messages: ChatMessage[];
  contextSize: number;
  maxTokens: number;
}

export interface ContextWindowResult {
  messages: ChatMessage[];
  estimatedPromptTokens: number;
  trimmedMessageCount: number;
  overBudget: boolean;
}
```

Implement the budget rules from the Request And Context Rules section.

- [ ] **Step 5: Verify tests**

Run:

```bash
npm test -- src/lib/contextBudget.test.ts
```

Expected: all utility tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chatTitle.ts src/lib/contextBudget.ts src/lib/contextBudget.test.ts
git commit -m "feat(chat): add title and context utilities"
```

### Task 7: Build Chat Workspace Hook

**Files:**

- Create: `src/hooks/useChatWorkspace.ts`
- Create: `src/hooks/useChatWorkspace.test.tsx`
- Test: `npm test -- src/hooks/useChatWorkspace.test.tsx`

- [ ] **Step 1: Write hook tests with mocked API**

Test these behaviors:

- loads index on mount;
- creates a new conversation and selects it;
- saves a renamed title;
- deletes active conversation and selects the next newest conversation;
- uses in-memory mode when history is disabled.

Use Vitest mocks for `src/api/chatHistory.ts`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/hooks/useChatWorkspace.test.tsx
```

Expected: fails because the hook does not exist.

- [ ] **Step 3: Implement hook state**

Expose:

```ts
export interface UseChatWorkspaceResult {
  conversations: ChatConversationSummary[];
  activeConversation: ChatConversation | null;
  loading: boolean;
  error: string | null;
  createConversation: () => Promise<ChatConversation>;
  selectConversation: (id: string) => Promise<void>;
  saveConversation: (conversation: ChatConversation) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  branchFromMessage: (messageId: string) => Promise<ChatConversation | null>;
}
```

- [ ] **Step 4: Implement summary updates locally before persistence**

When appending messages, update `updatedAt`, `messageCount`, `lastMessagePreview`, `modelPath`, and `modelName` before calling `saveChatConversation`. This keeps UI responsive while Rust writes JSON.

- [ ] **Step 5: Verify hook tests**

Run:

```bash
npm test -- src/hooks/useChatWorkspace.test.tsx
```

Expected: all workspace hook tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useChatWorkspace.ts src/hooks/useChatWorkspace.test.tsx
git commit -m "feat(chat): manage conversation workspace state"
```

### Task 8: Build Chat Generation Hook

**Files:**

- Create: `src/hooks/useChatGeneration.ts`
- Create: `src/hooks/useChatGeneration.test.tsx`
- Modify: `src/hooks/useChatSession.ts`
- Test: `npm test -- src/hooks/useChatGeneration.test.tsx`

- [ ] **Step 1: Write streaming tests**

Mock `streamChatCompletion` and verify:

- user message is added;
- assistant message starts as `streaming`;
- `contentDelta` appends to `content`;
- `reasoningDelta` appends to `reasoningContent`;
- abort marks assistant message as `cancelled`;
- HTTP failure marks assistant message as `failed` and stores `error`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/hooks/useChatGeneration.test.tsx
```

Expected: fails because hook does not exist.

- [ ] **Step 3: Implement generation hook**

Expose:

```ts
export interface UseChatGenerationOptions {
  port: number;
  sampling: SamplingParameters;
  contextSize: number;
  modelPath: string | null;
  modelName: string | null;
  activeConversation: ChatConversation | null;
  saveConversation: (conversation: ChatConversation) => Promise<void>;
  appendSystemLog: (message: string) => void;
}
```

Return:

```ts
{
  streaming,
  streamTokensPerSecond,
  sendMessage,
  cancelGeneration,
  regenerateFromMessage,
  editUserMessageAndResend,
}
```

- [ ] **Step 4: Use context window builder**

Before sending, call `buildContextWindow`. Build request messages from retained messages only. Never include `reasoningContent`.

- [ ] **Step 5: Preserve browser preview behavior**

When `!isTauriRuntime()`, append a deterministic preview assistant message with:

```ts
content: "这是浏览器预览模式的模拟回复。"
```

If attachments exist, use:

```ts
content: "这是浏览器预览模式的模拟回复；真实多模态输入会在 Tauri 应用中发送给 llama-server。"
```

- [ ] **Step 6: Deprecate old hook**

Keep `useChatSession.ts` temporarily as a wrapper only if `App.tsx` still imports it during intermediate commits. Remove it in the integration task.

- [ ] **Step 7: Verify tests**

Run:

```bash
npm test -- src/hooks/useChatGeneration.test.tsx
```

Expected: all generation hook tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useChatGeneration.ts src/hooks/useChatGeneration.test.tsx src/hooks/useChatSession.ts
git commit -m "feat(chat): stream generated content into conversations"
```

### Task 9: Upgrade Markdown Rendering

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/components/MarkdownContent.tsx`
- Create: `src/components/MarkdownContent.test.tsx`
- Test: `npm test -- src/components/MarkdownContent.test.tsx`

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install react-markdown remark-gfm rehype-sanitize highlight.js
```

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 2: Write rendering tests**

Cover table, task list, safe link, stripped script, and code block copy button.

- [ ] **Step 3: Replace custom parser**

Use `react-markdown` with:

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeSanitize]}
  components={components}
>
  {text}
</ReactMarkdown>
```

For `a`, add `target="_blank"` and `rel="noreferrer"`. For `code`, render inline code or a fenced code block with language class detection.

- [ ] **Step 4: Add code copy action**

For fenced code blocks, render a small icon button with `aria-label="复制代码"`. Use `navigator.clipboard.writeText` when available and fall back to a selected hidden textarea only if browser restrictions require it in Tauri.

- [ ] **Step 5: Verify tests**

Run:

```bash
npm test -- src/components/MarkdownContent.test.tsx
```

Expected: all Markdown tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/MarkdownContent.tsx src/components/MarkdownContent.test.tsx
git commit -m "feat(chat): render safe github flavored markdown"
```

### Task 10: Build Chat UI Components

**Files:**

- Create: `src/components/chat/ChatWorkspace.tsx`
- Create: `src/components/chat/ConversationSidebar.tsx`
- Create: `src/components/chat/ConversationTitleBar.tsx`
- Create: `src/components/chat/ChatThread.tsx`
- Create: `src/components/chat/ChatMessageItem.tsx`
- Create: `src/components/chat/ReasoningDisclosure.tsx`
- Create: `src/components/chat/ChatComposer.tsx`
- Create: `src/components/chat/MessageActions.tsx`
- Create: `src/components/chat/ChatWorkspace.test.tsx`
- Modify: `src/styles.css`
- Test: `npm test -- src/components/chat/ChatWorkspace.test.tsx`

- [ ] **Step 1: Write UI behavior tests**

Use Testing Library to verify:

- "新建对话" calls `createConversation`;
- search filters conversations;
- clicking a conversation calls `selectConversation`;
- reasoning disclosure toggles content visibility;
- stopped runtime disables composer;
- `Cmd+Enter` sends message when composer has text.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/components/chat/ChatWorkspace.test.tsx
```

Expected: fails because components do not exist.

- [ ] **Step 3: Implement ConversationSidebar**

Props:

```ts
interface ConversationSidebarProps {
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
}
```

Group by pinned, today, yesterday, previous 7 days, older. Use Chinese group labels.

- [ ] **Step 4: Implement ChatThread**

Use a scroll container ref. Auto-scroll only when the current scroll position is within 80px of the bottom. Show "跳到底部" when streaming and user has scrolled away from the bottom.

- [ ] **Step 5: Implement ChatMessageItem**

Render user and assistant messages with:

- role label;
- attachment thumbnails;
- `ReasoningDisclosure` for assistant reasoning;
- `MarkdownContent` for assistant content;
- pre-wrapped paragraph for user text;
- status footer for failed/cancelled messages;
- `MessageActions`.

- [ ] **Step 6: Implement ChatComposer**

Move image selection logic from `ChatPanel.tsx` into this component. Preserve v1 limits:

- maximum 4 images;
- maximum 8 MB per image;
- thumbnail size 128px;
- accepted MIME types: PNG, JPEG, WebP, GIF.

- [ ] **Step 7: Implement workspace composition**

`ChatWorkspace` receives hooks and runtime state through props. It should not import Tauri APIs directly.

- [ ] **Step 8: Add CSS**

Replace old `.chat-view`, `.chat-list`, and `.chat-message` styles with namespaced classes:

- `.chat-workspace`
- `.conversation-sidebar`
- `.chat-thread`
- `.chat-message-item`
- `.reasoning-disclosure`
- `.chat-composer`

Keep cards at 8px radius or less except the composer pill, which may use a larger radius like v1.

- [ ] **Step 9: Verify tests**

Run:

```bash
npm test -- src/components/chat/ChatWorkspace.test.tsx
```

Expected: all component tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/chat src/styles.css
git commit -m "feat(chat): add chat workspace components"
```

### Task 11: Implement Message Actions

**Files:**

- Modify: `src/components/chat/MessageActions.tsx`
- Modify: `src/hooks/useChatWorkspace.ts`
- Modify: `src/hooks/useChatGeneration.ts`
- Modify: `src/components/chat/ChatWorkspace.test.tsx`
- Test: `npm test -- src/components/chat/ChatWorkspace.test.tsx src/hooks/useChatGeneration.test.tsx`

- [ ] **Step 1: Add action tests**

Cover:

- copy assistant content;
- edit user message and resend;
- regenerate assistant message;
- delete a user+assistant pair;
- branch from a selected message.

- [ ] **Step 2: Implement copy**

Use `navigator.clipboard.writeText(message.content)`. Disable copy when content is empty.

- [ ] **Step 3: Implement edit and resend**

When editing a user message:

1. Replace the user message content.
2. Remove following assistant messages in the same branch.
3. Trigger generation from the edited message.

- [ ] **Step 4: Implement regenerate**

When regenerating an assistant message:

1. Find the nearest preceding user message.
2. Remove the assistant message and later messages.
3. Generate a new assistant message using the same conversation.

- [ ] **Step 5: Implement delete pair**

When deleting an assistant message, delete only that assistant message. When deleting a user message, delete that user message and the immediate following assistant message if present.

- [ ] **Step 6: Implement branch**

Create a new conversation with messages through the selected message. Set title to the original title plus " 分支". Select the new conversation.

- [ ] **Step 7: Verify tests**

Run:

```bash
npm test -- src/components/chat/ChatWorkspace.test.tsx src/hooks/useChatGeneration.test.tsx
```

Expected: all message action tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/MessageActions.tsx src/hooks/useChatWorkspace.ts src/hooks/useChatGeneration.ts src/components/chat/ChatWorkspace.test.tsx
git commit -m "feat(chat): add message actions"
```

### Task 12: Integrate Chat Workspace Into App

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/components/AppLayout.tsx`
- Delete: `src/components/ChatPanel.tsx`
- Delete: `src/components/ChatPanel.test.tsx`
- Delete: `src/hooks/useChatSession.ts`
- Delete: `src/hooks/useChatSession.test.tsx`
- Test: `npm test && npm run build`

- [ ] **Step 1: Wire hooks in `App.tsx`**

Instantiate `useChatWorkspace` with `settings.chatHistory` after settings bootstrap. Instantiate `useChatGeneration` with:

- `port`;
- `profile.sampling`;
- `startupParameters.ctxSize`;
- `selectedModel?.path ?? null`;
- `selectedModel?.fileName ?? null`;
- `activeConversation`;
- `saveConversation`;
- `appendSystemLog`.

- [ ] **Step 2: Render ChatWorkspace**

Replace:

```tsx
<ChatPanel ... />
```

with:

```tsx
<ChatWorkspace
  runtimeStatus={runtimeStatus}
  selectedModel={selectedModel}
  conversations={conversations}
  activeConversation={activeConversation}
  streaming={streaming}
  streamTokensPerSecond={streamTokensPerSecond}
  onCreateConversation={createConversation}
  onSelectConversation={selectConversation}
  onSaveConversation={saveConversation}
  onRenameConversation={renameConversation}
  onDeleteConversation={deleteConversation}
  onBranchFromMessage={branchFromMessage}
  onSend={sendMessage}
  onCancel={cancelGeneration}
  onRegenerate={regenerateFromMessage}
  onEditAndResend={editUserMessageAndResend}
/>
```

- [ ] **Step 3: Preserve runtime metric display**

Keep `displayedRuntimeMetrics.tokensPerSecond` using stream token speed fallback.

- [ ] **Step 4: Remove old files**

Delete old panel and hook after all imports are migrated.

- [ ] **Step 5: Verify full frontend**

Run:

```bash
npm test
npm run build
```

Expected: all frontend tests pass and production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/AppLayout.tsx src/components/chat src/styles.css src/hooks
git rm src/components/ChatPanel.tsx src/components/ChatPanel.test.tsx src/hooks/useChatSession.ts src/hooks/useChatSession.test.tsx
git commit -m "feat(chat): integrate v2 workspace"
```

### Task 13: Add Export And Privacy Controls

**Files:**

- Modify: `src-tauri/src/chat_history.rs`
- Modify: `src-tauri/tests/chat_history_tests.rs`
- Modify: `src/components/chat/ConversationSidebar.tsx`
- Modify: `src/components/chat/ChatWorkspace.tsx`
- Modify: `src/styles.css`
- Test: `npm test && cd src-tauri && cargo test chat_history`

- [ ] **Step 1: Add export tests**

Rust test should save a conversation with user, assistant content, and reasoning. Export Markdown twice:

- without reasoning: output contains user and assistant content, not reasoning;
- with reasoning: output includes a "思考过程" section.

- [ ] **Step 2: Implement JSON export**

`export_chat_conversation_command` with `format: "json"` writes the conversation document to `<app_data_dir>/chat-history/exports/<conversation-title>-<timestamp>.json` and returns the absolute path. This avoids adding save-dialog permissions inside the chat-history task.

- [ ] **Step 3: Implement Markdown export**

Markdown format:

```md
# Conversation Title

- Model: model-name
- Created: 2026-05-09T00:00:00.000Z
- Updated: 2026-05-09T00:00:00.000Z

## User

...

## Assistant

...
```

If reasoning is included, add:

```md
<details>
<summary>思考过程</summary>

...

</details>
```

- [ ] **Step 4: Add clear history action**

Add a destructive confirmation before `clearChatHistory`. Since this is externally visible data loss inside the app, require a second click or confirmation modal.

- [ ] **Step 5: Add history disabled behavior**

When `chatHistory.enabled` is false:

- do not call save APIs;
- keep only the current in-memory conversation;
- display "未保存" in the title bar;
- disable conversation search and export for unsaved conversations unless exporting current memory conversation is implemented.

- [ ] **Step 6: Verify tests**

Run:

```bash
npm test
cd src-tauri && cargo test chat_history
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/chat_history.rs src-tauri/tests/chat_history_tests.rs src/components/chat src/styles.css
git commit -m "feat(chat): add export and privacy controls"
```

### Task 14: Add Keyboard Shortcuts And Accessibility Pass

**Files:**

- Modify: `src/components/chat/ChatWorkspace.tsx`
- Modify: `src/components/chat/ConversationSidebar.tsx`
- Modify: `src/components/chat/ChatComposer.tsx`
- Modify: `src/components/chat/ReasoningDisclosure.tsx`
- Modify: `src/components/chat/ChatWorkspace.test.tsx`
- Test: `npm test -- src/components/chat/ChatWorkspace.test.tsx`

- [ ] **Step 1: Add shortcut tests**

Test:

- `Cmd+K` focuses search;
- `Cmd+Shift+O` creates conversation;
- `Esc` cancels streaming;
- `Esc` closes open menu when not streaming.

- [ ] **Step 2: Add ARIA labels**

Required labels:

- search input: `aria-label="搜索对话"`
- new conversation button: `aria-label="新建对话"`
- reasoning disclosure button: `aria-expanded`
- message actions menu: `aria-label="消息操作"`
- attachment input: `aria-label="选择图片附件"`
- composer textarea: `aria-label="输入消息"`

- [ ] **Step 3: Preserve focus**

After creating a conversation, focus the composer. After deleting a conversation, focus the selected conversation row or the new conversation button if the list is empty.

- [ ] **Step 4: Verify shortcut tests**

Run:

```bash
npm test -- src/components/chat/ChatWorkspace.test.tsx
```

Expected: all shortcut and accessibility tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat
git commit -m "feat(chat): add workspace shortcuts and accessibility"
```

### Task 15: Visual QA And Performance Checks

**Files:**

- Modify: `src/styles.css`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Test: browser manual QA, `npm run build`, `npm test`, `cd src-tauri && cargo test`

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm test
npm run build
cd src-tauri && cargo test
```

Expected: all pass.

- [ ] **Step 2: Start dev server**

Run:

```bash
npm run dev
```

Expected: Vite serves the app, usually at `http://localhost:5173`.

- [ ] **Step 3: Browser preview QA**

Check:

- `1000x760`: no overlapping title bar, sidebar, composer, or status bar.
- `1180x760`: conversation sidebar and message list are both usable.
- `1440x900`: message width remains readable and does not stretch edge to edge.
- Markdown table scrolls horizontally inside message body.
- Code block copy button is visible and does not cover code text.
- Reasoning disclosure expands and collapses without layout jump.
- Long Chinese and long English words do not overflow buttons.

- [ ] **Step 4: Tauri smoke QA**

Run:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run tauri:dev
```

Manual checks:

- load settings from v1 profile;
- start a small model;
- create a conversation;
- stream a reply;
- cancel generation;
- regenerate;
- restart app and confirm saved conversation appears;
- delete conversation and confirm JSON file is removed;
- export Markdown and JSON.

- [ ] **Step 5: Update docs**

In `README.md`, update current status and v2 highlights. In `CHANGELOG.md`, add an unreleased v2.0 section with user-facing changes.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css README.md CHANGELOG.md
git commit -m "docs: document v2 chat workspace"
```

## Testing Matrix

### Frontend Unit Tests

Run:

```bash
npm test
```

Required coverage areas:

- stream parser separates answer and reasoning deltas;
- `<think>` extraction works for closed and open tags;
- request body excludes reasoning content;
- context budget keeps newest user message;
- workspace hook loads, creates, saves, deletes, and branches conversations;
- generation hook handles success, cancellation, and failure;
- Markdown renderer supports GFM and sanitizes unsafe HTML;
- chat components handle search, selection, send, cancel, reasoning toggle, message actions, and shortcuts.

### Rust Tests

Run:

```bash
cd src-tauri && cargo test
```

Required coverage areas:

- schema v1 settings migration;
- schema v2 settings round trip;
- chat history index load when missing;
- conversation save/load/delete;
- path traversal rejection;
- clear history removes index, conversations, attachments, and exports;
- Markdown export excludes reasoning by default and includes reasoning when requested.

### Manual Runtime Tests

Use a small local GGUF model from the configured model directory.

Test cases:

- healthy runtime enables composer;
- stopped runtime disables send but allows history browsing;
- streaming answer updates visible content;
- reasoning model updates reasoning disclosure when `reasoning_content` exists;
- `<think>` model output is split into reasoning and answer;
- cancellation leaves a cancelled assistant message with partial content;
- restart app preserves saved conversations;
- disabling history prevents new conversations from being written;
- deleting a conversation removes it from the sidebar after restart;
- exporting returns a readable file path.

## Release Acceptance Criteria

v2.0 is ready when all of these are true:

- A user can create, continue, rename, search, pin, delete, and export local conversations.
- The app cleanly separates visible answer text from model reasoning.
- Reasoning is collapsible and hidden by default after generation completes.
- Markdown rendering handles tables, task lists, code blocks, links, and unsafe HTML safely.
- Message actions work for copy, edit, regenerate, delete, and branch.
- Conversation history persists across app restarts when enabled.
- History can be disabled without breaking in-memory chat.
- Context budget warning appears before long conversations silently lose old context.
- Existing v1 settings load without data loss.
- Frontend tests, Rust tests, and production build pass.
- Visual QA passes at `1000x760`, `1180x760`, and `1440x900`.

## Implementation Order

Recommended order:

1. Domain types.
2. Streaming parser and reasoning helpers.
3. Rust storage.
4. Settings migration.
5. Frontend history API.
6. Title and context utilities.
7. Workspace hook.
8. Generation hook.
9. Markdown renderer.
10. UI components.
11. Message actions.
12. App integration.
13. Export and privacy controls.
14. Shortcuts and accessibility.
15. QA and release docs.

This order keeps each commit testable and avoids tying UI work to unimplemented storage.

## Self-Review Notes

- Scope is focused on chat workspace v2.0 and excludes RAG, plugins, cloud sync, and multi-model orchestration.
- Data persistence has explicit migration rules for v1 settings.
- Reasoning is modeled separately from visible content in parser, state, UI, and export.
- Tests are defined for parser, storage, settings migration, hooks, UI behavior, Markdown rendering, and runtime smoke flows.
- The plan does not require changing inference backend architecture; `llama-server` remains the generation provider.
