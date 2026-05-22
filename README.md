# iLlama

iLlama 是一个面向 Windows/macOS 的轻量 llama.cpp 可视化启动器。V3.0.0 起，iLlama 回到 launcher-first 定位：负责扫描本地 GGUF、配置并启动 `llama-server`、展示运行状态和日志，然后把 OpenAI-compatible 连接信息交给 Chatbox、Cherry Studio、Open WebUI、AnythingLLM 或其他聊天客户端。

## 当前状态

iLlama v3.0.0：Tauri v2 + React + TypeScript + Rust，专注本地 GGUF 模型启动、监控和外部客户端连接。

核心能力：

- macOS 原生工具风格的三栏 UI 壳，支持窗口关闭（X 按钮）时自动隐藏至后台（Dock 栏中）运行，以及点击 Dock 图标重新显示并聚焦主窗口
- 用户指定模型目录后，仅扫描该目录下的 GGUF 模型
- GGUF header/metadata 轻量读取
- `llama-server` 可执行文件自动发现与手动选择
- 启动参数 schema、校验、预设和命令预览
- 参数模式：最大能力 / 自定义
- 最大能力模式会按模型 metadata 自动设置 `ctxSize`，并给内置测试聊天设置安全 `maxTokens`
- 自定义模式提供上下文长度与输出最大长度滑杆
- `llama-server` 子进程启动/停止 + 指数退避健康检查
- 自动端口避让
- Prometheus runtime 指标读取：CPU、内存、Token/s、KV cache
- `mmproj` projector 参数：同目录候选识别、手动选择、`--mmproj` / `--no-mmproj-offload`
- OpenAI-compatible 连接面板：Base URL、API Key、Model、Chat Completions URL
- Chatbox、Cherry Studio、Open WebUI、AnythingLLM、自定义客户端 profile
- 一键复制连接信息或 JSON 配置
- 连接检测：检查 `/health` 与 `/v1/models`
- 临时测试聊天：仅用于 smoke test，不保存历史
- V2 历史导出入口：仅用于迁移旧历史，不再写入新的聊天历史
- 日志抽屉：按流过滤、全文搜索、一键清空
- 健全的进程生命周期管理，在应用完全退出（Cmd+Q 或从 Dock 菜单退出）时，可靠地自动清理所有后台的 `llama-server` 进程，防止孤儿进程泄漏
- macOS `.app` 和 `.dmg` 打包路径

## V3 产品边界

iLlama 不再试图成为完整聊天应用。完整对话历史、分支、写作模式、RAG、知识库、云同步、插件和复杂工作区由外部客户端承担。iLlama 的职责是把本地模型稳定跑起来，并把连接信息清楚交出去。

保留的内置测试聊天只用于确认：

1. 当前模型已启动；
2. `/v1/chat/completions` 能正常返回；
3. 图片或文本附件请求格式基本可用。

测试聊天不会保存多会话历史，也不提供写作动作、上下文压缩、分支、归档或导出。

## 外部客户端连接

启动模型后，在「连接」页复制：

```text
Base URL: http://127.0.0.1:8080/v1
API Key: llama
Model: <当前模型文件名>
```

大多数 OpenAI-compatible 客户端的 API Key 可以填任意非空值；iLlama 默认给出 `llama`。如果客户端要求模型名，可先使用连接页显示的模型文件名；部分 `llama-server` 构建也接受 `local`。

## 用户向说明

- **ctxSize**：与 `llama-server` 的上下文槽位一致；过大占用更多内存与 KV。
- **最大能力**：按模型 metadata 拉满上下文，并把内置「测试」聊天的输出最大长度设到安全上限；这代表最大上下文能力，不保证最快。
- **自定义**：用滑杆调节上下文长度与输出最大长度。修改 `ctxSize` 后需要重启模型才会影响 `llama-server`。
- **maxTokens**：单轮内置测试请求的输出上限；外部客户端通常也有自己的输出上限，iLlama 不会强行改写 Chatbox、Cherry Studio、Open WebUI 等客户端发送的 `max_tokens`。
- **Prometheus 指标名子串**：若你的 `llama-server` 构建改过 metric 命名，可在「运行」→「Prometheus 指标名子串」里填逗号分隔的关键片段。
- **V2 聊天历史**：V3 主界面不再展示完整聊天工作区，也不再写入新的持久聊天历史。旧历史文件不会被主动删除；需要迁移时，在「连接」页使用「导出 V2 历史」生成 legacy JSON bundle。
- **顶部系统状态栏**：指屏幕顶部包含 Wifi、电池等指标的 macOS 系统状态栏。可在「连接」页面选择「在顶部系统状态栏显示图标」。未启用状态栏图标时，关闭应用窗口依然会保持在 Dock 栏和后台继续运行，不会退出。若要彻底退出应用，请通过 Cmd+Q 快捷键或在底部 Dock 栏图标上右键选择“退出”。
- **外部客户端兼容性**：发布前验证矩阵见 `docs/client-compatibility.md`。


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

iLlama 采用外部 `llama-server` 策略：用户需要先安装 `llama-server`，或在应用中手动选择已有可执行文件。当前不会把 Homebrew 的 `llama-server` 直接打进包，因为它依赖 `/opt/homebrew` 下的动态库，不适合作为可迁移 sidecar 发布。

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
- 不做完整聊天应用
- 不做 RAG/向量库/插件系统
- 不做云同步或账户系统
- 优先保证：选择目录、发现 GGUF、配置参数、启动模型、复制连接信息、查看日志、测试请求、停止释放资源

## 许可证

MIT License
