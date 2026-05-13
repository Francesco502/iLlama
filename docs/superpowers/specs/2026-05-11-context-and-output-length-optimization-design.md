# iLlama：模型输出长度与上下文长度优化设计（v1）

日期：2026-05-11  
Status: **Implemented / Released in v2.1.1**（应用侧目标已落地；剩余 tokenizer 精准计量等方向作为后续增强，见文末「实现进度」）

## 实现进度（与代码库对齐，2026-05-12）

已落地或部分落地：

- 被动解析 `usage`（流式 / 非流式）、会话统计展示与估算回退。
- 上下文窗口价值导向裁剪、压缩触发自适应、`maxTokens`/`ctxSize` 与模型 `contextLength` 的 UI 提示与一键对齐。
- **续写**：assistant-tail + 失败降级 user-merged；首轮成功但无新内容 / completion 未增长时亦自动 user-merged。
- **finish_reason**：流末缺失时 length 推断；少见 reason 的 UI 提示；可选 `VITE_FINISH_REASON_DOC_URL` 外链；系统在部分「无 reason 且未打满 maxTokens」场景写轻量日志。
- **KV + maxTokens**：KV 告警区展示建议上限，并支持一键写入采样 `maxTokens`。
- **附件**：文本/代码类「伪附件」经 composer 进入请求体（合并为文本块），与图片多模态并存时走 multipart content。
- **会话列表**：按更新时间筛选（今天 / 7 天 / 30 天）、按当前模型路径筛选；侧栏删除确认 Esc 关闭。
- **缓存**：对话内存缓存按 LRU 顺序淘汰（最近访问的会话在 Map 末尾）。
- **代码块高亮 HTML**：hljs 输出路径加强消毒（事件处理器、危险标签）。
- **Prometheus**：`parse_prometheus_metrics` 增加 fixture 单测。
- **CI**：`.github/workflows/ci.yml` 含 `npm test`、`tsc`、`npm run build` 与 `cargo fmt/clippy/test`。

仍属中长期 / 非目标内未做项：

- 本地 tokenizer / 服务端 tokenize 探测与持久化缓存。
- 图片 token 按分辨率精确估算（当前仍为启发式增强空间）。
- 将 `useChatGeneration` / `App.tsx` 进一步拆分为独立子模块（可持续重构）。

## 背景与问题

当前项目对“上下文预算”和“输出长度（`max_tokens`）”的控制主要依赖前端启发式估算：

- **上下文窗口裁剪**：`src/lib/contextBudget.ts` 的 `estimateTokenCount()` 用简单权重估算 token，`buildContextWindow()` 根据 `ctxSize` 与 `maxTokens` 推导可用预算，保留最新消息并尽量向前保留历史，超预算则直接跳过。
- **输出长度限制**：`src/api/chat.ts` 将 `sampling.maxTokens` 映射到请求体 `max_tokens`。
- **统计（TPS/生成 token）**：`src/lib/runtimeMetrics.ts` 的 `countStreamToken()` 对流式增量按“非空 delta +1”计数，属于粗略近似。
- **对话压缩**：`src/hooks/useChatGeneration.ts` 在超过阈值时调用一次非流式补全生成摘要，以减少历史消息占用。

上述实现简单可靠，但主要短板是：

1. 预算估算与真实 tokenizer 可能偏差较大（尤其中文、代码混排与多模态）。
2. `maxTokens` 增大将直接挤压可用历史上下文，但 UI/校验缺乏直观提示与一键预设。
3. 模型 GGUF 元数据存在 `contextLength`，但 `ctxSize` 可能与之错位（浪费资源或无效配置）。
4. 截断策略“仅保最新、丢最旧”易误删关键消息（含附件/代码/指令）。
5. 流式统计与真实 token 不一致，无法可靠显示“剩余可生成 token”等体验指标。

## 目标（对应 7 项优化）

1. **用服务端真实用量校准预算**：若响应中存在 `usage.prompt_tokens` / `completion_tokens` / `total_tokens`（或同义字段），优先使用其作为真实计量来源，用于校准预算与统计展示；不可用时自动降级。
2. **更准确的 token 计量**：
   - 短中期：接入 llama.cpp 兼容 tokenizer（优先 server 能力；否则本地估算增强）。
   - 视觉：图片 token 从固定常数改为按分辨率/patch 规则估算（可降级）。
