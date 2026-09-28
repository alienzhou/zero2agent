# 补充样本广筛：哪些交互式终端方案值得继续追

[调研入口](./README.md) · E02-S004 · 非市场排名、非选型决策

## 结论先行

七个主样本之外，最值得补充的不是更多“会执行命令”的品牌，而是三个边界：

1. **终端归谁控制**：Cline 的 IDE 可见终端由人参与，不能直接等同于模型可续写的 session。
2. **schema 与默认后端是否一致**：OpenHands 明确有模型输入 schema，但当前 tmux 池会重置未完成会话，不能只凭 schema 宣称默认可用。
3. **产品有 PTY，不等于 Bash 用 PTY**：新 Kimi Code 同时有 PTY 服务和主动关闭 stdin 的模型 Bash 路径。

Roo 补充“模型等待期限”和“用户执行期限”分离的反例。
Goose、mini-swe-agent 提供明确限制交互的对照组。
Qwen 与 Gemini 同源但已经独立演进，应看差异，不能算两票独立设计共识。
Claude Code、Cursor、VS Code/Copilot 只登记公开契约，不推测私有实现。

本页是广筛，不替代主样本的注册链、配置链、生命周期和测试深挖。
没有安装产品、执行外部仓库代码或运行其测试；本页没有 E 级产品验证。

## 观察范围与证据规则

本轮源码和官方页面观测日：**2026-09-28，Asia/Shanghai**。
工作目录的日期核对发生于当日 23:56；仓库 commit 日期保留原始时区。
branch 是克隆时 HEAD 的分支，不代表报告读取时远端永远不变。

- **S**：本轮读过固定 SHA 的源码、配置、测试或仓库文档。
- **D**：本轮读取的官方在线文档；网页没有固定代码 SHA，今后可能变更。
- **U**：未查实、链路未闭合或缺少运行验证。
- 本页“未提供”只限定已读 schema/路径，绝不等于整个产品永久不支持。
- “默认”区分参数默认、后端默认、工具默认注册、用户已有配置和运行结果。
- 仓库测试只作为设计断言；本轮未执行，不写成通过。
- heredoc、管道预置输入不算读到提示后再续写。
- AskUserQuestion、聊天反馈不算进程 stdin。
- 输出流式通知不算工具 yield；工具返回后进程是否存活要另查。
- 人类打开终端不等于接管具有互斥、脱敏或恢复协议。

## 固定版本登记

