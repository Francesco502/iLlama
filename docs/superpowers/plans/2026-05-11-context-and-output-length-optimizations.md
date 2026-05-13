# Context & Output Length Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 iLlama 中引入真实 token/usage 统计并用于预算校准，升级 token 估算（含图片）、改进截断/压缩策略，并增加 `maxTokens`/`ctxSize`/模型 `contextLength` 的联动提示与一键操作，最终让“上下文更稳、统计更准、体验更可解释”，且在 server 不支持时可靠降级。

**Architecture:** 以“优先使用 server `usage` → 其次 tokenize（可探测）→ 启发式兜底”的分层策略实现。数据层扩展 `ChatGenerationStats` 承接真实 token；请求解析层（`src/api/chat.ts`）宽松解析 usage；生成逻辑（`useChatGeneration`）用真实 token 更新统计并改造流式计数；预算/截断（`contextBudget`）升级为按价值保留；UI 侧添加预算解释与一键对齐/预设动作。

**Tech Stack:** React + TypeScript + Vitest（前端），Tauri/Rust（模型扫描元数据已存在），本地 `llama-server`（OpenAI 兼容 `/v1/chat/completions`）。

---

## File Structure / Touch List

**Modify (types & data):**
- Modify: `src/types/chat.ts`（扩展 `ChatGenerationStats` 支持 prompt/completion/total）

**Modify (API parsing):**
- Modify: `src/api/chat.ts`（解析 completion/stream 事件中的 `usage`，兼容缺失字段）
- Modify: `src/api/chat.test.ts`（新增 usage 解析覆盖）

**Modify (generation + stats):**
- Modify: `src/hooks/useChatGeneration.ts`（使用真实 token 更新 stats；改造流式 generatedTokens 逻辑）
- Modify: `src/hooks/useChatGeneration.test.tsx`（更新与新增统计相关断言）
- Modify: `src/lib/runtimeMetrics.ts`（新增“增量 token 估算计数”，保留旧接口或逐步替换）
- Modify: `src/lib/runtimeMetrics.test.ts`（覆盖新计数逻辑）

**Modify (budget + truncation):**
- Modify: `src/lib/contextBudget.ts`（启发式升级、图片 token 估算、截断策略按价值保留）
- Modify: `src/lib/contextBudget.test.ts`（新增“附件/代码块优先保留”的测试）

**Modify (UI / validation / linkage):**
- Modify: `src/components/ParameterPanel.tsx`（展示“有效历史预算”、warning、预设按钮）
- Modify: `src/components/ParameterPanel.test.tsx`（新增预算提示/预设行为测试）
- Modify: `src/App.tsx`（把 selectedModel.contextLength 与 parameters.ctxSize 的错位提示与“一键对齐”落地到合适区域）

**Optional (capability probing / tokenize):**
- Create: `src/api/llamaCapabilities.ts`（一次性探测与缓存：usage-in-stream? tokenize endpoint?）
- Test: `src/api/llamaCapabilities.test.ts`

---

## Conventions / Compatibility Targets

- **Usage 解析**：宽松解析，允许以下存在/缺失：
  - `payload.usage.prompt_tokens|completion_tokens|total_tokens`
  - SSE 事件中在任意 event 上出现 usage（通常最后一条），以“最新一次”为准
- **不阻塞聊天**：能力探测必须异步、缓存、失败快速短路；聊天主路径不依赖探测结果。
- **来源标注（可选）**：UI 如需标注来源，使用简单枚举（`"server" | "estimate"`）但不强制第一阶段就落 UI 标注（可作为后续增强）。

---

## Task 1: Extend chat stats to store real token usage

**Files:**
- Modify: `src/types/chat.ts`
- Test: Type changes compile via `pnpm test`（或现有测试命令）

- [ ] **Step 1: Write failing type expectations (via tests that access new fields)**

在 `src/hooks/useChatGeneration.test.tsx` 中新增断言（先写失败）：当我们后续把 usage 注入 stats 时，能访问 `promptTokens/completionTokens/totalTokens`。

- [ ] **Step 2: Implement minimal type extension**

修改 `ChatGenerationStats`：