3. **`maxTokens` 与 `ctxSize` 联动**：在 UI/校验中提示“长输出会减少可用历史”，并提供“长回复/长记忆”预设（可一键调整）。
4. **`ctxSize` 与模型 `contextLength` 联动**：当用户选择/保存配置时提示错位，并提供“一键对齐”按钮。
5. **截断策略优化**：在预算不足时优先保留高价值消息（附件/代码块/重要指令/最近 N 轮），尽量避免把关键内容整块丢掉；必要时插入轻量占位摘要。
6. **压缩触发与摘要质量**：将魔法数字参数化/自适应（随 `ctxSize`、模型或助手模式变化），并让摘要输出更稳定、更结构化（仍可展示为 Markdown）。
7. **统计与体验**：将流式生成 token 与 TPS 尽量与真实 token 计数一致；若只有估算则改用“增量估算”而非“每个 delta +1”。

## 非目标

- 不强依赖某一个特定 server 版本或必需具备 tokenize/usage 能力；必须具备良好降级路径。
- 不引入明显的交互延迟（能力探测需缓存结果并快速失败）。
- 不做大规模 UI 重构；仅增加必要的提示/按钮/展示字段。

## 总体方案（推荐：方案 A）

采用“**被动接入 usage + 可选探测 tokenize + 全面降级**”：

- **被动接入**：对所有响应（非流式 JSON 与流式 SSE 事件）尝试解析 `usage`（若存在），写入会话统计。
- **可选探测**：启动时或首次请求时做一次“tokenize 能力探测”（请求常见端点），将结果缓存；不阻塞正常聊天。
- **降级路径**：
  - 若有真实 usage：预算与统计优先使用真实 token。
  - 无 usage 但有 tokenize：可对 prompt 与增量进行更准确计数。
  - 两者皆无：使用增强后的启发式估算（文本 + 图片）。

## 数据模型变更

### `ChatGenerationStats` 扩展

在 `src/types/chat.ts` 中为 `ChatGenerationStats` 增加（均可选/可为 null）：

- `promptTokens?: number | null`
- `completionTokens?: number | null`
- `totalTokens?: number | null`

可选扩展（若 server 有对应指标）：

- `promptTokensPerSecond?: number | null`（与现有 runtime metrics 对齐）

目的：将“真实 token 统计”与“估算统计”统一落点，UI 不需要了解来源细节。

## API 解析与统计更新

### 非流式（`completeChatCompletion`）

- 在 `src/api/chat.ts` 的 `parseCompletionMessage()` 中：
  - 继续解析 `choices[0].message.content` 与 `reasoning_content`；
  - 新增解析 `usage` 字段（若存在），输出到 `ChatCompletionMessage` 的扩展结构（或新增返回类型）。

### 流式（`streamChatCompletion`）

- 在 `src/api/chat.ts` 的 `parseDeltaEvent()`：
  - 除 `delta.content` / `delta.reasoning_content` 外，额外尝试读取事件 payload 内的 `usage`（或其它统计字段）。
  - 允许“最后一个事件携带 usage”或“多次事件刷新 usage”，上层取最新值。

### 统一更新会话统计（`useChatGeneration.ts`）

- 将“generatedTokens”的更新逻辑改为：
  1. 如果收到真实 usage：以 `completionTokens` 或 `totalTokens` 推导生成 token；
  2. 否则使用“增量估算”（对新增文本片段做 token 估算累加），而不是 `countStreamToken(delta) => +1`。

## 更准确 token 计量设计

### 文本 token（启发式增强）

对 `src/lib/contextBudget.ts` 的 `estimateTokenCount()` 做增强以降低偏差：

- 为代码块、长数字串、连续标点、空白换行等模式单独加权；
- 保持计算成本极低（纯字符串/正则）。

> 注意：即便将来接入真实 tokenizer，启发式仍作为“无法获取真实 token 时”的兜底。

### 图片 token（按分辨率/patch 估算）

替换目前 `estimateMessageTokens()` 对附件固定 `256` 的做法：

- 读取图片宽高（浏览器端可通过创建 `Image()` 解码 dataUrl；若解码失败则降级为常数）。
- 用可配置的 patch 估算函数：`estimateImageTokens(width, height) -> number`
  - 默认按典型视觉模型 patch size（例如 14/16）近似；
  - 提供安全上限，避免极大图片导致预算爆炸。

落点：`src/lib/contextBudget.ts`（或抽到 `src/lib/tokenBudget.ts` 专门管理）。

## `maxTokens` 与 `ctxSize` 联动（UI/校验）

### 展示

在参数相关 UI 中增加“预算解释”：

- 显示估算的：
  - 系统+记忆占用
  - 预留输出（`maxTokens`）
  - 有效历史预算

当有效历史预算过小（例如小于 `ctxSize * 0.2` 或小于某固定阈值）提示 warning。

### 一键预设

