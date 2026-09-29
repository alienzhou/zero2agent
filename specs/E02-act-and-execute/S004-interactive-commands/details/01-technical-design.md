# E02-S004：人工交互终端技术设计

> 实施中；以下为实现约束，运行证据待回填。

[Story](../README.md) | [总览](./00-overview.md)

## 整体结构

人的终端 ↔ 宿主 raw 按键/输出桥 ↔ PTY master/slave ↔ bash。人工窗口期间 Agent 不消费按键，模型等待工具完成。

| 层 | 职责 |
|---|---|
| [terminal.ts](../../../../packages/core/src/tools/terminal.ts) | 校验 command/workdir，按 interactive 分流 |
| [terminal-runtime.ts](../../../../packages/core/src/tools/terminal-runtime.ts) | runInteractive 请求与摘要结果 |
| [setup-terminal-runtime.ts](../../../../packages/tui/src/setup-terminal-runtime.ts) | 绑定人工确认与终端接管 |
| [cli.ts](../../../../packages/tui/src/cli.ts) | --terminal 与 /terminal 入口 |

interactive 缺省或 false 走旧路径；true 不创建 OutputSink，不走普通后台跳过流程。宿主缺失、平台不支持、TTY 不满足时明确失败，不能静默降级成 pipe 或继承输入执行。

## 人工确认先于创建 PTY

显示 command、解析后的 workdir 与 `Allow human terminal? [y/N]`。只接受 y/yes 加 Enter；空回车、EOF、其他输入拒绝。确认内容不能作为命令输入转发，模型参数不能绕过确认。

stdin/stdout 都必须为 TTY；CLI 独立入口在 LLM 配置检查前分流。TTY 只是连接条件，不是安全审查。启动确认也不是会话内每次人工操作的审批。

批准后用 `@lydell/node-pty@1.2.0-beta.15`，以 `/bin/bash --noprofile --norc -c command` 启动，传入工作目录和终端尺寸。空 CLI/REPL 命令映射到 bash，不按命令名检测交互需求。

## 输入所有权与恢复

接管前保存 stdin 的 raw mode、paused 状态及原 readline/输入监听。临时隔离旧监听，不能仅调用 readline.pause() 就假定 Agent 不再收到按键。确认与活动阶段之间也须明确交接。

活动阶段设置 raw mode，将原始字节送 PTY；旧 data/keypress 监听不能同时消费。stdout resize 更新 PTY columns/rows。提示必须含 `Human terminal active` 和 `Ctrl-]`。

| 输入或事件 | 行为 |
|---|---|
| 普通键、Enter、方向键 | 原样转 PTY，不成为 Agent 消息 |
| Ctrl-C/Ctrl-D | 控制字节交给程序 |
| Ctrl-] | 宿主拦截，中止整个会话 |
| 程序自然退出 | 清理后归还 Agent |
| spawn 失败、取消、输入断开 | 结束受管执行，走统一恢复路径 |

恢复应幂等：移除本次输入/resize/退出监听，清理 PTY 与受管子进程，恢复原 raw mode、监听和 paused 状态，最后结算结果。重复退出事件不能重复注册监听或回传结果。自然结束后也不能留下占用终端的普通后代。

## 控制字符与清理边界

Ctrl-C 在 ISIG 等条件下可能转为 SIGINT，raw 程序也可能自行处理。Ctrl-D 通常在 canonical 空行触发读取 EOF，不是通用关闭 PTY。二者不保证结束整个会话。

Ctrl-] 是宿主中止，清理普通子孙和进程组；不提供 detach/重连。不承诺复杂 setsid/守护化逃逸、PID 竞争或宿主 SIGKILL 后的全部清理。测试必须检查进程存活，不能仅检查 promise 返回。

## 输出与结果契约

PTY 正文直接写宿主 stdout，不写 OutputSink、临时输出文件、对话历史或模型工具正文，不提供后续回读。PTY 合流输出不能标成独立 stderr。

结束后仅返回 status、可用的 exitCode/signal 等元信息。拒绝、失败、取消、成功不可混同；退出码不证明登录或业务操作成功。模型需要内容时由人主动描述，不能假装已读终端。

此约束只限 Zero2Agent 交互采集路径。command 参数可能已记录，shell history、程序写文件、录屏和环境继承不受控制。测试用虚构标记，不用真实凭据。直写并不等于自动脱敏或无限输出内存有界，背压另行验证。

## 设计决策记录

### ADR-01：人工接管，不新增模型 stdin 工具

用户纠偏为“让人能进行 bash 命令交互”。因此无需模型 yield/session/poll/write 协议，Agent 等待人操作完成。

### ADR-02：参考成熟实现的职责，不复制全部行为

| 已有本地调研 | 借鉴 | 不照搬 |
|---|---|---|
| [Aider](../../../../researches/interactive-commands/aider.md) | child.interact 人工 PTY 窗口 | 默认 Yes/EOF 可同意、捕获输出 |
| [pi-mono](../../../../researches/interactive-commands/pi-mono.md) | 停止/恢复 TUI，只回摘要 | 同步继承 stdio、示例恢复保障不足 |
| [Gemini CLI](../../../../researches/interactive-commands/gemini-cli.md) | 人按键到 PTY、resize 与生命周期 | 后台面板、xterm 缓存、正文入模 |

来源为已有固定源码调研，没有联网刷新或产品 E2E。依赖版本、入口名称、保留键、隐私边界均为本轮实现选择，不声称用户逐项审定。

## 当前不做的事情

Windows/ConPTY、headless 回退、模型输入、交互后台化、自动检测、多终端并行和重连。理由见 [Backlog](./04-backlog.md)。
