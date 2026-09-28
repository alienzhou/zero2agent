# DeepSeek Harness：模型交互 PTY、持久命令与人工终端不是一回事

[交互式命令调研](./README.md) | [S003 终端调研](../terminal/README.md)

## 基本信息

| 项目 | 值 |
|---|---|
| 仓库 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| 实际取得的完整 HEAD SHA | `4878cdabd87d4041bdaff61d04c966883b9fd07a` |
| HEAD commit 日期 | `2026-09-28T19:48:10+08:00`，author/committer 时间一致 |
| 分支 | `master` |
| 最近可达 Tag | `dsh-v0.2.0-rc.1`，同时是 HEAD 的精确 tag |
| 获取方式 | 公开仓库 `git clone --depth 100`；未安装依赖、未执行仓库程序 |
| 版本观测时间 | `2026-09-28T23:54:22+0800` |
| 时间校验 | commit 和版本观测均未晚于用户指定的 2026-09-28；没有将未来 commit 当作当日事实 |
| 证据级别 | **S＝固定 SHA 源码确认／未端到端运行**；官方文字单独作为 D，不冒充运行结果 |

本篇是新增产品基线。`researches/terminal/README.md` 旧快照只有 OpenCode、Codex、pi-mono、Gemini CLI、Aider，没有 DeepSeek Harness 报告，因此不存在可据以证明本产品“由不支持变成支持”的旧版本对照。本文不伪造跨版本 diff。

## 调研目标

回答 E02-S004 真正需要区分的问题：模型能否多轮写入同一子进程、默认暴露哪套工具、一次等待何时结束，以及取消、销毁、秘密输入分别落在哪一层。
重点核对插件组合、Web/headless 差异与实际进程资源所有权，不把 PTY 存在等同于模型能交互。

## 调研结论

1. **存在完整模型交互契约，但不是普通默认工具组合。** 可选 `tool-terminal` 注册六个 `terminal_*` 工具，`terminal_send` 直接写同一 PTY，支持多轮输入、控制字符及独立信号。
2. **默认普通 `bash`、minimal 的持久 `bash`、模型 `terminal_*`、人工侧边栏终端是四个不同入口。** 普通 bash 的模型 schema 没有 stdin；minimal 的 bash 每次包装命令，也不能当成原始 stdin 续写 API。
3. **等待结果与进程状态分离值得借鉴。** `stdin_read / inferred_idle / timeout` 都可能对应仍活着的 shell；返回控制权不证明前台命令成功或结束。
4. **生命周期比“关插件就 kill”精细。** 通用模型 PTY 跨工具/后端注册卸载保留；Agent scope 或 terminal service 销毁才等待进程树清理；一次 send 取消主要发 SIGINT，不销毁会话。
5. **安全不能靠 UI 或 env scrub 推断。** 人工终端明确绕过 Agent 沙箱/审批；模型输入进入 tool/call。凭据文件具有 0600 权限，但同 OS 用户子进程与全盘可读沙箱并不因此失去读取能力。