增加两个便捷动作（不改已有内置 profile 结构）：

- **长回复**：提高 `maxTokens`（到合理上限），必要时建议增大 `ctxSize`
- **长记忆**：降低 `maxTokens`，以保留更多历史

## `ctxSize` 与模型 `contextLength` 联动

当用户已选择某个 GGUF 模型且该模型元数据包含 `contextLength`：

- 若 `parameters.ctxSize > selectedModel.contextLength`：
  - warning：可能无效或浪费显存/内存
  - 提供“一键对齐”按钮，将 `ctxSize` 调整为 `contextLength`（或略小的安全值）
- 若 `parameters.ctxSize` 远小于 `contextLength`：
  - info：提示可提高以获得更长上下文（不强制）

## 截断策略优化

对 `buildContextWindow()` 的策略升级为“按价值保留”：

- 定义消息重要性权重（可解释且稳定）：
  - 含附件：高权重
  - 含代码块（```）：高权重
  - 最近 N 轮：高权重（时间衰减）
  - 系统提示/记忆：单独计入（已有）
- 当预算不足：
  - 先丢低权重的短消息/寒暄
  - 尽量保留关键消息，即使需要丢弃部分中间内容

可选：当裁剪掉了大量内容且压缩未触发时，插入一条“轻量占位摘要”（由本地规则生成简短摘要，或复用压缩逻辑但更轻量）。

## 压缩触发与摘要质量

### 自适应参数

- 将 `0.85` 安全系数提取为常量/配置，并允许随 `ctxSize` 或 assistantMode 调整默认值。
- 将 `triggerRatio` 的默认建议与 `ctxSize` 关联（ctx 小则更早压缩，ctx 大则更晚）。

### 更结构化摘要

保持用户可读的 Markdown，但强约束结构，例如输出固定标题与要点列表，以利后续机器合并/展示：

- 核心事实
- 用户偏好
- 人物/设定
- 未解决问题
- 下一步

（当前已有该结构要求，后续可强化为更一致的格式与长度控制。）

## 统计与体验

- 用真实 `usage` 更新生成 token 与 TPS（若 server 给），否则采用“增量 token 估算”。
- UI 可展示：
  - 本次请求 prompt/生成/总 token（真实或估算，必要时标注来源）
  - 估算的“剩余可生成 token”（基于 `maxTokens - completionTokens` 或估算值）

## 兼容性与降级策略

1. **优先**：usage（真实）
2. **其次**：tokenize（准确计量）
3. **兜底**：启发式（增强版）

能力探测必须：

- 不阻塞正常聊天
- 失败后短路，不重复打扰
- 结果缓存到内存（必要时持久化到本地状态）

## 测试计划（实现后补齐）

- 单元测试：
  - `parseCompletionMessage()` / `parseDeltaEvent()` 对 usage 的解析覆盖（存在/缺失/字段变体）
  - `buildContextWindow()` 新截断策略覆盖（含附件/代码块优先）
  - 图片 token 估算（无尺寸/有尺寸/极限尺寸）
- 组件测试：
  - `ParameterPanel` 中联动提示与“一键对齐/预设”的行为
- 端到端（手工）：
  - 真实 llama-server 下观察是否能抓到 usage；抓不到也应完全不影响聊天

## 风险与注意事项

- server 的 usage 字段格式可能不一致（需要容错解析）。
- 流式 SSE 最终 usage 的出现位置/事件类型可能不同（需要“宽松解析，取最新值”）。
- 图片解码可能带来额外开销（应懒加载/仅在估算时做，且失败快速降级）。

---

## 需要用户 review 的点

1. UI 中新增的联动提示/一键动作的文案与位置是否可接受？
2. 截断策略“按价值保留”的权重规则是否符合你的直觉（附件/代码/最近 N 轮优先）？
3. 是否需要在 UI 明确标注 token 数来源（真实 usage vs 估算）？

---

## 与当前实现对齐（2026-05-12）

以下已在产品中落地或部分落地，供对照本 spec：

| 主题 | 行为简述 |
|------|-----------|
| finish_reason 缺失 | 流结束后若 completion≈maxTokens，推断 `length` 并写系统日志 |
| 续写兼容 | 首轮「assistant 尾 + user」失败时，降级为「已生成正文并入末条 user」重试 |
| KV 与 maxTokens | KV 告警条内给出基于估算 prompt 的 maxTokens 建议上限（需用户到配置确认） |
| 代码块高亮 | Markdown 代码块在 `rehype-sanitize` 之外对 hljs HTML 做 script 标签剥离 |
| 会话缓存 | 内存中对话缓存 LRU 式裁剪（保留当前与会话自身） |