| 样本 / 官方仓库 | 本轮完整 SHA | Commit 日期 | Branch / tag |
|---|---|---|---|
| [Cline](https://github.com/cline/cline) | `46c9035e4d9f62ecc81ee0673aeb41db1561239d` | 2026-09-28 07:48:03 -0700 | main |
| [Goose](https://github.com/block/goose) | `0193ffc4ff9253fa0708c8cfe94871be9636d951` | 2026-09-28 12:59:29 +0000 | main |
| [Kimi 旧仓](https://github.com/MoonshotAI/kimi-cli) | `9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82` | 2026-09-22 09:29:17 +0000 | main / 1.52.0 |
| [Kimi Code 新仓](https://github.com/MoonshotAI/kimi-code) | `a940f2ff049ed57abce68c59526de7a6628a4112` | 2026-09-28 19:36:51 +0800 | main |
| [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk) | `a130c8f9edf38c7a46825f7e6761d2497a00907b` | 2026-09-28 12:27:52 -0300 | main |
| [Roo Code](https://github.com/RooCodeInc/Roo-Code) | `b867ec9145750d0ae1ff7f02d35406e9bf2a0b16` | 2026-05-15 14:04:45 -0400 | main |
| [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) | `04d809ceab9df28f9adaed044884180159172930` | 2026-09-03 01:05:59 -0400 | main |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | `a765229c0affd0642973412a3480b992935e2eff` | 2026-09-28 15:07:40 +0000 | main |

旧 Kimi 只作迁移证据，不计为一份当前实现。
除旧 Kimi 明确读到的 tag 外，不推测其余仓库最近发布版本。
浅克隆缺少历史 tag 不是“没有发布”的证据。

## 快速能力矩阵

| 样本 | 模型续写 stdin | PTY / 人类输入 | 会话与 yield | 默认与证据边界 |
|---|---|---|---|---|
| Cline VS Code | U；已读 run_commands 封装不是独立 stdin 工具 | S：VS Code terminal 可见，shell integration；不是本页确认的原生 PTY 实现 | S：终端复用、Proceed While Running、300 秒自动 proceed | S：新用户 vscodeTerminal；standalone 钳制 backgroundExec |
| Goose developer shell | S：本路径 stdin=null，schema 仅 command/timeout | S：本路径 pipe；终端集成是另一功能 | S：等待完成/取消；通知流不等于可续写 session | S：工具在 Developer 列表；全产品默认启用 U |
| Kimi Code Bash | S：spawn 后 stdin.end；无续写字段 | S：另有 node-pty TerminalService；与 Bash 不同 | S：后台 task ID、前台超时可转后台 | S：依赖 process capability；后台受 Task 工具策略约束；最终发行配置 U |
| OpenHands SDK | S：is_input、特殊键；**默认池路径有冲突** | S：tmux；无 tmux 时 subprocess，Windows PowerShell | S：单会话 soft timeout；池每次 checkout 准备状态 | S：自动注册不等于 Agent 默认选择；有 tmux 时 executor 默认池 |
| Roo Code | S：已读 execute_command 无 input 字段；Execa stdin=ignore | S：可选 VS Code shell integration；严格接管协议 U | S：agent timeout 让步、user timeout abort | S：执行入口 fallback shellIntegrationDisabled=true；旧配置可能覆盖 |
| mini-swe local | S：command → Popen → communicate，无续写句柄 | S：本路径非 PTY；stdin 未显式重定向，不能说 DEVNULL | S：每命令新 shell，完成或超时返回 | S：local 可选注册；不同启动配置的默认环境 U |
| Qwen Code | U：shell schema 无续写字段，不穷尽全工具集 | S：PTY service + 人类 ShellInputPrompt | S：后台注册/输出文件/用户输入 focus | S：is_background 默认 false；全平台 PTY 默认链 U |
| Claude Code | U：后台任务契约不能证明续写 | U：公开页不足以证明 Bash PTY 或原始接管 | D：后台 ID、输出文件、不同 owner 的生命周期 | D：可禁用后台；本轮未运行 |
| Cursor | U | D：直接在终端执行；PTY/接管 U | U：本页不足以完整确认 | D：Run Mode 管执行/审批/沙箱；当前默认模式 U |
| VS Code / Copilot | U：已读公开工具引用不足 | D：集成终端可显示；接管协议 U | D：Continue in Background、后续取输出 | D：工具可用与审批分离；harness 差异需保留 |

## Cline：IDE 终端所有权比 stdin 更重要

### 实際读到的路径

当前 VS Code 的自定义工具叫 `run_commands`，封装 SDK shell 工具。
不能把旧版本 `execute_command` 的记忆直接套到这个 SHA。

`createVscodeShellExecutor` 有两条路径：

- `vscodeTerminal`：VscodeTerminalManager 获取可见终端，运行并观察 shell integration。
- `backgroundExec`：SDK createShellExecutor，headless child_process；此处 background 是执行模式名，不自动等于可分离 task。

新用户状态默认终端复用开启，执行模式为 vscodeTerminal。
已有偏好保留；standalone/JetBrains/CLI 没有真实 VS Code terminal，能力守卫将其钳制为 backgroundExec。

前台允许用户 Proceed While Running，并在 300 秒后自动 proceed。
工具返回时命令可以仍在用户终端运行；剩余输出写入封顶 10 MiB 的临时日志。
这是“观察者退出等待”，不是“进程已经退出”。

### 完成证据和不确定性

没有 shell integration 时会 sendText，再用延迟与终端内容捕获处理。
有 integration 但缺失完成标记的 nested shell/SSH 也可能采用启发式。
源码明确标记 unobserved，而不是捏造可靠 exit code。

Manager 会把不再可靠观察的终端移出复用池。
markerless 或已经不属于 Cline 的终端可保留；部分 managed fallback 在下次获取时清理。
这说明“停止观察”“不复用”“关闭终端”是三个不同动作。

本页未闭合模型直接续写输入的 schema/注册链；sendText 存在本身不能证明这一能力。
人类可见终端也没有自动证明密码不进 shell history、剪贴板或 transcript。
取消与人类工作共用终端时，不能照搬 headless 子进程强杀语义。

### 取舍与证据

纳入：主样本以独立 CLI 为主，Cline 补 IDE 宿主的所有权与观测降级。
不继续深挖：不审计全部宿主桥接、SDK shell 实现、遥测和 UI 状态机。

- [run_commands 封装与 proceed 常量](https://github.com/cline/cline/blob/46c9035e4d9f62ecc81ee0673aeb41db1561239d/apps/vscode/src/sdk/vscode-run-commands-tool.ts#L1-L80)
- [终端默认配置](https://github.com/cline/cline/blob/46c9035e4d9f62ecc81ee0673aeb41db1561239d/apps/vscode/src/shared/storage/state-keys.ts#L75-L82)
- [缺失标记与 sendText fallback](https://github.com/cline/cline/blob/46c9035e4d9f62ecc81ee0673aeb41db1561239d/apps/vscode/src/hosts/vscode/terminal/VscodeTerminalProcess.ts#L475-L513)
- [终端所有权与逐出/清理](https://github.com/cline/cline/blob/46c9035e4d9f62ecc81ee0673aeb41db1561239d/apps/vscode/src/hosts/vscode/terminal/VscodeTerminalManager.ts#L205-L250)
- [standalone 能力钳制](https://github.com/cline/cline/blob/46c9035e4d9f62ecc81ee0673aeb41db1561239d/apps/vscode/src/sdk/vscode-terminal-execution-mode.ts)

## Goose：关闭 stdin 的 shell 也能有流式体验

Developer extension 将 `shell` 列入工具，参数只有 command 与 timeout_secs。
执行函数设置 stdout/stderr 为 pipe，stdin 为 null。
因此这条已读路径明确不是等待模型交互输入的会话。

执行会发实时输出通知，但最终工具仍等待 child.wait、超时或取消。
默认超时从全局配置/default extension timeout 解析；不是省略即无限等待。
本页未追全平台配置，不能把 Developer 已注册写成所有入口默认启用。

退出后输出收集另有 500 ms drain 上限。
这是为了避免后台后代持有 stdout/stderr 导致宿主永远等不到 EOF。
返回结构区分 timed_out、output_truncated、output_collection_error。
输出超过界限可落盘，临时文件使用有限槽位；不是永不丢失的持久审计日志。

另一个容易混淆的官方功能是 `goose term init`：
它让用户在自己的 shell 输入 @goose，把此前命令上下文交给 agent。
具名会话可以跨窗口延续聊天上下文；这不是 developer shell 的 stdin 续写证据。

纳入：证明流式输出、shell 集成、聊天 session 与交互式进程 session 可完全分离。
不深挖：其他 extension、MCP、远程执行后端；不能据此否定扩展实现 PTY 的可能。

- [ShellParams 与返回结构](https://github.com/block/goose/blob/0193ffc4ff9253fa0708c8cfe94871be9636d951/crates/goose/src/agents/platform_extensions/developer/shell.rs#L178-L207)
- [pipe、stdin=null、等待与 drain](https://github.com/block/goose/blob/0193ffc4ff9253fa0708c8cfe94871be9636d951/crates/goose/src/agents/platform_extensions/developer/shell.rs#L549-L657)
- [工具列表与 dispatch](https://github.com/block/goose/blob/0193ffc4ff9253fa0708c8cfe94871be9636d951/crates/goose/src/agents/platform_extensions/developer/mod.rs#L130-L228)
- [shell 集成与 named sessions](https://github.com/block/goose/blob/0193ffc4ff9253fa0708c8cfe94871be9636d951/documentation/docs/guides/terminal-integration.md#L1-L95)

## Kimi Code：必须从归档 Python 仓跟到新实现

旧 `MoonshotAI/kimi-cli` README 明确宣布归档，并指向 `MoonshotAI/kimi-code`。
连 PyPI 上旧 `kimi-code` alias 也不是新的 Kimi Code CLI。
因此不以旧 Python Shell 工具作当前产品结论。

新仓包含 TypeScript agent-core-v2。
本轮重点读 BashTool 的完整参数入口、spawn、stdin 关闭、注册和终端后端接口。

Bash 参数为 command、cwd、timeout、description、run_in_background、disable_timeout。
前台默认 60 秒，上限 5 分钟；后台默认 10 分钟，上限 24 小时，允许显式关闭后台超时。
这些是本 SHA 的 schema/常量，不是运行实测。

Bash 以 process capability 启动 shell -c，设置 TERM=dumb 等非交互环境。
spawn 后调用 closeProcessStdin，内部就是 proc.stdin.end()。
因此后台 task ID 是输出/停止管理句柄，不是可继续写 stdin 的证明。

Bash 已注册，但后台可用还要求 TaskList、TaskOutput、TaskStop 同时 active。
autoBackgroundOnTimeout 的配置缺省值为 true；这仍受工具策略条件限制。
发行入口最终工具集、权限模式和每个 provider 的运行结果保留 U。

另一方面 HostTerminalService 真正调用 node-pty，提供 write、resize、kill。
它作为 terminal capability 注册，和 Bash 的 process capability 路径不同。
不能把这个宿主 PTY 接口直接说成模型 Bash 已支持输入或“接管正在执行的 Bash”。

工具说明甚至同时出现开头的“interactive or multi-step”和后文“shall not ... interactive command”。
评估应以 schema + 实际关闭 stdin 的执行路径为准，不择取一句宣传性文字。

纳入：这是“同产品双执行平面”的最清晰反例，建议在主结论保留。
不深挖：KAP terminal 路由、客户端输入 UI、ACP terminal 和旧实现的迁移兼容。

- [旧仓归档与官方迁移](https://github.com/MoonshotAI/kimi-cli/blob/9ab1286b8fe4e6bcd116949a27ce5e0ac3389c82/README.md#L1-L43)
- [新 Bash schema 与时间上限](https://github.com/MoonshotAI/kimi-code/blob/a940f2ff049ed57abce68c59526de7a6628a4112/packages/agent-core-v2/src/agent/tools/os/bash/bash.ts#L1-L65)
- [Bash 策略、spawn 与 stdin 关闭调用](https://github.com/MoonshotAI/kimi-code/blob/a940f2ff049ed57abce68c59526de7a6628a4112/packages/agent-core-v2/src/agent/tools/os/bash/bashTool.ts#L114-L210)
- [注册及 stdin.end](https://github.com/MoonshotAI/kimi-code/blob/a940f2ff049ed57abce68c59526de7a6628a4112/packages/agent-core-v2/src/agent/tools/os/bash/bashTool.ts#L439-L461)
- [独立 node-pty 宿主服务](https://github.com/MoonshotAI/kimi-code/blob/a940f2ff049ed57abce68c59526de7a6628a4112/packages/agent-core-v2/src/os/backends/node-local/hostTerminalService.ts)

## OpenHands：有明确输入协议，也有默认后端张力

### 仓库身份与注册

真实执行工具本轮定位到 `OpenHands/software-agent-sdk` 的 openhands-tools 包。
该仓 README 明确 SDK 驱动 OpenHands CLI 与 Cloud；不只翻旧 OpenHands runtime。
SDK 示例由用户显式构造 Agent 的 tools 列表，包括 TerminalTool。

TerminalTool 在模块 import 时 register_tool。
这证明可注册、可选择，不证明所有 OpenHands 部署无条件默认开启。
executor 在 tmux 可用且 terminal_type 为 None/tmux 时采用 pane pool。
否则工厂选择单会话 subprocess；Windows 有 PowerShell backend。

### 单会话输入协议

TerminalAction 暴露 command、is_input、timeout、reset。
is_input 默认 false；输入特殊键包括 C-c、C-d、方向键、TAB、ESC、ENTER。
空 command 可继续获取前一未完成命令的日志。
reset 会失去原 session 状态，且不能和 is_input=true 合用。

TerminalSession 以 prev_status 区分完成与仍在运行。
soft timeout 会返回 -1，并允许调用方继续取日志或输入。
无前一运行命令时，is_input 会返回明确错误。
普通输入经过 strip，再按是否特殊键决定是否附加 Enter。
因此这不是任意原始字节无损 stdin API，前后空白可能改变。

### 必须强调的默认池冲突

当前 _execute_pooled 每次从 pool 取 pane 后，先调用 _prepare_pooled_session。
它对 NO_CHANGE_TIMEOUT / HARD_TIMEOUT / CONTINUE 的旧状态发送 interrupt，
等待 prompt，清屏，并把 prev_status 设为 None、prev_output 清空。

随后 TerminalSession.execute 又规定 prev_status 不在运行集合时拒绝 is_input。
据此可以明确指出：**当前默认池执行链不能直接继承单会话的跨调用续写承诺**。
这不是仅靠搜索未命中得出的“不支持”，而是实际读到的两段相互作用。
但本轮没有运行 tmux，具体版本表现、竞态和维护者意图仍待验证，不写成已复现 bug。

### 价值与后续

优先补深挖：tmux pane pool 与 session affinity，比再加一个普通 PTY wrapper 更有增量。
建议先验证无 tmux 单会话，再验证有 tmux 默认池，观察相同 is_input 脚本。
必须同时看会话保留、并发隔离和输入路由；仅“支持 PTY”不能覆盖这些条件。
人类 UI 接管、跨重启恢复、secret registry 对全部日志的覆盖不在本页证明范围。
已读 send_keys 测试存在，不代表默认池端到端交互测试已通过。

- [SDK 身份与显式 tools 示例](https://github.com/OpenHands/software-agent-sdk/blob/a130c8f9edf38c7a46825f7e6761d2497a00907b/README.md#L35-L83)
- [输入 schema、自动注册与资源声明](https://github.com/OpenHands/software-agent-sdk/blob/a130c8f9edf38c7a46825f7e6761d2497a00907b/openhands-tools/openhands/tools/terminal/definition.py)
- [executor 默认池与每次取用预处理](https://github.com/OpenHands/software-agent-sdk/blob/a130c8f9edf38c7a46825f7e6761d2497a00907b/openhands-tools/openhands/tools/terminal/impl.py#L115-L270)
- [pool 调用准备函数后执行](https://github.com/OpenHands/software-agent-sdk/blob/a130c8f9edf38c7a46825f7e6761d2497a00907b/openhands-tools/openhands/tools/terminal/impl.py#L472-L580)
- [单会话验证与 send_keys](https://github.com/OpenHands/software-agent-sdk/blob/a130c8f9edf38c7a46825f7e6761d2497a00907b/openhands-tools/openhands/tools/terminal/terminal/terminal_session.py#L410-L558)
- [特殊键测试，仅阅读](https://github.com/OpenHands/software-agent-sdk/blob/a130c8f9edf38c7a46825f7e6761d2497a00907b/tests/tools/terminal/test_send_keys.py#L1-L100)

## Roo Code：后台让步不应撤销用户执行期限

本轮 README 明确写 Roo Code Extension 已于 May 15th 关闭。
同一固定 commit 的日期为 2026-05-15；不能把它当作持续维护中的最新产品。
README 指向社区 ZooCode fork 和其源头 Cline；本页不把社区 fork 当官方接班实现。

execute_command 参数仅 command、cwd、timeout，运行前 askApproval。
执行入口默认 terminalShellIntegrationDisabled=true；用户旧配置可覆盖。
Execa 路径明确 stdin=ignore，是非交互 pipe 执行。
可选 VS Code terminal 路径不能由 Execa 的行为一概否定。

关键设计是两套计时器：

- agentTimeout：结束 agent 等待，process.continue，命令继续运行。
- commandExecutionTimeout：用户配置的执行上限，到期 abort。
- 源码明确两者独立，进入后台后用户上限仍作为安全网。
- ROO_CLI_RUNTIME=1 时忽略模型 background timeout，服从 CLI 生命周期设置。

用户 command_output 聊天反馈被放入 message 并调用 continue。
这是把控制权交还 agent，不是把 feedback 文本写入正在运行的子进程。
模型等待值与进程生存值应分别命名，是对课程直接有用的设计对照。

纳入：保留双超时机制作为历史可复查实现。
不深挖：停止维护产品的 UI 全链路、社区继任项目和云产品状态。

- [官方 README 停止服务说明](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/README.md#L65-L77)
- [参数、审批和执行模式 fallback](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/tools/ExecuteCommandTool.ts#L25-L104)
- [双超时与用户反馈](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/tools/ExecuteCommandTool.ts#L280-L425)
- [Execa 明确关闭输入](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/integrations/terminal/ExecaTerminalProcess.ts#L37-L58)

## mini-swe-agent：教学对照组，不必把最小执行器改成终端

local execute 取 action.command，调用 Popen(shell=True)，合并 stdout/stderr。
communicate 等完成，超时杀进程组，回收输出后返回错误信息。
未显式配置 stdin：通常继承父进程输入；不能误写为 stdin=DEVNULL。
但已读接口不返回可续写 session，也没有模型输入参数。

默认提示模板明确“每条 action 一个新 subshell”，cd/env 不持久。
这与宿主 conversation 可以持续完全不矛盾。
local timeout 配置默认 30 秒，属于单次执行限制，不是 yield 期限。

环境注册表另有 docker、singularity、bubblewrap、swerex_docker 等。
SWE-ReX Docker 适配此处调用 runtime.execute(RexCommand(...))，仍收结果。
不能因为依赖名含 SWE-ReX，就推导 mini-swe 工具开放其所有交互 session API。
也不能以 local 路径推导所有可插拔环境都不支持终端。

纳入：说明课程仍可保留简单非交互路径作为基线，复杂性由明确需求引入。
不深挖：全部环境、benchmark runner、外部 SWE-ReX 的完整协议。
工具注册方式是环境映射/类选择，不是“默认注册一个 PTY tool”；启动默认取决配置。

- [local 完整执行与超时回收](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/environments/local.py)
- [提示中的新 subshell 规则](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/config/default.yaml#L1-L43)
- [环境可选映射](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/environments/__init__.py)
- [SWE-ReX 适配的实际调用](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/environments/extra/swerex_docker.py#L1-L60)

## Qwen Code：同源要去重，分叉后的契约要重看

官方 README 自述最初基于 Gemini CLI v0.8.2，自 Qwen Code v0.1 起停止同步并独立开发。
这是来源说明，不是本页重建的 Git 历史；两个版本号也不应误读为当前版本。
因此“不必再看，因为完全一样”和“两个品牌就是两份独立共识”都不成立。

当前 shell schema 有 command、is_background、timeout、description、directory。
is_background 缺省 false，timeout 上限 600000 ms。
本页未读到此 schema 的 stdin/session 输入参数，但不穷尽其他工具。

ShellExecutionService 有 activePtys、writeToPty。
CLI 的 ShellInputPrompt 把人类按键转换为 ANSI 后写到 activeShellPtyId。
Ctrl+F 用来切换 shell focus，不向 PTY 透传。
这是 S 级人类输入路径；不是模型获得 writeToPty 工具的证据。

后台执行有独立 registry、输出文件和 foreground→background 路径。
模型提示明确空输出不能证明进程死掉：非 TTY 程序可能 block-buffer stdout。
这条活性判断规则值得纳入课程；不在本页审完托管 runtime、SSH 和 Windows 后端。

纳入：保留血缘说明、人类 focus 输入和后台活性语义差异。
不升级为第八个全面主样本：本轮增量优先于重复深挖同源 PTY 结构。
发行配置是否默认使用 PTY，以及完整工具集是否另有模型续写，保留 U。

- [官方血缘和独立演进声明](https://github.com/QwenLM/qwen-code/blob/a765229c0affd0642973412a3480b992935e2eff/README.md#L210-L216)
- [shell schema](https://github.com/QwenLM/qwen-code/blob/a765229c0affd0642973412a3480b992935e2eff/packages/core/src/tools/shell.ts#L5720-L5773)
- [PTY 输入服务](https://github.com/QwenLM/qwen-code/blob/a765229c0affd0642973412a3480b992935e2eff/packages/core/src/services/shellExecutionService.ts#L2949-L2975)
- [人类 ShellInputPrompt](https://github.com/QwenLM/qwen-code/blob/a765229c0affd0642973412a3480b992935e2eff/packages/cli/src/ui/components/ShellInputPrompt.tsx)
- [后台输出不等于活性](https://github.com/QwenLM/qwen-code/blob/a765229c0affd0642973412a3480b992935e2eff/packages/core/src/tools/shell.ts#L125-L135)

## Claude Code：只记录官方公开契约

来源：[Tools reference](https://code.claude.com/docs/en/tools-reference)、
[Interactive mode](https://code.claude.com/docs/en/interactive-mode)，本轮 2026-09-28 读取，D 级。
不逆向二进制、不引用泄漏 prompt、不用第三方实现冒充内部源码。

Bash 每次命令是独立进程；环境变量不跨命令保留。
文档对主会话 cwd 有条件保留的描述，子 agent 不继承同样的 cwd carry-over。
因此“独立进程”也不等于宿主绝不帮忙持久化 cwd。

run_in_background 启动后台任务，返回 task ID；输出写文件，可以后续读取。
Ctrl+B 允许用户把当前 Bash 放到后台。
超时可转后台而不是杀死，sleep 例外；关闭后台环境变量会改变这条规则。

任务所有者决定生命周期：

- 主会话或后台 subagent 启动的后台命令可在 final response 后继续。
- 前台 subagent 启动的命令在该 subagent final response 时停止。
- headless -p 的后台命令在最终结果后很快结束。
- Claude Code 退出会清理后台任务；后台运行整个会话又是不同情形。

文档还给出输出文件体积、退出清理和内存压力回收条件。
这些都是公开行为描述，不证明内部使用 PTY、可写 stdin、原始键盘接管或 session 恢复。
“Interactive mode”标题主要指用户与 Claude 的交互；不是 Bash 工具的输入 schema。

纳入：验证 owner 生命周期与输出落盘的用户契约。
不深挖：无公开源码链，保持 D/U，不能和 S 级源码样本混为同一证据强度。

## Cursor 与 VS Code / Copilot：终端体验不替代工具协议

### Cursor

[官方 Terminal 页面](https://cursor.com/docs/agent/terminal)说明直接在终端执行命令，
Run Mode 控制执行、询问与 sandbox；复杂 shell theme 可能影响 inline output。
页面建议用 CURSOR_AGENT 切换到简单 prompt。

这是 D 级可见行为与兼容性证据。
本轮页面没有足够细节确认模型 stdin、PTY 分配、稳定会话 ID、yield 默认或独占接管。
不借产品演示或旧经验补齐；不扩展调查 Cursor 的私有实现。

### VS Code / Copilot

[官方 agent tools](https://code.visualstudio.com/docs/copilot/agents/agent-tools)
描述集成终端、Show Output / Show Terminal、Continue in Background。
用户可以让长命令继续，agent 可稍后读输出；也可以直接后台启动。
模型 timeout 可控制停止等待并返回已有输出，另有配置决定是否 enforce。
未被用户打开的后台终端可在命令完成后清理；聊天中的输出仍保留。

[官方 tools reference](https://code.visualstudio.com/docs/agents/reference/tools-reference)
列出 execute/runInTerminal 与 execute/getTerminalOutput。
文档强调不同 harness、extensions、session capabilities 影响工具可用性。
client-side tools 默认可用与审批不是一回事。

本页不将这些字段外推到所有 Copilot CLI、云 agent 或其他 IDE。
模型续写输入、终端所有权互斥、秘密记录和断线后行为保留 U。
纳入：IDE 后台展示/清理契约；不作为新的底层实现投票。

## 主样本为何仍然必要，广筛改变了什么

七主样本提供连续的源码深入位置，而本页增加边界条件，不按品牌数统计“多数”。

| 主样本组合 | 应由主报告回答的问题 | 本页补充/反例 |
|---|---|---|
| Codex、OpenCode | 稳定执行句柄、续写/取消、权限和后端边界 | OpenHands：有输入 schema 不等于默认池保留状态 |
| Gemini CLI、Aider | TUI/人类交互与命令观察责任 | Cline：IDE ownership；Qwen：同源的人类 focus 输入 |
| pi-mono | 最小核心、扩展与复杂性边界 | mini-swe 与 Goose：限制输入仍可形成完整执行体验 |
| DeepSeek Harness、Grok Build | 补充实现是否带来新的协议或宿主分层 | Kimi：宿主 PTY 与模型 Bash 分离；不能只看依赖 |
| 七者共同核查 | yield、timeout、退出、输出和默认注册是否可组合 | Roo 双期限；Claude owner 生命周期；IDE 后台清理 |

这里列的是主报告分工和覆盖轴，不替其他代理预先宣布具体能力已经证实。
若主报告缺少模型续写默认可达链或人类接管恢复链，应明确补查，不以此表作保证。

### 建议保留的深挖优先级

1. **优先补 OpenHands 默认池与单会话差异**：同一 schema 在后端切换后能否继续，是直接影响 S004 正确性的风险。
2. **保留 Cline ownership 案例**：失去完成标记时不要伪装完成，更不要默认销毁人类工作。
3. **保留 Kimi 双平面反例**：判断能力时逐条走模型工具到宿主实现，不从 PTY 依赖倒推。
4. **摘录 Roo 双期限**：等待期限和执行预算分离；不要因 yield 丢掉执行预算。
5. **Qwen 做差异核对即可**：分叉后独立演进，但共同祖先代码不能增加独立共识票数。
6. **其余留作对照与公开契约**：没有发现足以抵消全面深挖成本的新模型输入协议。

## 尚未验证，不转写成课程决策

- 所有外部产品本轮均未安装运行；没有跨 Linux/macOS/Windows 实测结论。
- OpenHands 的默认池输入冲突是源码推导，仍需受控运行与维护者语义核对。
- Kimi 独立 terminal 服务能否由用户接管“同一个 Bash 子进程”，没有闭合证据。
- Cline/Roo/Goose 的所有发行入口和用户旧配置未穷尽，表内默认不能扩大适用范围。
- mini-swe 的插件环境、Qwen 的其他工具、各产品 MCP 扩展未穷尽。
- PTY echo、密码、ANSI、剪贴板、落盘日志、审计和 telemetry 的秘密传播未全面审计。
- 人机并发输入的排他所有权、断线重连、跨宿主重启恢复均未全链路确认。
- 官方在线文档不是版本快照；后续引用应保留本页观测日，不当成永久契约。
- 本页没有修改 S003 历史调研，也没有把任何候选方案确认为 S004 实现决策。

