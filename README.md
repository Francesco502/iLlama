# iLlama

iLlama 是一个面向 Windows/macOS 的轻量 llama.cpp 可视化启动器。用户指定模型目录后，应用只扫描该目录下的 GGUF 模型，配置常用 `llama-server` 参数，启动/停止本地模型，并在内置界面查看状态、日志和对话。

## 当前状态

iLlama 已演进到 v2.1.2：Tauri v2 + React + TypeScript + Rust，专注本地 GGUF + 完整对话工作区。

核心能力：

- macOS 原生工具风格的三栏 UI 壳
- 通过原生目录选择接入用户指定的本地模型目录
- 本地 GGUF 模型目录扫描，含 GGUF header/metadata 轻量读取
- 启动参数 schema、校验与命令预览（含一键复制）
- 设置 JSON 持久化与 v1→v2 chat 历史迁移
- `llama-server` 子进程启动/停止 + 指数退避健康检查（最长 120 s，可取消）
- 本地多对话工作区：分支、重命名、置顶、归档、删除前导出
- 助手模式（通用/小说/分析/编码/翻译）+ 对话级 system prompt 编辑入口
- 流式 OpenAI 兼容 chat completion + 真实 `usage` token 统计 +
  无 `usage` 时的本地估算回退
- 自适应上下文压缩：触发比例随上下文与助手模式自动调整
- 价值导向的上下文裁剪：附件 / 代码块 / 最近轮次优先保留
- 采样面板：maxTokens 主控 + 长回复/长记忆预设 + 高级参数（temperature/top-p/top-k/min-p/repeat-penalty/seed/stop）
- 上下文长度对齐提示与"一键对齐"按钮
- 流式写盘节流（~250 ms）、按对话 id 缓存草稿、`?` 快捷键浮层
- 图片多模态输入：前端附件预览、OpenAI `image_url` content parts、点击放大
- `mmproj` projector 参数：同目录候选识别、手动选择、`--mmproj` / `--no-mmproj-offload`
- 日志抽屉：按流过滤 + 全文搜索 + 一键清空
- macOS `.app` 和 `.dmg` 打包路径

## 用户向说明

- **ctxSize**：与 `llama-server` 的上下文槽位一致；过小会迫使历史被裁掉，过大占用更多内存与 KV。
- **maxTokens**：单轮助手输出的上限；与「是否截断」强相关，不是上下文总长。
- **finish_reason**：`length` / `max_tokens` 表示因输出上限停止，可在同一条消息上点「继续输出」。若流式最后一包未带 reason，应用会在 completion≈maxTokens 时**推断**为 `length` 并写一条系统日志。
- **继续输出**：优先发送「历史 + 末尾助手 + 续写 user」；若首轮请求失败，或首轮成功但未产生新内容 / completion 未增长，会自动降级为「把已生成助手正文并入末条 user」再试（兼容部分不允许末条为 assistant 的构建）。
- **KV 条（Prometheus）**：接近 100% 时生成可能变慢；可压缩对话、提高 ctxSize，或参考 KV 条内**建议的 maxTokens 上限**（粗略估算）。工作区在 KV 告警时可一键「采用建议 maxTokens」，仍可在「配置」中再改。
- **Prometheus 指标名子串**：默认匹配常见 `llama-server` 指标名；若你的构建改过 metric 命名，可在「配置」→「Prometheus 指标名子串」里填逗号分隔的关键片段。例如 KV 指标可填 `kv,used,cells`，Prompt 指标可填 `prompt,tokens,total`，生成 TPS 可把「任含」设为 `tokens,second`、「必含」设为 `generation`。
- **少见 finish_reason**：`tool_calls` / `content_filter` 等会在消息下方给出简短说明；可设置构建环境变量 `VITE_FINISH_REASON_DOC_URL` 为指向你团队文档的 HTTPS 链接，以显示「说明文档」外链。

### 少见 finish_reason（tool_calls / content_filter）

- `tool_calls` / `function_call`：模型按工具协议结束本轮；若界面未展示工具往返，需检查 `llama-server` 与客户端是否对齐工具 schema。
- `content_filter`：可能触发了安全策略拦截；可改写提示或调整服务端过滤配置。

完整设计方案见：

- `docs/superpowers/plans/2026-05-09-v2.1-local-ai-assistant.md`
- `docs/superpowers/specs/2026-05-11-context-and-output-length-optimization-design.md`
- `docs/superpowers/plans/2026-05-06-v1-illama.md`

## 技术栈

- 桌面框架：Tauri v2
- 前端：React + TypeScript + Vite
- UI 风格：macOS 原生工具型 split-view，系统字体，浅色主题，紧凑控件
- 后端：Rust
- 推理运行时：外部 `llama-server`
- 测试：Vitest + Cargo tests

## 开发环境

需要：

- Node.js 20+
- npm
- Rust stable
- macOS 开发打包需要 Xcode Command Line Tools
- 一个可执行的 `llama-server`

如果当前 shell 找不到 Rust：

```bash
source "$HOME/.cargo/env"
```

## 常用命令

安装依赖：

```bash
npm install
```

前端开发预览：

```bash
npm run dev
```

前端测试：

```bash
npm test
```

前端生产构建：

```bash
npm run build
```

Rust 测试：

```bash
cd src-tauri
cargo test
```

Tauri 开发运行：

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run tauri:dev
```

Tauri 打包：

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run tauri:build
```

## `llama-server`

首个公开版采用外部 `llama-server` 策略：用户需要先安装 `llama-server`，或在应用中手动选择已有可执行文件。当前不会把 Homebrew 的 `llama-server` 直接打进包，因为它依赖 `/opt/homebrew` 下的动态库，不适合作为可迁移 sidecar 发布。

开发阶段如果要准备实验性 sidecar，可以用脚本复制并加上 Tauri 要求的 target triple 后缀：

```bash
npm run prepare:sidecar -- /path/to/llama-server aarch64-apple-darwin
```

输出目录：

```text
src-tauri/binaries/
```

当前 sidecar 与 macOS 分发策略记录在 `docs/release-strategy.md`。

## 范围与非目标

- 不做全盘扫描
- 不内置模型下载
- 不做多模型同时运行
- 不做 RAG/向量库/插件系统
- 多模态保持克制：支持图片输入和文本/思考文本输出显示，音频先不默认开放
- 优先保证：选择目录、发现 GGUF、配置参数、启动模型、查看日志、聊天、停止释放资源

## 许可证

MIT License