```ts
export interface ChatGenerationStats {
  startedAt: string;
  completedAt: string | null;
  generatedTokens: number;
  tokensPerSecond: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  reasoningStartedAt?: string;
  reasoningCompletedAt?: string;
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: 当前会因为尚未注入这些字段而在新增断言处 FAIL（这是预期）。

- [ ] **Step 4: Commit**

```bash
git add src/types/chat.ts src/hooks/useChatGeneration.test.tsx
git commit -m "feat: extend chat stats for token usage"
```

---

## Task 2: Parse `usage` from non-streaming completion responses

**Files:**
- Modify: `src/api/chat.ts`
- Test: `src/api/chat.test.ts`

- [ ] **Step 1: Add failing unit test**

在 `src/api/chat.test.ts` 新增用例：`parseCompletionMessage()` 从 payload 中解析 usage。

示例 payload：

```json
{
  "choices":[{"message":{"content":"答案","reasoning_content":"推理"}}],
  "usage":{"prompt_tokens":12,"completion_tokens":34,"total_tokens":46}
}
```

期望：返回结构包含 usage（实现中可扩展返回类型，或通过新增函数 `parseUsage()` 暴露）。

- [ ] **Step 2: Implement usage parsing**

在 `src/api/chat.ts` 增加容错解析函数：

```ts
export interface ChatTokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}
```

并在 parse 中读取 `usage.prompt_tokens` 等字段（非数字则视为 null）。

- [ ] **Step 3: Run tests**

Run: `pnpm test src/api/chat.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/chat.ts src/api/chat.test.ts
git commit -m "feat: parse usage from chat completion responses"
```

---

## Task 3: Parse `usage` from streaming SSE events (best-effort)

**Files:**
- Modify: `src/api/chat.ts`
- Test: `src/api/chat.test.ts`

- [ ] **Step 1: Add failing unit test**

新增用例：`parseDeltaEvent()` 在事件 payload 中出现 usage 时能解析并返回（即使 delta 为空）。

事件示例：

```json
{"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}
```

- [ ] **Step 2: Extend delta type**

将 `ChatStreamDelta` 扩展为：

```ts
export interface ChatStreamDelta {
  contentDelta: string;
  reasoningDelta: string;
  usage?: ChatTokenUsage;
}
```

并在 `parseDeltaEvent()` 中附加 `usage`（如果存在）。

- [ ] **Step 3: Run tests**

Run: `pnpm test src/api/chat.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/chat.ts src/api/chat.test.ts
git commit -m "feat: extract usage from streaming delta events"
```

---

## Task 4: Replace “+1 per delta” with real/estimated token accounting during streaming

**Files:**
- Modify: `src/hooks/useChatGeneration.ts`
- Modify: `src/lib/runtimeMetrics.ts`
- Test: `src/lib/runtimeMetrics.test.ts`
- Test: `src/hooks/useChatGeneration.test.tsx`

- [ ] **Step 1: Write failing unit tests for new token accounting**

在 `runtimeMetrics.test.ts` 增加对新函数的测试（例如 `estimateDeltaTokens(deltaText)`），确保空白为 0，中文/英文混排 > 0。

- [ ] **Step 2: Implement incremental token estimation helper**

在 `src/lib/runtimeMetrics.ts` 新增：

```ts
export function estimateDeltaTokens(deltaText: string): number {
  // call into contextBudget.estimateTokenCount or a new shared estimator
}
```

并逐步弃用/保留 `countStreamToken()`（第一阶段可保留但生成逻辑不再用）。

- [ ] **Step 3: Update `useChatGeneration`**

逻辑：

- 若 `delta.usage?.completionTokens` 存在：将 `generatedTokens` 更新为该值（以最新为准）
- 否则：`generatedTokens += estimateDeltaTokens(delta.contentDelta || delta.reasoningDelta)`

同时将 `ChatMessage.stats.promptTokens/completionTokens/totalTokens` 用 `delta.usage` 刷新（若存在）。

- [ ] **Step 4: Run tests**

Run: `pnpm test src/lib/runtimeMetrics.test.ts src/hooks/useChatGeneration.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/runtimeMetrics.ts src/lib/runtimeMetrics.test.ts src/hooks/useChatGeneration.ts src/hooks/useChatGeneration.test.tsx
git commit -m "feat: align streaming token stats with usage or delta estimates"
```

---

## Task 5: Upgrade context budgeting (text estimator + image token estimation)

**Files:**
- Modify: `src/lib/contextBudget.ts`
- Modify: `src/lib/contextBudget.test.ts`

- [ ] **Step 1: Add failing tests**

新增测试：
- “含代码块的消息”优先保留（在同预算下，代码块消息被保留，普通短消息被丢弃）
- “含附件的用户消息”优先保留

- [ ] **Step 2: Implement image token estimate (best-effort)**

第一阶段（不解码图片尺寸）：使用附件 mimeType + sizeBytes 的粗估（更优于常数），并保留常数兜底。
第二阶段（可选）：对 dataUrl 尝试解析宽高（仅在浏览器运行环境），否则兜底。

- [ ] **Step 3: Implement value-based trimming**

在 `buildContextWindow()` 中：
- 计算每条消息 `tokens` 与 `priority`
- 先保证保留最新 user message（现有行为）
- 在预算不足时按 priority 丢弃

- [ ] **Step 4: Run tests**

Run: `pnpm test src/lib/contextBudget.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/contextBudget.ts src/lib/contextBudget.test.ts
git commit -m "feat: improve context trimming and attachment token estimates"
```

---

## Task 6: `maxTokens` / `ctxSize` linkage UI (budget hints + presets)

**Files:**
- Modify: `src/components/ParameterPanel.tsx`
- Modify: `src/components/ParameterPanel.test.tsx`

- [ ] **Step 1: Add failing component test**

新增测试：点击“长记忆”会降低 maxTokens（具体落点取决于采样参数 UI 存放位置；若当前 ParameterPanel 未编辑 sampling，则把 preset 放到采样面板对应组件）。

> 若当前 UI 没有 sampling 编辑入口，此任务需要先定位采样参数编辑组件并在那实现 preset；ParameterPanel 只做 ctxSize 侧的预算提示。

- [ ] **Step 2: Implement budget hint UI**

显示：
- ctxSize
- maxTokens
- 估算的系统/记忆占用（若可取到）
- 有效历史预算（估算）

并在预算过小显示 warning。

- [ ] **Step 3: Run tests**

Run: `pnpm test src/components/ParameterPanel.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/ParameterPanel.tsx src/components/ParameterPanel.test.tsx
git commit -m "feat: add ctx/maxTokens budget hints and presets"
```

---

## Task 7: `ctxSize` vs model `contextLength` mismatch warnings + one-click align

**Files:**
- Modify: `src/App.tsx`
- Test: (add or extend existing App-level tests if present; otherwise do lightweight unit tests for helper)

- [ ] **Step 1: Implement helper to compute mismatch state**

新增纯函数（可放 `src/lib/modelContext.ts`）：
- 输入：`selectedModel.contextLength`, `parameters.ctxSize`
- 输出：状态（ok/warn/info）+ 建议值

- [ ] **Step 2: Wire UI**

在展示模型 contextLength 的区域附近加入：
- warning 文案
- “一键对齐”按钮（设置 ctxSize = 建议值）

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/lib/modelContext.ts
git commit -m "feat: warn when ctxSize exceeds model context length"
```

---

## Task 8 (Optional): Capability probing (tokenize endpoint, usage in stream)

**Files:**
- Create: `src/api/llamaCapabilities.ts`
- Test: `src/api/llamaCapabilities.test.ts`

- [ ] **Step 1: Implement probe with caching**

Probe candidates (ordered, each with short timeout):
- `GET /v1/models`（if available; can infer server type）
- `POST /tokenize` / `POST /v1/tokenize` / `POST /tokenize` (common variants)

Return:
- `supportsUsageInStream` (unknown/true/false)
- `supportsTokenize` (unknown/true/false)

- [ ] **Step 2: Wire to estimator selection**

如果 supportsTokenize 为 true，则在预算计算时可用该接口（后续版本可实现；本任务可只做探测与缓存，不强耦合）。

- [ ] **Step 3: Commit**

```bash
git add src/api/llamaCapabilities.ts src/api/llamaCapabilities.test.ts
git commit -m "feat: probe llama-server capabilities with safe caching"
```

---

## Plan Self-Review

- **Spec coverage**：本计划覆盖 7 项优化的核心落点：
  - usage 校准：Task 2-4
  - token 估算升级（含图）：Task 4-5
  - maxTokens/ctxSize 联动：Task 6
  - ctxSize/contextLength 联动：Task 7
  - 截断策略：Task 5
  - 压缩/摘要参数化：后续可在 Task 5/6 后追加（若需要立即做，可加 Task 9）
  - 统计体验：Task 4 + UI 可后续补充展示
- **Placeholder scan**：若发现“取决于采样面板位置”的不确定点，在执行阶段先定位采样 UI（`maxTokens` 调整入口）并在 Task 6 中具体化。
- **Type consistency**：新增类型 `ChatTokenUsage`、`usage` 字段贯穿 `chat.ts` 与 `useChatGeneration.ts`，避免命名漂移。

---

## Execution Handoff

计划已写入：`docs/superpowers/plans/2026-05-11-context-and-output-length-optimizations.md`。

两种执行方式：

1. **Subagent-Driven（推荐）**：我按 Task 分派子任务并逐个 review（更快且更稳）
2. **Inline Execution**：我在本会话内按 Task 顺序直接改代码并跑测试

你选哪一种？

