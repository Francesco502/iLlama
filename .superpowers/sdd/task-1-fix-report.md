# Task 1 foundation fix report

## 结果

审查报告中的 7 项 Important 已全部修复，范围仅限 runtime/settings/server foundation；未开始 GGUF/UI 大重构或发布工作。

## 改动

1. **能力过滤后的命令预览**
   - Tauri 模式下预览异步调用后端 `build_command_spec_command`，直接使用返回的 `executable`、`args` 和 `warnings`。
   - 配置变化会重新探测；旧异步结果会被忽略。探测中或失败时不再退回可能与实际启动不一致的前端完整参数表。
   - 浏览器演示模式仍保留纯前端预览。

2. **`autoPort` 全链路**
   - 增加 App state、bootstrap 恢复、settings snapshot 保存。
   - 仅在 `autoPort=true` 时调用 `findAvailablePort`；关闭时使用用户指定端口，让后端按端口占用语义明确失败。
   - 覆盖 v2 `autoPort:false` 迁移、bootstrap、保存及启动端口策略。

3. **轮询 generation 隔离**
   - start/stop/unmount 都递增 generation。
   - `startLlama`、`stopLlama` 和在途 `runtimeSnapshot` await 后均校验 generation；旧会话不能覆盖新进程或继续排 timer。

4. **托盘单一串行更新入口**
   - 通用 settings patch 在后端剥离 `ui.showInMenuBar`；该字段只允许 `set_tray_enabled_command` 修改。
   - `SettingsStore` 在同一互斥临界区内协调托盘 effect 与持久化；effect 失败不落盘，保存失败会恢复旧托盘状态。
   - 前端 debounce patch 不再发送托盘字段，toggle 等待后端返回实际状态；失败后重新读取实际托盘状态。
   - 覆盖交错 mutation 被串行化、create failure 不污染设置、通用 patch 不能抢写托盘字段。

5. **probe 进程树与有界读取**
   - Unix probe 通过 `setsid` 建立独立 session，超时/`try_wait` 异常时向整个 process group 发送 `SIGKILL`。
   - Windows cfg 使用 `CREATE_NEW_PROCESS_GROUP`，清理时调用 `taskkill /T /F`，随后仍对直接 child 做 kill/wait 兜底。
   - stdout/stderr 单流限制 1 MiB，reader 最多等待 200 ms，不再无界 `join`。
   - 回归 fixture 让后台子进程持有 pipe，验证总耗时有界且记录的所有 PID 已退出。

6. **UI 设置受控并持久化**
   - `AppLayout` 的日志开关和高度由 `uiSettings` 控制，toggle、拖拽、键盘 resize、Escape 都回写 App state。
   - `SamplingPanel.advancedOpen` 改为受控 prop 并回写 App state。
   - 后端日志高度规范化上限与 UI 的 480 px 一致，覆盖 480 px 重启 round-trip。

7. **Windows 安全替换与恢复**
   - 每次保存使用 PID + 时间 nonce + 原子 counter 的唯一 `create_new` 临时文件，失败时清理自己的临时文件，不触碰其他实例的固定 `.tmp`。
   - Windows 已存在设置文件时使用 `ReplaceFileW(REPLACEFILE_WRITE_THROUGH)` 原子替换，消除旧的“先移走正式文件”窗口。
   - 启动时仍识别并恢复旧版本崩溃遗留的 `settings.json.bak`，并返回 `settings_backup_restored` warning。

此外，既有 `llama_process_tests` 的进程退出等待改为 5 秒 deadline，测试互斥锁在单例失败后不再级联中毒；该 test binary 连续运行 3 次均 5/5 通过。

## TDD 与验证

各行为均先加入回归测试并观察预期红测，再做最小实现转绿。最终新鲜完整验证：

- `npm test` — 22 files，98/98 tests passed
- `npm run lint` — passed
- `npm run build` — passed
- `cargo test` — passed（含 4 项 probe、16 项 settings、5 项 llama process 集成测试）
- `cargo fmt --all -- --check` — passed
- `cargo clippy --all-targets --all-features -- -D warnings` — passed
- `git diff --check` — passed

## Commit

- `566fbaf` — `fix: harden runtime and settings foundation`

## 剩余风险

- 当前验证主机是 macOS；Windows 的 `ReplaceFileW` 和 `CREATE_NEW_PROCESS_GROUP`/`taskkill` 路径已用明确 cfg 隔离并采用官方 OS API/系统工具，但未在本轮 Windows runner 上实际执行。跨平台回归测试覆盖了 `.bak` 恢复和唯一临时文件契约。
- probe 的有界 reader 在极端情况下会丢弃超过 1 MiB 或在 200 ms 内未排空的探测输出；这是为保证 probe 上界而做的有意限制，正常 `--version`/`--help` 输出远低于该值。
