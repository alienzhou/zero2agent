# Grok Build：模型后台任务与客户端交互 PTY 是两套能力

## 基本信息

| 项目 | 值 |
|---|---|
| 仓库 | [xai-org/grok-build](https://github.com/xai-org/grok-build) |
| 实际获取的 HEAD | `f0e3be1100ef5252488e3be8bb0e91cf68d8c305` |
| Commit 日期 | `2026-09-23 16:52:41 +0000`（北京时间 2026-09-24 00:52:41） |
| 分支 | `main`；克隆时与 `origin/main` 一致 |
| 最近可达 Tag | 无；depth=100 范围内 `git describe --tags --abbrev=0` 无可用名称，不代表上游从未发布 |
| 观测时间 | `2026-09-28T15:56:56Z`（北京时间 23:56:56） |
| SOURCE_REV | `036a5d8348cd744767cd0b08518ab17bf608fa7f`，上游内部 monorepo revision，不是公开仓库 HEAD |
| 技术栈 | Rust；tools、agent、shell、shell-terminal、pager 多 crate |
| 验证等级 | **S：源码确认；未端到端运行，测试仅阅读** |

HEAD 日期没有晚于用户指定的 2026-09-28。没有把 SOURCE_REV 当成可公开访问的 GitHub commit，也没有把发布二进制版本与此源码 snapshot 自动等同。

## 调研目标

追查模型可见工具、后台运行、本地 stdin、客户端 PTY、清理与安全边界。
额外核实 Codex/OpenCode 移植来源，避免把相同实现或改名包装计为多个独立设计样本。

## 调研结论

1. 默认 Grok Build 工具集把内部 `run_terminal_cmd` 改名为 **`run_terminal_command`**，`is_background` 改成 **`background`**；配套输出、等待和 kill 工具。只按内部符号抄 schema 会抄错模型契约。
2. 本地模型命令走 TerminalBackend actor，stdin 明确 null、stdout/stderr pipes。后台句柄支持查输出/等待/终止，**不支持模型 write_stdin**。
3. 另有 `x.ai/terminal/pty/*` 客户端扩展，真正分配 PTY、输入字节、resize、load 和 close；它不是默认模型工具，也没有证明能将既有非 PTY 模型任务转换为交互终端。
4. Bash 库默认 auto-background=false，但产品配置解析默认 true，通常约 15 秒转后台；模型/配置超时、前台等待预算、后台 10 小时硬上限是不同层次。
5. 源码明确声明移植 Codex 文件工具与 OpenCode bash 等工具；当前 actor/PTy 扩展需独立检查，不能凭目录名断言整套执行内核来自 Codex，也不能把移植部分作为独立收敛证据。

### 能力表

| 能力 | 源码存在/注册/默认与条件 | 实测 |
|---|---|---|
| 模型运行命令 | 默认 GrokBuild preset 注册，实际名 run_terminal_command | 未运行 |
| 模型显式后台 | background=true，BashParams enabled_background 默认 true；部分工具集会禁用 | 未运行 |
| 前台自动转后台 | 产品 fallback=true；库独立复用默认=false；配置/remote settings 可覆盖 | 未运行 |
| 模型查输出/等待/kill | 默认配套工具集有；返回 task 句柄，不是输入会话 | 未运行 |
| 模型向已有命令续写 stdin | 模型 schema、TerminalBackend trait 均无对应入口；本地 stdin=null | 未运行 |
| 模型选择 tty=true | BashToolInput 无此参数 | 未运行 |
| 客户端创建交互 PTY | ACP 扩展有 create/input/resize/load/close 链 | 未运行 |
| 人接管已有模型命令 | 未发现转换链；独立创建 PTY 不能当成接管证据 | 未运行 |
| pipe EOF | 本地启动即关闭 stdin；无续写后半关闭工具 | 未运行 |
| PTY EOF/控制字符 | 字节通道存在；无独立半关闭 RPC 证据 | 未运行 |
| owner 隔离 | teardown 按 owner 过滤；按 task_id 的模型读/kill 不可直接宣称严格 owner 授权 | 未运行 |
| Windows/headless | 有平台分支与 headless 产品；未验证发布物/终端等价性 | 未运行 |

## 详细分析

### 1. 仓库身份、SOURCE_REV 与移植链

[README#L31-L35](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/README.md#L31-L35)说明它周期性从 monorepo 同步，根 [SOURCE_REV](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/SOURCE_REV)记录源 revision。
公开 permalink 必须锚定本轮 HEAD；SOURCE_REV 只作来源标识，没有可核实公开上游 diff 时不声称它对应某个发布日期。

[根 THIRD-PARTY-NOTICES#L16658-L16700](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/THIRD-PARTY-NOTICES#L16658-L16700)与 [tools crate notices#L1-L42](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/THIRD_PARTY_NOTICES.md#L1-L42)一致声明：

- `implementations/codex/` 的 apply_patch、grep_files、list_dir、read_file 来自 OpenAI Codex handler，经过 Tool trait/runtime 适配。
- `implementations/opencode/` 的 bash、edit、glob、grep、read、skill、todowrite、write 来自 sst/opencode。
- notice 没给这两份移植的确切上游 commit；不能补造导入时刻或伪造跨仓库 diff。

[OpenCode bash 包装](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/opencode/bash/mod.rs#L1-L50)明确委派共享 TerminalBackend。
[codex_toolset](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-agent/src/config.rs#L339-L356)也使用 Grok 自己的 bash_tool_config，并非 Codex 的 exec_command/write_stdin 会话对。
因此“Grok 有 codex preset”不能推出“继承 Codex 交互 stdin”。
比较时应把移植的 OpenCode 契约算同源一组，把 Grok actor 的具体生命周期改动作为适配层观察；不能以产品数量替代独立实现数量。

### 2. 模型看到的名字、schema 与默认工具集

[配置改名](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-agent/src/config.rs#L118-L140)在 ToolConfig 完成，而不是更改内部 Tool id。

| 内部实现/字段 | 默认 GrokBuild 模型契约 |
|---|---|
| run_terminal_cmd | run_terminal_command |
| is_background | background |
| get_task_output | get_command_or_subagent_output |
| wait_tasks | wait_commands_or_subagents |
| kill_task | kill_command_or_subagent |

[默认工具集合](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-agent/src/config.rs#L243-L280)将 bash、kill、output、wait 加入同一配置。
`AgentDefinition::default_grok_build` 使用此集合；[builder 参数合并](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-agent/src/builder.rs#L939-L963)按内部 fully-qualified id 注入产品 BashParams。
工具 allow/disallow、read-only explore、任务工具隐藏等会进一步裁剪，不能声称所有内建角色都能启动后台进程。
例如 [explore_toolset](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-agent/src/config.rs#L357-L370)刻意不注册 bash 与后台 helper。

[BashToolInput](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L207-L257)包含 command、description、timeout、is_background。
command 和一句话 description 必填，timeout 以毫秒表示；background 默认 false。
没有 tty、stdin、session_id、chars 或 eof 字段；后台返回的是 task_id。
description 中还会通过 TemplateRenderer 按当前工具名渲染提示，避免内部名泄漏为不可调用的指令。

### 3. 默认超时必须从库追到产品

[BashParams](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L125-L183)默认 enabled_background=true、auto_background_on_timeout=false。
[产品配置解析](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/tools/config.rs#L7-L80)则按 local config > remote fallback > true 决定 auto-background，并显式将前台 timeout ceiling 提高至 36,000 秒。
这解释为什么只阅读 Default 会得出与产品相反的结论。

本地 actor 的关键限额见 [terminal.rs#L36-L77](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L36-L77)：

- foreground block budget 默认 15 秒，可由配置/env 调整；这是转后台预算，不是必然 kill timeout。
- 普通前台默认 command timeout 为 120 秒；schema 的静态 300,000 ms ceiling 文案不等于产品注入后的所有运行策略。
- 显式后台 timeout 省略或为 0 在工具层解析为 unbounded，但本地后端仍有 BACKGROUND_MAX_RUNTIME=10 小时。
- auto-background 时重设后台 runtime 上限；不要把“工具层 Duration::MAX”写成永久运行保证。

### 4. 从 handler 到本地进程

```text
默认 AgentDefinition → ToolConfig 改名/参数合并 → 工具 registry/bridge
  → BashTool::run(command, description, timeout, background)
  → 读取 Terminal/SessionEnv/SessionFolder/OwnerSessionId
  → TerminalRunRequest → backend.run 或 backend.run_background
  → LocalTerminalBackend channel → LocalTerminalActor
  → spawn_command → static/persistent/fallback shell
  → stdin=null，stdout/stderr=pipes，进程组 + kill_on_drop
  → actor 读输出/落盘/通知 → foreground result 或 background task_id
```

[handler 读取资源](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L1675-L1732)不依赖 shell 全局 cwd，而从调用 context 解析。
[后台请求](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L1820-L1848)携带 owner、description、输出文件、通知 handle；[前台请求](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L1900-L1944)另带 auto-background 与 wait budget。

[后端选择](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/session/acp_session_impl/spawn.rs#L755-L812)不是统一走本机：

- 有 parent backend 的子 agent 复用父 backend。
- 客户端声明 terminal capability 且有 gateway 时选 AcpClient。
- cursor harness 选择本地 persistent shell；其他本地路径使用 non-persistent/login snapshot。

此报告关于 stdin=null 的结论明确限定本地后端；ACP 客户端实际 spawn 由客户端决定，不能只靠服务端 trait 证明其终端细节。
[static spawn](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L734-L781)、[persistent spawn](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L850-L901)均关闭 stdin。
[fallback spawn](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L3266-L3330)的 Unix/Windows 分支同样使用 null_stdio。
persistent 在这里是采集/重放 cwd、env、aliases 等状态，不是保留一个开放 stdin 的交互 shell。

### 5. 后台输出、并发与生命周期

[TerminalBackend trait](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/types.rs#L334-L435)暴露 run、run_background、get_task、wait、kill、list 和 owner teardown，没有 write stdin。
因此缺少续写不仅是 schema 隐藏，也体现在这条抽象边界。
本地 actor 独占可变进程表，调用端通过有界 channel（32 条）和 oneshot 接收结果；多进程可以同时运行，但状态修改串行。
channel 容量 32 **不是最多 32 个任务**；本轮未定位活进程总数硬上限。

[actor select](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L935-L979)优先 cancel/命令，然后 deadline、退出事件与 tick，空进程表避免无意义轮询。
stdout/stderr 读取 buffer 为 8192 bytes，通知周期默认 100 ms。
[Bash streaming](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/grok_build/bash/mod.rs#L63-L118)限制单帧 progress 16 KiB，并补发最后一次周期通知之后 drain 得到的尾部。
模型返回截断、UI 进度和磁盘日志是不同输出面；不能用 UI 流式显示推出模型持续接收每个 chunk。

文件输出 guard 默认 5 GiB，超限 kill；退出后 retained file cap 64 MiB，完成项 TTL=300 秒，并最多保留 100 条 metadata tombstone。
这些限制分别控制磁盘、退出后保留和元数据，不可误当单次模型输出上限。
日志文件可能包含命令回显与秘密输出；“留完整日志供后续查询”同时扩展了敏感数据落盘面。

[Lifecycle](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/local/lifecycle.rs#L1-L92)区分 Running、Exiting、Finished、Swept，并携带 collected/reaped 证明。
进程退出但管道未排空仍是 Exiting；管道读完但未 wait 也不能宣称 settled。
post-exit drain 上限 2 秒、reap grace 5 秒；源码用 detached drain 回报 actor，避免一个继承 fd 的后代挡住其他 deadline。

### 6. 取消、所有权与清理

[cancel 主链](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/session/acp_session_impl/cancel.rs#L470-L496)通常杀前台；是否杀后台另由 kill_background_tasks 控制。
send-now 表示用户继续而不是停止，会先尝试将本会话前台命令转后台，给模型补充诚实的 still-running 回执。
[send-now 分支](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/session/acp_session_impl/cancel.rs#L991-L1042)若后台转换返回空则退回 kill，不能假定所有 backend 都支持保留。
子 agent teardown 按 owner 清理，避免误杀共享 backend 上的父/兄弟任务；普通父会话的全量清理范围更大。

安全上需保留一个重要限制：[TaskOutput 按 ID 查询](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/grok_build/task_output/mod.rs#L192-L250)直接调用 get_task/wait；[KillTask](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/implementations/grok_build/kill_task/mod.rs#L185-L219)直接调用 kill_task_with_source。
它们读取 OwnerSessionId 不代表终端 task_id 分支执行了 ownership compare；不能把 owner-scoped teardown 夸大为所有操作的访问控制。
这是一项边界待复核，不在未做跨会话实测时宣称已确认安全漏洞。

超时 kill 采用 SIGTERM→1 秒 grace→SIGKILL，Windows 使用相应 process group/job 封装，不能将 kill_task 翻译成“向 stdin 写 Ctrl-C”。
[actor shutdown_all](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L1994-L2005)整组终止并处理状态 dump task；channel 关闭或 cancel token 触发它。
真实进程异常退出、远端断连和任务归属转移仍需平台测试。

### 7. 客户端交互 PTY：有输入，但不是模型工具

[PTY 扩展路由](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/extensions/terminal.rs#L290-L361)提供 create、load、resize；input notification 先解 base64 再 write_pty_input。
入口在 ACP 扩展，默认模型 ToolConfig 没有对应工具。
[create_pty](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L239-L313)调用 portable_pty.openpty，启动独立 shell，并取得 master reader/writer。
它不是将 TerminalBackend 的现有 pipe 子进程 attach 到 PTY；不能拿它证明“人接管模型正在运行的命令”。

[输入队列与写线程](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L376-L390)逐条 write_all+flush，容量 256 条消息；每条消息大小上限在此处未见，不能把条数界限写成字节预算。
[write_pty_input](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L594-L607)clone sender 后释放 session 锁再 await，输入与输出循环可并发。
控制字符都走原始字节；空字节数组没有半关闭语义，Ctrl-D/Ctrl-C 的效果取决于终端模式。

输出按 16 ms 批量通知，256 KiB ring 用于 load 恢复，含 outputOffset；这是客户端流，不自动加入模型对话。
[flush_output](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L566-L591)将字节 base64 编码、按 target_client_id 路由。
target_client_id 是输出目的地，不足以证明输入已经按 owner 授权。
[PTY_REGISTRY](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L221-L237)实际上是进程级 static map，使用 UUID key；require_pty 只查 key。
本轮未核实外层 ACP 认证/隔离是否限制了可访问范围，也未见该 map 的硬容量/TTL 淘汰。

[close/reap](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L636-L686)移除 master 与 sender、发送 hangup、限时等待再 kill/reap。
源码特意说明只 drop master 不够：reader/writer 持有 dup，必须处理全部持有者和 shell 生命周期。
[agent 退出](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell/src/agent/app.rs#L300-L309)调用 close_all。
PTY 输入函数本身不证明密码脱敏；终端 echo、ring、客户端录制、ACP 日志均需另外审计。

### 8. headless、Windows 与测试边界

headless 不需要分配 PTY 才能执行本地模型命令；stdin=null 的语义在这里有助于避免命令等待用户输入。
交互 PTY 则要求客户端调用专用 RPC；本轮没有验证 TUI 内具体快捷键、完整 UI 工作流或 headless 接管操作。
Windows PTY shell 选择 Git Bash/pwsh/PowerShell/cmd，Unix 默认 SHELL 或 bash；busy 判定的 tcgetpgrp 在 Windows 没有等价查询。
README 提醒 Windows 源码构建 best-effort、该 tree 尚未测试，不能因为有 cfg 分支就标“跨平台实测通过”。

阅读了以下测试设计/断言，**未运行测试**：

- [terminal.rs#L4368-L4465](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-tools/src/computer/local/terminal.rs#L4368-L4465)：超时状态、超时前输出保留、后代继承 pipe 不阻塞。
- `due_deadline_beats_unrelated_drain_work`：针对一个任务 drain 阻碍另一个等待 deadline 的回归场景。
- `kill_foreground_by_owner_only_kills_matching_session` / `kill_by_owner_ignores_unowned_tasks`：验证 scoped teardown，不等于验证所有 ID 查询授权。
- [PTY close 测试](https://github.com/xai-org/grok-build/blob/f0e3be1100ef5252488e3be8bb0e91cf68d8c305/crates/codegen/xai-grok-shell-terminal/src/pty_session.rs#L957-L995)：启动不同进程组的后台 grandchild，close 后断言其退出。
- `scope_teardown_kills_a_background_grandchild` / `dropping_an_unregistered_shell_reaps_it`：补充 teardown 与创建中途失败场景。

未验证：真实模型默认选择、远端配置返回值、发布物版本对应、ACP 端到端权限、跨 owner ID 猜测、秘密输入日志、原始模式 EOF、PTY 巨量输入、Windows Job/ConPTY 清理、宿主 SIGKILL、磁盘写失败与强压下通知完整性。

## 与旧调研及 S004 的关系

S003 terminal 目录没有 Grok Build 独立报告；这是新增样本，没有虚构“旧 Grok 默认行为”。
旧 OpenCode/Codex 报告只能辅助识别移植来源，不能在没有上游导入 SHA 的情况下计算 Grok 与它们的源码变更。

对 S004 的建议：

1. 将 background task API 与 interactive session API 分开说明，查输出句柄不意味着 stdin 可写。
2. 不必先做 PTY 就能支持长任务：pipe + closed stdin + output/wait/kill 已构成完整后台 MVP。
3. 若增加人类接管，必须明确是新建独立终端还是接入模型现有会话；Grok 这里证明前者，未证明后者。
4. 前台时间预算、命令 kill deadline、后台硬上限分开命名；模型等待结束不能被误报为命令失败。
5. 采用 owner-scoped cleanup 时，顺手补齐 get/write/kill 的 owner 校验；清理隔离与读取权限不是一回事。
6. 先规定文件输出保留、总量和秘密策略，再引入“完整日志永远可读”的体验承诺。
7. 将 Running/Exited/OutputDrained/Reaped 分开，可直接形成 S004 状态机与回归测试；没必要照搬全部产品工具别名。

## 关键源码引用与复现

所有代码链接固定到公开 HEAD；SOURCE_REV 作为独立元数据保留。只取源码，不执行仓库安装/构建：

```sh
git clone --depth 100 https://github.com/xai-org/grok-build.git <research-dir>
git -C <research-dir> fetch --depth 1 origin f0e3be1100ef5252488e3be8bb0e91cf68d8c305
git -C <research-dir> show f0e3be1100ef5252488e3be8bb0e91cf68d8c305:SOURCE_REV
git -C <research-dir> show f0e3be1100ef5252488e3be8bb0e91cf68d8c305:crates/codegen/xai-grok-agent/src/config.rs
git -C <research-dir> show f0e3be1100ef5252488e3be8bb0e91cf68d8c305:crates/codegen/xai-grok-tools/src/computer/local/terminal.rs
```

## 参考资料

- [本轮方法与证据分级](README.md)
- [Codex 本轮报告](codex.md)
- [OpenCode 历史报告](../terminal/opencode.md)
- 根及 crate notices 是来源声明（S）；没有用同源工具数量形成“多数产品一致”的结论。
