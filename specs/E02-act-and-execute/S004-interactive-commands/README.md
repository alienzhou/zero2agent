# E02-S004：让人接管交互式终端

> 实现、工程复验、Node/less 用户试用与源码专项复核已完成。脱敏分支已通过 PR #13 合入 main（060c644），尚未打课程 Tag。让人操作 bash 命令，结束后回到 Agent；证据与边界见验收清单。

[Epic 2：行动与执行](../README.md) | [首页](../../../README.md) | [迭代日志](../../../CHANGELOG.md)

## 交互的关键是把终端交给人

命令提示输入选项、进入解释器或打开全屏界面时，需要一条持续连接人的键盘与程序的通道。本章的操作者是人：Agent 暂停接收输入，宿主转发按键与画面，程序结束后恢复 Agent。

```text
人的终端 ↔ 宿主 raw 按键／输出桥 ↔ PTY master／slave ↔ bash ↔ 命令

暂停 Agent 输入 → 人操作程序 → 清理交互现场 → 还原 Agent
```

PTY（伪终端）提供终端设备语义，包括终端模式、控制字符和窗口尺寸；提示符与方向键行编辑通常由 shell/readline 或应用实现。宿主持有 master，bash 及子程序连接 slave；真实终端负责显示画面，宿主不必重新实现终端模拟器。

这不同于模型读取中间输出后续写 stdin。本章工具调用等待人工交互结束，没有模型 `write_stdin` 或跨轮续写协议。

## 这个 Story 要做什么

S003 适合构建、测试等一次性命令，但不能把运行中的程序直接交给人操作。本章增加显式人工接管入口，保留默认非交互行为。

- **做**：POSIX 真实 TTY、人工确认、PTY 输入输出、resize、退出清理及 Agent 输入恢复。
- **不做**：Windows/ConPTY、headless 降级、模型代填、交互后台化或重连。

## 关键实现

### 显式选择，启动前确认

模型可请求 `terminal({ command, workdir, interactive: true })`，但不能代替人批准。CLI 提供 `--terminal [command]`，REPL 提供 `/terminal [command]`；省略命令时进入 bash。独立 CLI 入口无需 LLM key。

所有入口先检查 stdin/stdout 真实 TTY，再显示命令、工作目录和 `Allow human terminal? [y/N]`。只有 `y` 或 `yes` 加 Enter 才允许；空输入、EOF、其他回答拒绝。批准后才创建 PTY。

### 正文只显示给人

按键只进入 PTY，输出直接写宿主 stdout，不进普通命令的 OutputSink、输出日志或模型上下文。模型发起工具调用时只得到 status、exitCode、signal 等元信息；用户直接使用 `--terminal` 或 `/terminal` 时，回执只在本地显示，不自动加入模型对话。模型不能声称已看到人工操作内容。

这不等于“无痕终端”：command 参数可能本来就在模型上下文中；外部 shell history、子程序日志、终端滚屏与录屏不受 Zero2Agent 控制。不要在启动参数中填写真实凭据。

### 退出程序与退出接管不同

Ctrl-C/Ctrl-D 交给 PTY 程序，效果取决于终端模式。Ctrl-] 是宿主保留键，用于结束整个交互会话并清理原进程组与已跟踪后代，不是后台化。终端仍可用时恢复原设备状态与输入监听；物理断连时同步清理并退出，不再向消失的终端写提示。

接管覆盖确认、运行和收尾三个阶段。程序退出后的输入仍属于私人窗口，会被丢弃而不是落入 Agent 的输入历史。

先读[技术设计](./details/01-technical-design.md)，再看 [core terminal](../../../packages/core/src/tools/terminal.ts) 的分流、[人工终端](../../../packages/tui/src/human-terminal.ts)的接管与恢复，以及[进程清理](../../../packages/tui/src/human-terminal-process.ts)的所有权边界。

## 做完后的效果

在仓库根目录构建后，用真实终端执行下面的独立入口，无需 API key：

```sh
pnpm build
node packages/tui/dist/cli.js --terminal 'read -r -p "Name: " name; printf "Hello %s\n" "$name"'
```

输入 y 回车后应看到 `Human terminal active` 与 `Ctrl-]` 提示。名字由 bash 读取并显示，完成后返回入口。REPL 中 `/terminal` 应能打开 bash，再通过 exit 返回 Agent，后续文字不残留为 bash 输入。

直接进入 bash：`node packages/tui/dist/cli.js --terminal`。已有 Agent REPL 中用 `/terminal [command]`；Agent REPL 本身仍沿用模型配置要求。真实 PTY 测试覆盖对应路径，但不代替你在常用终端和实际程序里的人工验收。

需要固定版本和分步练习时，使用[跟练与人工验收](./follow-along.md)。它区分自动验证、工具驱动操作、已收到的用户试用反馈与后续发布流程；尚未提供公开发布版本。

想先体验功能，可以只试[Node REPL 与 less](./try-two-features.md)。关于其他产品是否同样交互，见[人工交互对标](../../../researches/interactive-commands/notes/human-ux-verification-2026-09-30.md)：交接有成熟先例，重复确认、输出分享和焦点切换各有取舍，并非行业统一界面。

## 实现与验收资料

- [总览](./details/00-overview.md)：范围与选型。
- [技术设计](./details/01-technical-design.md)：接管、恢复和输出边界。
- [任务清单](./details/02-task-list.md)：实施进度。
- [验收检查清单](./details/03-verification-checklist.md)：需要真实 PTY 证明的行为。
- [Backlog](./details/04-backlog.md)：范围外能力与延伸问题。

上一篇：[E02-S003：执行终端命令](../S003-terminal/README.md) | 下一篇：待规划
