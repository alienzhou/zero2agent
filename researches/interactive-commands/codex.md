# Codex：默认可续接执行，但交互输入必须显式申请 PTY

## 基本信息

| 项目 | 值 |
|---|---|
| 仓库 | [openai/codex](https://github.com/openai/codex) |
| 本轮 HEAD | `69f7140559180269e2eb8f5be6e0c20eb37b0c85` |
| Commit 日期 | `2026-09-28 14:46:32 +0000`（北京时间 22:46:32） |
| 分支 | `main`，克隆时与 `origin/main` 一致 |
| 最近可达 Tag | 无；`git describe --tags --abbrev=0` 在 depth=100 获取范围内失败，不推断整个项目没有 tag |
| 观测时间 | `2026-09-28T15:53:35Z`（北京时间 23:53:35） |
| 旧 snapshot | `ce803c45aed425b08b94d8e3c5fb7db0d2193568`，另行按 SHA fetch 核对 |
| 证据等级 | **S：源码确认；未端到端运行，测试仅阅读** |

日期核验：本轮 HEAD 没有晚于用户指定的 2026-09-28。观测比用户消息时间晚约一分钟，是实际取证时间，不回写成消息时间。

## 调研目标

为 E02-S004 区分「长命令返回句柄」「模型续写 stdin」「人类接管」三种能力，追踪默认配置到进程销毁的完整链。
重点复核旧报告的默认关闭推断、pipe stdin、Ctrl-C、会话池淘汰及跨 turn 行为。

## 调研结论

1. 当前默认注册 `exec_command` 与 `write_stdin`；`unified_exec` 和 `unified_exec_tty` 都默认开启。模型元数据里的 `shell_command` **不能推出交互工具默认关闭**。
2. `tty` 参数默认 `false`。plain pipes 只表示输出用管道，**不表示输入管道开放**：实际 spawn 传 `stdin_open: tty`；非 PTY 只接受空轮询或精确单字节 `\x03`，其他输入返回 `StdinClosed`。
3. PTY 允许模型发送普通文本及控制字符，但没有模型侧 `close_stdin`、resize、通用 signal 工具；Ctrl-D 是终端字节，不是通用关闭句柄。
4. 同一终端的读写串行、不同终端可并行；pending 输出消费与完整终结 transcript 分离。turn 完成和用户中断 turn 都不等于杀掉可续接进程。
5. 保留的启动权限不能靠当前 turn 自动收回；新增 stdin 审批链审查 retained authority。输入也会进入 `TerminalInteraction` 事件，不能承诺密码不进入记录。

### 能力表

| 能力 | 源码/注册/配置与默认 | 实测 |
|---|---|---|
| 模型启动长命令并取得 session_id | 有；默认注册，需有效 execution environment 与 ShellTool | 未运行 |
| 非 PTY 获取增量输出 | 有；`tty=false` 默认路径 | 未运行 |
| 非 PTY 写普通 stdin | 明确拒绝；底层 pipe 可写能力未向此路径开放 | 未运行 |
| PTY 写普通 stdin | 有；模型显式 `tty=true`，TTY feature 默认允许 | 未运行 |
| 空输入轮询 | 有；不是 EOF，不写入字节 | 未运行 |
| Ctrl-C | PTY 写字节；非 PTY 特判为 interrupt | 未运行 |
| 显式 stdin close / EOF API | 底层有 close；模型 schema 没有 close 参数 | 未运行 |
| 用户中断当前 turn | 保留交互式进程；one-shot 路径另有取消终止语义 | 未运行 |
| 人接管终端键盘 | 本轮未核实完整客户端接管链；后台列表/清理不等于接管 | 未运行 |
| 宿主正常 shutdown | terminate_all_processes，随后进程与 I/O 清理 | 未运行 |

## 详细分析

### 1. 模型工具和默认配置

工具定义在 [shell_spec.rs#L24-L163](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/tools/handlers/shell_spec.rs#L24-L163)。
`exec_command` 以 `cmd` 为必填，包含 `workdir`、`tty`、`yield_time_ms`、`max_output_tokens`，按环境和策略附加 shell、login、environment_id 和审批参数。
`write_stdin` 以 `session_id` 为必填，`chars` 默认空，另有等待时间及输出预算。
描述仍写“Runs a command in a PTY”，但同一 schema 对 `tty` 明确说明 false/省略使用 pipes；判断默认行为必须读字段及实现。

[参数反序列化及默认值](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/tools/handlers/unified_exec.rs#L27-L75)给出：

- 初始等待 10,000 ms。
- write 等待默认 250 ms，空轮询后续再 clamp 到最低 5,000 ms。
- tty 默认 false；不是由工具的 PTY 标题决定。

[feature 默认](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/features/src/lib.rs#L985-L998)把 UnifiedExec 和 UnifiedExecTty 标为 Stable/default true。
[managed feature 归一化](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/config/managed_features.rs#L153-L167)还把普通用户的旧式 UnifiedExec opt-out 重新打开；仅 managed requirements 可将它固定为关。
因此“配置里写 false 就切回旧 shell”已不是当前契约。

[实际注册](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/tools/spec_plan.rs#L1079-L1118)先检查 environment、ShellTool、模型 Disabled。
满足条件后，feature 开时注册 ExecCommandHandler + WriteStdinHandler；关时注册 one-shot ExecCommandHandler，不暴露保留进程权限。
如果 policy 要求 unified exec 而 feature 被关闭，直接不装配 shell 工具。
模型表虽然仍出现 `shell_type: shell_command`，当前注册判断只将 Disabled 作为禁用条件，不能沿用旧选择器解释。

### 2. 关键调用链

```text
add_shell_tools → ExecCommandHandler / WriteStdinHandler
  exec: 环境选择 → 解析参数 → TTY 开关检查 → shell/工作目录/权限解析
    → UnifiedExecProcessManager → ToolOrchestrator → UnifiedExecRuntime
    → open_session_with_* → sandboxing::spawn_process
    → PTY spawn 或 pipe::spawn_process_no_stdin
    → collect_output_until_deadline → 输出 + exit_code 或 session_id
  write: session.services.unified_exec_manager
    → session_id 查找 → interaction_lock → stdin 审批 → 再验证进程身份
    → write / interrupt / StdinClosed → 消费 pending 输出 → 回执
```

[exec handler](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L240-L320)不是直接 spawn：先拒绝被禁用的 tty，并按 execution environment 解析 shell。
远端环境未上报 shell 时不能随意套用本机 shell；请求另一 shell type 会被拒绝。
one-shot 分支强制 tty=false，配置 completion timeout；不能把它和交互式 yield 混为同一个超时。
[manager orchestration](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager.rs#L1440-L1540)及 [runtime spawn 出口](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/tools/runtimes/unified_exec.rs#L650-L724)保留审批、沙箱与重试链。

### 3. pipe stdin 为什么不是可写的

[本地 spawn 请求](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager.rs#L1412-L1429)同时传 tty 与 `stdin_open: tty`。
[沙箱层分流](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/sandboxing/src/spawn.rs#L104-L138)有三支：PTY、可写 pipe、no-stdin pipe。
但 unified exec 的 tty=false 只能落到第三支；中间那支“源码存在”不代表模型拥有该能力。
[pipe 实现](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/utils/pty/src/pipe.rs#L133-L177)按 PipeStdinMode 决定 stdin 配置。
远端 exec 参数同样显式 `pipe_stdin: false`，见 [executor 参数构造](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager.rs#L230-L251)。

更重要的是 [write handler 的最终分流](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager.rs#L978-L1025)：

- 空 chars：跳过写；只轮询。
- 非 tty + chars 精确等于 `\x03`：调用 interrupt。
- 非 tty + 其他非空输入：StdinClosed。
- tty：将 UTF-8 字节交给 process.write，成功后等 100 ms 再读输出。

因此 `"\x03\n"` 不能当成非 PTY 的 SIGINT API；它不是精确的特殊值。
需要交互 REPL 时，模型必须在启动时选择 tty=true，不能给已启动的 pipe 会话事后升级 PTY。

### 4. 控制字符、信号、EOF

PTY 的 Ctrl-C 是字节输入，效果依赖 terminal line discipline/程序 raw mode。
非 PTY 则由后端 interrupt 实现信号；Unix [interrupt_process_group](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/utils/pty/src/process_group.rs#L255-L265)发送 SIGINT 到进程组。
Windows 的 backend 可能把 interrupt 实现成终止，不能承诺 Unix 信号一致性。
专门的 Windows 测试名是 `write_stdin_ctrl_c_terminates_non_tty_session_on_windows`。

[ProcessHandle::close_stdin](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/utils/pty/src/process.rs#L212-L219)通过移除 writer channel 关闭输入通道。
它没有经 write_stdin schema 暴露；`chars=""` 不调用它。
PTY 上发送 Ctrl-D 只是一种终端交互尝试，不能当作可靠的 pipe EOF，也不能承诺命令一定退出。
模型没有通用 SIGTERM/SIGKILL 或 resize 参数；宿主终止接口与模型输入接口应分开计数。

### 5. 输出、等待、并发

[输出双缓冲](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process.rs#L61-L84)在同一锁下 append pending 与 transcript。
pending 供模型轮询消费；transcript 保留终结回执需要的记录；二者都是有限 head/tail buffer。
每个缓冲的字节限额为 1 MiB；模型回执再受默认 10,000 token 与 policy budget 限制。
这是内存预算与上下文预算两道限制，不能只看 max_output_tokens。

[collect_output_until_deadline](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager.rs#L1574-L1660)用 `mem::take(pending)` 消费输出。
它区分进程退出信号与 output_closed，退出后额外等待最多 50 ms 的 close 窗口。
因此“已经退出”与“所有后代输出 fd 已关闭”不是同一个状态。
超出窗口的尾部行为须做真实进程实验，不将 50 ms 描述成保证不丢输出。

[同会话锁](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager.rs#L885-L911)串行化单一终端读写，避免两个调用消费同一 pending 缓冲。
[WriteStdinHandler](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L22-L113)仍声明 supports_parallel_tool_calls=true：并行的是不同 session，不是同一 stdin 上随意竞争。
等待审批后还用 Arc 身份重新验证，避免原 ID 被移除再复用时写错目标。
PTY 输入响应前的固定 100 ms 不属于进程超时，也不保证已经读到完整响应。

### 6. 所有权、淘汰、turn 与退出

句柄保存在当前 `session.services.unified_exec_manager`，不是模型提供全局 PID 即可控制任意宿主进程。
生产 ID 从 1,000..100,000 随机选择并检查 reserved 集合；这是局部标识分配，不是安全认证。
跨线程/远端宿主的所有权安全仍取决于更外层请求路由，本轮不将随机 ID 宣称为隔离边界。

[淘汰规则](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager.rs#L1723-L1794)：软上限 64，保护最近 8 个，优先淘汰其他已退出项，否则回退到其他 LRU 项。
后者**可以是活进程**，移除后调用 terminate。
interaction_lock 正被持有时跳过；已退出项正在终结而被锁住时，宁可短暂超额，也不因此误选活项。
这不是“永远不杀活进程”。

[turn 完成测试](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/tests/suite/unified_exec.rs#L2847-L2944)断言进程在 TurnComplete 后存活，Shutdown 后退出。
[turn 中断测试](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/tests/suite/unified_exec.rs#L2948-L3033)断言 Op::Interrupt 后进程存活，再用 CleanBackgroundTerminals 清理。
二者是不同于“取消当前等待就 kill”的产品选择，不应直接移植为 S004 默认。
[正常 shutdown](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/session/handlers.rs#L290-L320)显式终止全部会话。
[底层 terminate/Drop](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/utils/pty/src/process.rs#L220-L276)执行 kill 与 I/O task abort，但保留 waiter 的 reap 机会。
正常生命周期成立不等于 macOS 宿主 SIGKILL、掉电或远端断链时也保证无孤儿进程。

### 7. 输入日志与持续授权

[write_stdin_approval 默认开启](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/features/src/lib.rs#L1214-L1220)。
[stdin_approval.rs](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/stdin_approval.rs#L1-L140)保留宿主拥有的启动权限快照，比较当前 policy 与运行时实际 retained grants。
当前 turn 收紧 deny-read，并不能改造旧进程的沙箱；有些差异需要拒绝续写并要求新建终端。
审批在 per-process lock 内完成，审批后重新查进程身份。
serialized action 与 reason 合计超过 8,000 bytes 时拒绝，而不是截断后让未审批尾巴继续执行。

[TerminalInteraction 事件](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager.rs#L1108-L1124)直接保存 `stdin: request.input.to_string()`。
因此密码不回显也不代表输入不进事件、工具参数或审批上下文。
本轮未验证所有日志 sink 的持久化、脱敏和保留策略，不能承诺秘密不被记录。

### 8. 与旧 snapshot 的核实对比

旧报告位置：[S003 Codex 报告](../terminal/codex.md)。本轮没有改写历史报告。

| 旧结论/现象 | 原 SHA 实际证据 | 判定 |
|---|---|---|
| 模型表是 shell_command，所以需手动打开交互工具 | [旧 feature 默认为 !cfg!(windows)](https://github.com/openai/codex/blob/ce803c45aed425b08b94d8e3c5fb7db0d2193568/codex-rs/features/src/lib.rs#L824-L829)，旧 selector 在 feature 开时覆盖模型类型 | **旧推断遗漏默认值**；非 Windows 当时已默认开 |
| LRU 不杀活会话 | [旧 LRU 回退](https://github.com/openai/codex/blob/ce803c45aed425b08b94d8e3c5fb7db0d2193568/codex-rs/core/src/unified_exec/process_manager.rs#L1390-L1421)不要求 exited | **旧总结过度概括**；不是新版本才开始淘汰活项 |
| tty=false 不接受普通 stdin，只特判 Ctrl-C | 当前 handler 与原报告均吻合 | 延续，而非新增 |
| shell_command / unified 双轨选择 | 当前 add_shell_tools 只保留 unified 或 one-shot exec，旧 selector 存在 | **可核实代码差异**；未确定最早变更 commit |
| Windows 默认及等待下限 | 旧 feature 默认排除 Windows；当前 true，当前 schema 下限 10s | **可核实代码差异**，不等于已测试所有 Windows 版本 |

### 9. 测试证据与缺口

仅阅读固定 SHA 中的测试与断言，未执行 cargo、未安装依赖、未启动 Codex。

- `unified_exec_defaults_to_pipe` / `unified_exec_can_enable_tty`：覆盖默认 pipe 与显式 tty。
- `write_stdin_ctrl_c_interrupts_non_tty_session`、Windows 对应测试：区分信号与终止。
- `unified_exec_keeps_long_running_session_after_turn_end` / `unified_exec_interrupt_preserves_long_running_session`：断言跨 turn 存活。
- `write_stdin_calls_run_in_parallel_across_sessions`：测试多会话并行。
- [process_manager_tests.rs#L532-L630](https://github.com/openai/codex/blob/69f7140559180269e2eb8f5be6e0c20eb37b0c85/codex-rs/core/src/unified_exec/process_manager_tests.rs#L532-L630)：覆盖 LRU、最近项保护和终结锁。
- 上述集成测试带网络/沙箱/Windows skip 条件，文件存在不代表 CI 在所有环境执行。

未验证：真实密码程序输入保密、Ctrl-D/raw mode、完整人类接管路由、恶意后代持有 fd、强杀宿主、远端失联、Windows ConPTY 行为、海量输出压力下最终事件完整性。

## 对 S004 的选择启发

1. 先定义 `stdinMode: closed | pipe | pty`，不要让一个“支持交互”布尔值掩盖三种契约。
2. 将 yield deadline、进程生命周期、取消等待、signal、close stdin 分开；空轮询不应同时承担 EOF。
3. 一个会话只允许一个消费 pending 输出的操作；不同会话并行不需要全局串行锁。
4. 若允许跨 turn 存活，必须有宿主可见列表、明确 stop/cleanup、上限及权限变更检查；不能只有随机句柄。
5. 不照搬“64 个软上限 + 淘汰活 LRU”：教学版可以先硬限额拒绝新任务，避免隐藏地杀掉用户服务。
6. 输入内容属于敏感数据路径；日志与审批策略必须在支持密码交互前明确，而不是靠 PTY no-echo 猜测安全。

## 关键源码引用与复现

正文链接均固定完整 SHA；路径以仓库相对路径为准。复现取证只需 Git，不执行仓库代码：

```sh
git clone --depth 100 https://github.com/openai/codex.git <research-dir>
git -C <research-dir> fetch --depth 1 origin 69f7140559180269e2eb8f5be6e0c20eb37b0c85
git -C <research-dir> show 69f7140559180269e2eb8f5be6e0c20eb37b0c85:codex-rs/core/src/tools/spec_plan.rs
git -C <research-dir> fetch --depth 1 origin ce803c45aed425b08b94d8e3c5fb7db0d2193568
git -C <research-dir> show ce803c45aed425b08b94d8e3c5fb7db0d2193568:codex-rs/features/src/lib.rs
```

## 参考资料

- [本轮调研方法](README.md)
- [S003 历史报告](../terminal/codex.md)
- 本文所有产品行为均为 S；不将本机工具碰巧也叫 exec_command 的运行结果当作目标产品实测。
