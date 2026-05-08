# iLlama

iLlama 是一个面向 Windows/macOS 的轻量 llama.cpp 可视化启动器。v1 目标是克制但完整：用户指定模型目录，只扫描目录下的 GGUF 模型，配置常用 `llama-server` 参数，启动/停止本地模型，并在内置界面查看状态、日志和对话。

当前 GitHub 仓库：发布前请确认远端仓库名称与 `iLlama` 保持一致。

本机验证模型目录：

- `/Users/francesco/Documents/Code/models`

## 当前状态

iLlama v1.0.0 已初始化为 Tauri v2 + React + TypeScript + Rust：

- macOS 原生工具风格的三栏 UI 壳
- 通过原生目录选择接入用户指定的本地模型目录
- 本地 GGUF 模型目录扫描后端
- GGUF header/metadata 轻量读取
- 启动参数 schema、校验与命令参数构造
- 设置 JSON 持久化
- `llama-server` 子进程启动/停止基础命令
- 本地端口健康检查
- OpenAI-compatible 流式聊天 API 工具
- 图片多模态输入：前端附件预览、OpenAI `image_url` content parts 请求体
- `mmproj` projector 参数：同目录候选识别、手动选择、`--mmproj` / `--no-mmproj-offload`
- macOS `.app` 和 `.dmg` 打包路径

完整实施方案见：

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

正式发布前请先阅读 `docs/release-strategy.md`，确认 sidecar 策略没有变化。

## v1 重点

- 不做全盘扫描
- 不内置模型下载
- 不做多模型同时运行
- 不做 RAG/向量库/插件系统
- 多模态保持克制：支持图片输入和文本/思考文本输出显示，音频先不默认开放
- 优先保证：选择目录、发现 GGUF、配置参数、启动模型、查看日志、聊天、停止释放资源

## 本机验证目录

当前用于本机 smoke test 的模型目录为：

```text
/Users/francesco/Documents/Code/models/
```

## 许可证

MIT License