项目明确仍是 developer preview、未安全审计、不可视为 production-ready；这是研究结论适用边界，而非可忽略的免责声明。见 [README.md#L11-L15](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/README.md#L11-L15)、[SAFETY.md#L5-L25](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/SAFETY.md#L5-L25)。

## 能力与默认状态

下表每项实现判断均为 S；“配置可用”指代码组合路径存在，不表示已在本机跑通。

| 入口 | 源码存在／注册 | 配置与默认 | 模型多轮 stdin | 人类输入 | 本轮实测 |
|---|---|---|---|---|---|
| `tool-bash` → `bash` | 插件调用 `ctx.tools.register` | base 默认；Web standard 默认，POSIX 分支 | 无原始 stdin 参数；后台 job 也不增加输入 API | 不是人工终端 | 未运行 |
| `tool-bash-persistent` → `bash` | 单 command 参数的独立插件 | Web minimal / sdk-minimal，非 standard | 同 shell 状态保留，但每次输入是命令包装器，不是裸文本 | 无接管契约 | 未运行 |
| `tool-terminal` → 六工具 | 插件显式注册；要求 tools/terminals/systemPrompt | 可额外组合；已检视 shipped bundle 未默认挂载该插件 | **有**，sessionId + text + submit | 未发现将该模型 PTY 暴露给侧边栏的接管桥 | 未运行 |
| `terminal-controller` → Web sidebar | Remote 服务，不注册模型工具 | Web bundle 装载，headless 无 Web 服务 | 不向模型暴露该输入接口 | **有**，xterm 原始按键 → write | 未运行 |

默认依据不是包名猜测：

- base 挂 `subprocess-local / bash-sandbox / tool-bash / tool-jobs`，默认 `workspace-write + ask`；Windows 对应 pwsh。见 [base/cordis.patch.yml#L220-L276](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/base/cordis.patch.yml#L220-L276)。
- Web 先禁用全局工具行，再按 Agent preset 装载；standard 挂普通 bash，default 指向 standard。见 [web-app/cordis.patch.yml#L430-L467](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/web-app/cordis.patch.yml#L430-L467)、[standard.patch.yml#L4-L25](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/web-app/presets/standard.patch.yml#L4-L25)、[web-app/cordis.patch.yml#L565](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/web-app/cordis.patch.yml#L565)。
- minimal 在隔离的 `terminals` group 内组合 service、backend 和 persistent-bash；不是把六工具默认打开。见 [minimal.patch.yml#L17-L53](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/web-app/presets/minimal.patch.yml#L17-L53)。
- sdk-minimal 是独立完整组合，不继承 base；其 sandbox-policy 明写 `danger-full-access`，不能用 base 默认替它背书。见 [sdk-minimal/cordis.patch.yml#L1-L64](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/sdk-minimal/cordis.patch.yml#L1-L64)。
- 这里的执行核心是 `ctx.shell.execute` 和 `ctx.subprocess`，不是一个默认名为 `exec` 或 `exec_command` 的同名模型工具；内部方法存在与模型 schema 要分别核对。

## 关键调用链

### 模型交互 PTY

`tool-terminal.apply → ctx.tools.register(defineTool) → 按 Agent scope 投影 schema → systemPrompt.tools → ToolRuntime 策略/校验/dispatch → terminal_open/send handler → ctx.terminals → BashTerminalBackend → subprocess.spawnTerminal → node-pty → LocalPtySession 输出/等待 → output.render → tool/result`。

注册不是全局字符串表：同 scope 重名拒绝，Agent-local 定义可以遮蔽全局定义；插件 effect 撤销准确的贡献。
工具运行通过 pre-execute、执行 wrapper、实际 handler、post-execute/finalize 层，不应把直接调用 backend 的测试当作完整策略路径。
`ToolRuntime` 默认 native；PTC 模式会改变模型看见的传输入口和生成 SDK，但不会自动安装缺失的 terminal provider。

证据：[tools/index.ts#L848-L858](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/core/tools/src/index.ts#L848-L858)、[注册#L1057-L1087](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/core/tools/src/index.ts#L1057-L1087)、[schema#L1254-L1284](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/core/tools/src/index.ts#L1254-L1284)、[dispatch#L1564-L1589](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/core/tools/src/index.ts#L1564-L1589)。

### 一次性命令与人工终端

- 普通命令：`bash.execute → shell.resolve/execute → bash-sandbox → bash-local.spawnSpec → subprocess.spawn`；stdout/stderr 各自收集。
- 人工终端：`xterm.onData → client model.write → terminalController.write → BrowserTerminal.write → subprocess terminal handle.write → node-pty`。
- 两者与模型 PTY 共享底层 process provider，不共享输入授权身份或模型会话协议。

证据：[bash handler#L478-L526](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/tool-bash/src/index.ts#L478-L526)、[bash-local stdin#L149-L173](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/bash-local/src/index.ts#L149-L173)、[xterm input#L101](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/client/ui-sidebar-terminal/src/client/terminal.tsx#L101)。

## 详细分析

### 1. 六工具契约明确支持多轮输入

| 工具 | 参数要点 | 真正返回的含义 |
|---|---|---|
| `terminal_open` | type 必填；name/cwd 可选 | service 分配的 `pty-N`、类型、pid、顶层状态、MOTD |
| `terminal_send` | sessionId、text；submit 默认 true；可配置 background | 前台 viewport/waitReason/sessionStatus/truncated，或后台 jobId |
| `terminal_read` | sessionId、offset/count | 有界历史分页，不向程序写入 |
| `terminal_signal` | sessionId、允许的信号枚举 | 已发送及目标 pgid，不是命令退出码 |
| `terminal_close` | sessionId | 等待拥有的进程树清理后 closed/already-closing |
| `terminal_list` | 无 | 只列当前 Agent 的会话 |

`terminal_send` 的 `submit=false` 明确用于控制字符或未完成的 REPL 输入；底层只是 `text + (submit ? '\r' : '')`。
因此第二次 send 能向第一次启动的交互子程序继续输入，不需要重新 spawn。
模型可以先启动 REPL，再在返回后发送表达式；这是源码契约示意，本轮没有运行 REPL。

后台参数默认可见并不代表全部依赖齐全：`enableRunInBackground=false` 会删 schema 字段并拒绝隐藏参数；开启时 handler 仍要求 `jobs`。
错误文字要求 jobs 与 tool-jobs，但实际分支只检查 `ctx.get('jobs')`；缺 tool-jobs 的畸形组合可能得到无法由模型收集的 jobId，不能把错误提示当完整依赖校验。

证据：[六工具及 send handler#L146-L283](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/tool-terminal/src/index.ts#L146-L283)、[read/signal/close/list#L301-L403](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/tool-terminal/src/index.ts#L301-L403)。

### 2. pipe stdin 不是一个已开放的交互后门

普通 bash schema 提供 command、description、timeoutMs、workdir、后台及沙箱升级相关参数，没有 stdin 或可复用进程输入句柄。
`bash-local` 的内部 ShellExecSpec 的确能接受一次性 stdin 数据，但默认映射 `stdin: 'ignore'`；有内部数据字段不等于模型能写。
`job_output / job_kill` 管等待、读取和停止，不把该 stdin 变成可追加的 pipe。

普通 bash 默认还能在等待超时后 promote 成后台 job；这是“进程继续运行”，不是“模型现在能接着输入”。
有 jobs 且后台启用时 promote 默认 true；没有 jobs 的组合退回前台 deadline kill。
取消正在等待的 foreground bash 会调用 registry.kill 并等待结算，与持久 PTY 取消语义不同。

证据：[普通 bash 配置与 job 等待#L208-L369](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/tool-bash/src/index.ts#L208-L369)、[schema#L371-L402](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/tool-bash/src/index.ts#L371-L402)。

### 3. 持久 bash 不等于裸 stdin 续写

minimal 的 persistent-bash 每位 Agent 懒创建一个 PTY，缓存 cwd/env，按 Agent Promise 队列串行命令。
每次 command 被包装为 `printf START; eval -- quoted(command); capture $?; printf END:status`，nonce 用 UUID。
它读 marker 来区分一个命令的结果，默认命令上限 300 秒、模型输出上限 16,000 字符；timeout/abort 会 reset shell。

遇到 `stdin_read` 而尚无 END marker 时，会返回已捕获输出，不死等 deadline。
**但下一次调用仍发送整段包装器**：如果前台子程序正等待密码/回答，收到的不是模型想输入的裸回答。
所以可确认“持久状态”，不能保证该接口安全支持任意交互问答；应使用六工具显式 send。
代码自己保留 TODO：超时提示写“or OOM”，实际超时信号并不能证明 OOM，报告不沿用这个归因。

证据：[wrapper#L65-L85](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/tool-bash-persistent/src/index.ts#L65-L85)、[等待/reset#L300-L389](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/tool-bash-persistent/src/index.ts#L300-L389)、[串行与 schema#L397-L460](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/tool-bash-persistent/src/index.ts#L397-L460)。

### 4. PTY 运行、就绪判断与等待上限

Bash backend 默认 `/bin/bash --noprofile --norc -i`，终端 160×40，`TERM=dumb`、PAGER/GIT_PAGER=cat。
PS1 固定 `dsh> `；PROMPT_COMMAND 发 OSC 133;D marker 并重置提示符，避免普通 PS1 改写使探测永久失效。
pwsh 通过启动输入安装 prompt/编码设置，而非假设 Bash 环境变量对其有效。

默认每 50ms 探测；150ms 后允许精确 stdin 检查；3 秒无输出推断 idle；marker 后另有 500ms foreground handoff 宽限；单 send 绝对 30 秒。
backend 数值可由部署覆盖，minimal 将 timeout 配为 300 秒，不能把 30 秒写成所有 profile 的统一值。
初始化失败走 unpublished session cleanup，成功就绪后 service 才向调用方发布 ID。

`stdin_read` 有两条来源：受控 prompt + shell 恢复前台所有权；或前台组确证在读该终端。
Linux 读取 /proc syscall、fd/device、进程组等证据；macOS/Windows 的 isStdinWaiting 返回 false，依赖 prompt/静默路径。
同一前台组必须先离开旧 wait 再进入新 wait，防止把 write 之前的等待当作本次输入处理完成。

证据：[backend spawn#L201-L238](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/src/index.ts#L201-L238)、[默认值#L92-L110](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/src/config.ts#L92-L110)、[readiness#L549-L606](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/src/session.ts#L549-L606)、[Linux exact probe#L443-L460](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/subprocess/subprocess-local/src/process-inspector.ts#L443-L460)。

### 5. 输出有两种游标，不是完整终端录屏

PTY stdout/stderr 合入同一 terminal.output。
UTF-8 TextDecoder 以 stream 模式处理跨 chunk 字符；end 时 flush decoder 和 sanitizer，onExit 先等待输出 end 才发布终态。
sanitizer 去掉 CSI/OSC/短转义并保留分片状态；返回给模型的是行导向文本，不是全屏应用最终画面的忠实重放。
虽然内部用了 headless xterm，它主要维护协议响应；不能据此宣称模型拿到完整 xterm viewport 语义。

保留历史默认 10,000 行且 4MiB；单 read/send 默认 256KiB；模型最终结果另有 256KiB 完整封装上限。
`read(offset,count)` 的 offset 相对最新行，默认 count=500，历史非消费式；
send 的 `readOutput()` 则消费本 operation 新增输出，供后台 job 拉取。
operation 结算后不再追加新输出；终端继续产生的内容仍进 scrollback，后续需 terminal_read，而非认为旧 job 无限跟随会话。

底层 PassThrough 满时 pause node-pty，drain 时 resume；模型历史截断与传输背压是不同层。
读取历史不受 active-send 锁阻止；但同会话只允许一个 send。
更细的写入/信号/协议排空保留 backend reservation，避免工具表面已 timeout 却把旧异步 write/signal 打进下一次 send。

证据：[解码/EOF/终态#L476-L530](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/src/session.ts#L476-L530)、[read/cancel output#L188-L233](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/src/session.ts#L188-L233)、[背压#L99-L121](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/subprocess/subprocess-local/src/terminal.ts#L99-L121)、[后台消费适配#L12-L29](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/tool-terminal/src/background.ts#L12-L29)。

### 6. 控制字符、信号与 EOF 必须分开

`terminal_send(text='\u0003',submit=false)` 只是把 Ctrl-C 字节写 PTY；是否产生 SIGINT 取决于行规程/ISIG 与前台程序。
POSIX `terminal_signal(SIGINT)` 查询 foreground pgid 后发送真正进程组信号，即使 raw-mode 禁用 ISIG 仍可中断。
允许枚举为 SIGINT/SIGTERM/SIGKILL/SIGTSTP/SIGHUP；若 SIGKILL 目标就是 shell，拒绝并要求 terminal_close。

Windows 不具有同等 POSIX 语义：SIGINT 分支转为写 `\x03`；SIGTSTP/SIGHUP 明确不支持。
Windows inspector 把 shell pid 作为 foreground 标识；不能把文案“verified foreground group”无条件推广成 Linux 等价保证。

六工具没有 close_stdin/end_input；handle 也没有公开 PTY 半关闭契约。
发送 Ctrl-D 是控制字符/VEOF 尝试，不等价于关闭 pipe writer；canonical/raw、已有输入、shell 状态决定后果。
terminal_close 是销毁会话，不是“发 EOF 后继续排空一个仍保留的会话”；本轮未发现并未执行专门 EOF 行为测试。

证据：[raw write#L388-L400](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/src/session.ts#L388-L400)、[信号与 Windows#L196-L219](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/subprocess/subprocess-local/src/terminal.ts#L196-L219)、[Windows inspector#L97-L103](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/subprocess/subprocess-local/src/windows-inspector.ts#L97-L103)。

### 7. 所有权、上限和清理边界

模型 terminal service 用递增 `pty-N` ID，但授权比较 **exact Agent 对象**，不是猜不中 ID 或同名 session。
名字只在 owner 内唯一；创建期间先保留 name 和 pending spawn；owner 消失、取消、服务销毁会回滚未发布资源。
service 的 sessions Map 未见会话数量上限、TTL 或 LRU；缓冲有界不代表 PTY 数量有界。
后台 jobs 默认每 owner 10 个 active jobs，只限制后台工作，不限制已打开 PTY 数量。

| 事件 | 模型六工具 PTY 的处理 |
|---|---|
| 正常 turn 结束 | 没有 turn/end 清理挂钩；仍归活 Agent，允许跨轮 |
| send 静默/timeout | 结算 operation，不自动 kill shell/前台命令 |
| foreground send AbortSignal | 等在途 write，向 foreground 发 SIGINT，再等待就绪/超时；handler 最后报告 aborted |
| background job_kill | operation.cancel，同样不是 terminal_close；job 终态不能证明 shell 消失 |
| terminal_close | await backend.close → terminal.terminate；成功后从 registry 删除 |
| tool-terminal 或 backend 注册卸载 | 取消贡献；已发布 session 仍由 service 持有，不直接销毁 |
| terminal service 或 owner scope dispose | 中止 pending spawn，等待所有 owned sessions close；失败聚合而非报告伪成功 |
| persistent-bash 插件 dispose | **例外**：该插件额外拥有 shell cache cleanup，关闭它所创建的 shell |
| Node 正常退出 | subprocess provider 同步最后清理；不把这等同于完整异步 quiescence |

底层优先用可用的 managed range；fallback 捕获 PID+启动身份，TERM 后 KILL、重复扫描后代，再关 shell，避免 PID 复用误杀。
Linux 强 containment 与 fallback 能力依赖环境；同 session/disowned 后代有测试，不证明一切双重 fork/逃逸均可回收。
普通关停 await 清理；CLI 全树只给 5 秒关停窗口，第二次中断或 deadline 会强制 process.exit。
SIGKILL 宿主、断电等没有 JS exit 回调保证，因此不能写成“宿主任何退出都无孤儿”。

证据：[owner/registry#L318-L391](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal/src/index.ts#L318-L391)、[service dispose#L407-L472](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal/src/index.ts#L407-L472)、[SIGINT/close#L748-L791](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/src/session.ts#L748-L791)、[persistent 插件 cleanup#L223-L247](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/tool-bash-persistent/src/index.ts#L223-L247)、[provider cleanup#L75-L137](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/subprocess/subprocess-local/src/index.ts#L75-L137)、[CLI 关停#L3-L75](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/apps/cli/src/process-shutdown.ts#L3-L75)。

### 8. UI 与 headless：人工控制不是接管模型 PTY

Web TerminalController 用另一套 Session-owned registry 和 WebTerminalId。
create 直接 `subprocess.spawnTerminal`，终端类型 xterm-256color，**明确不采用 Agent sandbox 或 approval restrictions**。
输入 attachment 独占，后来的连接接管输入，旧 attachment 可继续读但写会被拒绝；不是模型/人轮流写同一 terminal_send 的仲裁机制。
BrowserTerminal.write 再次检查 controller 并排入串行队列，避免旧连接已排队的输入越过新控制权。

默认每 Session 8 个 terminal（包括 pending/allocation）；最大输入 64KiB，慢读者帧队列 2MiB、scrollback 1000 行。
客户端断开不是关闭：已 commit terminal 保留，可恢复画面；无 window hold 且持续确认 idle，默认 2 小时回收，轮询 30 秒，清理失败 60 秒重试。
owner 或 controller dispose 才统一 await 清理，不能把“关浏览器标签”当成结束子进程。

headless bundle 在 base 之上，不挂 Host/HTTP/Web/browser，也不带 Web preset roster。
stdin 供读取任务文本，不会自动转发给模型子进程；完成一次 Agent 工作、flush 日志后请求 appExit，应用树随之关闭。
配置补齐 terminal service/backend/tools 后，模型 PTY 不要求宿主 stdin.isTTY；但本轮未验证真正无 TTY 环境和原生依赖可用性。

证据：[人工终端配置/create#L74-L185](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/api/terminal-controller/src/index.ts#L74-L185)、[write#L221-L232](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/api/terminal-controller/src/index.ts#L221-L232)、[独占输入#L105-L112](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/api/terminal-controller/src/terminal.ts#L105-L112)、[spawn/owner cleanup#L297-L351](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/api/terminal-controller/src/index.ts#L297-L351)、[headless bundle#L1-L34](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/headless/cordis.patch.yml#L1-L34)、[headless run#L325-L382](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/bundle/headless/src/index.ts#L325-L382)。

### 9. 审批与秘密的实际路径

**审批不是每次 stdin 都问人。** 普通 bash 在请求 sandbox_permissions 升级时先走 approveEscalation；没有批准不能先执行。
ApprovalService 的 ask 无回答者 fail-closed；never 是拒绝 ask，不是“所有请求自动批准”。
六工具没有自己的逐 send approval 调用；terminal-bash 在 open 时解析当前 sandboxPolicy、非 full-access 时要求 sandbox provider 并 confine shell argv。
会话活着或正在创建时禁止切换 sandbox mode，避免旧 shell 继续使用已变化的权限语义。一般 tools/pre-execute 插件仍可增加策略，本文不宣称任何用户配置都跳过审批。

**秘密有三个不同暴露面：**

1. **继承环境变量**：统一 scrub 删除变量名匹配 `KEY|PASSWORD|SECRET|TOKEN` 或 `DSH_*` 的项；显式 env 覆盖发生在 scrub 之后，能有意恢复。它是名字启发式，不是秘密内容扫描。
2. **文件秘密**：credentials-local 实际存储为 `$DSH_HOME/.credentials.yaml`，默认 `~/.dsh/.credentials.yaml`，另有项目/.env 和 home/.env 回退来源；写入 0600、目录 0700，不是加密存储或对子进程访问授权。
3. **输入/输出日志**：模型发送的 text 在 tool/call.arguments 中原样持久化，tool/result 留下返回文本和 UI meta；background label 也含 text。关闭 echo 或密码框隐藏显示不能擦掉已进入模型参数的秘密。

当前 Linux bwrap 使用全根只读挂载、Landlock readOnly=['/']；macOS Seatbelt allow default 后限制 file-write。
因此 workspace-write/read-only 是写入边界，**不是对同用户可读凭据文件的保密边界**；模型仍可能通过允许的读取命令访问这些文件。
人工 Web 终端没有 tool/call 路径，本段链未见逐键 session-log 持久化；但输出恢复缓冲、shell history、应用日志、读取主目录都可能暴露秘密，不能称为“秘密专用通道”。

证据：[升级前审批#L223-L253](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/shell/tool-bash/src/index.ts#L223-L253)、[审批语义#L134-L152](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/interaction/user-approval/src/index.ts#L134-L152)、[mode fence#L37-L61](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/src/index.ts#L37-L61)、[env scrub#L40-L79](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/subprocess/subprocess/src/index.ts#L40-L79)、[凭据真实路径#L60-L93](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/credentials/credentials-local/src/index.ts#L60-L93)、[0600 写入#L675-L691](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/credentials/credentials-local/src/index.ts#L675-L691)、[沙箱读写边界#L16-L57](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/sandbox/sandbox-local/src/profiles.ts#L16-L57)、[持久化参数和结果#L262-L289](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/core/agent-loop/src/tool-calls.ts#L262-L289)。

## 测试证据与缺口

以下均是**阅读测试源代码，未运行**；“真实 shell 测试”描述测试自身夹具，不代表本次实测。

| 已阅读测试 | 能证明的测试意图 | 不能扩大的结论 |
|---|---|---|
| tool-terminal/tools.spec.ts，143–193 | stub backend 经工具入口走 open/list/read/signal/send/close，断言 structured value 和模型文本 | 不是操作系统 PTY 验证 |
| terminal/service.spec.ts，506–555 | 并发 close 合并、closing 拒绝 send、backend 卸载保留会话、owner/service dispose | 不证明全部真实孙进程已死 |
| terminal-bash/local.spec.ts，139–159 | 真 node-pty 的 cwd/env 跨 send、敏感 env scrub | 不证明凭据文件不可读 |
| 同文件，219–281 | SIGINT 前台、TERM-ignoring 后代、disown 后 shell 退出再清理 | 不证明任意 setsid/namespace 逃逸可回收 |
| 同文件，283–315 | raw-mode 禁用 ISIG 后通过真实 SIGINT 取消，随后仍能发命令 | 不是 Windows 控制字符等价性 |
| apps/cli/tests/headless-shutdown.e2e.ts，124–130 | POSIX PTY 启动 headless，第二次 Ctrl-C 强退卡住的 disposer | 没有断言所有 terminal 后代和秘密日志 |

测试链接：[工具完整生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/tool-terminal/tests/tools.spec.ts#L143-L193)、[服务卸载](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal/tests/service.spec.ts#L506-L555)、[真实 shell fixture](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/tests/local.spec.ts#L139-L159)、[后代与 raw-mode](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/terminal-bash/tests/local.spec.ts#L219-L315)、[headless 强退](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/apps/cli/tests/headless-shutdown.e2e.ts#L124-L130)。

明确未验证清单：

- 未启动任一 shipped profile、模型、Web UI 或 headless 程序；没有依赖构建/原生模块安装结果。
- 未做 Linux/macOS/Windows 的现场对照，未测 ConPTY、无 console Windows、SSH subprocess provider。
- 未测 canonical/raw Ctrl-D、stdin 真 EOF、逐字符 Unicode 输入、二进制字节与半关闭；schema 只有 UTF-8 text。
- 未测多轮密码提示；没有证明模型日志、UI 恢复、shell history、遥测全链路脱敏。
- 未验证 Ctrl-C 后忽略 SIGINT 的前台进程是否长期留存；源码取消路径没有自动等价升级为 terminal_close。
- 未验证最终没有 window holds 的 idle 回收、全屏程序还原、恶意 OSC/prompt spoof，以及慢读者压力下的内存峰值。
- 未验证 daemon 双重 fork、宿主 SIGKILL、内核 containment 不可用等极端清理场景；fallback 不等于安全隔离。
- 未验证项目自定义 pre-execute/第三方插件组合，缺 tool-jobs 的错误组合需额外验收。

## 对 E02-S004 的选择启发

1. **先选 API，不先选 PTY 库。** 最小闭环至少要明确 execute/open、write、read/wait、close；持久 cwd 不能替代交互输入。
2. **等待结果单列 reason，退出结果单列 status。** “安静 3 秒”可交还模型，但不能填 exitCode=0。
3. **读、写、信号三条操作分别建模。** 同 session 单写者；读取可并行；信号在旧写入排空后归属明确，避免杀到下一条命令。
4. **取消与关闭不能共用一个模糊按钮。** 取消前台尝试恢复 shell；close 承诺资源回收。若 S004 先选择取消即关闭，应明确这是更窄的课程契约。
5. **不要直接照搬数量策略。** DeepSeek 模型 PTY 没有显式数量限额；S004 应先有 owner 限额和确定性的拒绝策略，再讨论 idle 淘汰。
6. **秘密通道要独立设计。** 人工单独终端不是自动接管，也不是秘密保证；若要人输入秘密，应阻止其经过模型参数，并定义日志、echo、输出反射和文件权限边界。
7. **采用分层测试，不把 stub 测试叫端到端。** 工具契约、进程 fixture、平台矩阵、关闭/异常退出四组分别验收；优先加入 EOF、raw-mode SIGINT、并发取消和子孙进程用例。

## 关键源码引用与复现方式

正文链接全部固定到实际 HEAD，覆盖 schema、默认组合、注册、handler、runtime、PTY、输出、清理、安全和测试。
内部路径均为目标仓库相对路径；临时检出目录不属于交付物。

只获取和检查源码的复现命令（`<checkout>` 替换为独立临时目录；不要执行仓库代码）：

```sh
git clone --depth 100 https://github.com/deepseek-ai/deepseek-harness.git <checkout>
git -C <checkout> rev-parse HEAD
git -C <checkout> show -s --format='%H%n%cI%n%aI' 4878cdabd87d4041bdaff61d04c966883b9fd07a
git -C <checkout> describe --tags --abbrev=0 4878cdabd87d4041bdaff61d04c966883b9fd07a
git -C <checkout> show 4878cdabd87d4041bdaff61d04c966883b9fd07a:packages/terminal/tool-terminal/src/index.ts
```

未来 HEAD 变化后，浅克隆未必包含本 SHA；可额外 fetch `dsh-v0.2.0-rc.1` 并核对其完整 SHA，不能直接拿最新工作树验证旧链接。
版本观测只陈述取证时的事实，不声称网络远端永久停留在该提交。

## 参考资料

- [固定版本安全声明](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/SAFETY.md)（D，已与源码边界交叉核对）。
- [固定版本持久 PTY 子系统文档](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/docs/subsystems/terminal.md)（D，不能替代 handler/provider 证据）。
- [固定版本六工具组合说明](https://github.com/deepseek-ai/deepseek-harness/blob/4878cdabd87d4041bdaff61d04c966883b9fd07a/packages/terminal/tool-terminal/README.md#L41-L66)（D，尤其注意实际后台依赖校验比文字更窄）。

