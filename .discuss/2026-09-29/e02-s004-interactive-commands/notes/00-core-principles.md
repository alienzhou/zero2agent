# 核心原理：把人的终端接到 bash，再还给 Agent

> 2026-09-29 21:55 用户纠偏后替换旧“模型持续决策”导读。旧稿请查 Git 历史；本页改讲人工终端，S004 实施中，验收未完成。

[讨论大纲](../outline.md) | [实施决策](../decisions/D02-human-terminal-implementation.md) | [Story](../../../../specs/E02-act-and-execute/S004-interactive-commands/README.md)

## 1. 人直接回答程序，不经过模型

bash 命令提示输入、运行解释器或展示全屏界面时，人需要直接操作。宿主停止 Agent 输入处理，把按键交给命令；结束后恢复 Agent。模型等待工具完成，不读取中间画面，也不代填输入。

```text
人的终端 ↔ 宿主 raw 按键／输出桥 ↔ PTY master／slave ↔ bash ↔ 程序

暂停 Agent 输入 → 人操作 → 清理会话 → 还原 Agent
```

## 2. PTY 提供终端语义

pipe 能传字节，但不提供完整终端设备语义。PTY slave 让 bash 及子程序连接到终端，master 供宿主读写；程序据此处理提示、回显、行编辑、控制字符和尺寸。

宿主将真实终端设为 raw mode，是为了接住按键字节后转给 PTY，不代表子程序也一直处于 raw mode。输出回到真实终端解释 ANSI，窗口变化时同步 resize。

## 3. 输入只能有一个消费者

同一按键不能既成为 Agent 消息又进入 bash。接管需隔离已有 readline 输入监听，保存 raw mode 与 paused 状态。退出、取消、异常都通过统一清理路径恢复现场。

核心不只是“打开 stdin”，还包括谁在读、何时移交、谁负责归还。界面看起来暂停，不代表输入已独占。

## 4. 区分程序控制与退出接管

Ctrl-C/Ctrl-D 交给 PTY 程序，可能被解释为信号、EOF 或普通控制字节。Ctrl-] 是本轮选择的宿主退出键：结束整个交互会话、清理普通子孙与进程组，回到 Agent，不保留后台交互现场。

## 5. 同意启动不等于分享正文

先要求真实 TTY，再问 `Allow human terminal? [y/N]`。仅 y/yes 加 Enter 允许；空、EOF、其他回答拒绝，批准后才创建 PTY。

正文只显示给人，不经 Zero2Agent 的 OutputSink、输出日志和模型回执；结束后只返回状态、退出码、信号摘要。command 可能本来就在上下文，外部 shell history、子程序日志和录屏也不受约束，不能宣称无痕或用真实凭据测试。

## 6. 成熟实现参考

- [Aider](../../../../researches/interactive-commands/aider.md)：child.interact 是人工 PTY 窗口，不是模型续写；不照搬其确认默认值或输出捕获。
- [pi-mono](../../../../researches/interactive-commands/pi-mono.md)：停止 TUI、借用终端、恢复后回摘要；它继承 stdio，并非创建 PTY。
- [Gemini CLI](../../../../researches/interactive-commands/gemini-cli.md)：用户按键到 PTY 有独立路由，不是模型 stdin 工具。

以上是已有源码调研，不是本轮产品实测。依赖、按键和清理策略是实现选择，边界见 spec。旧[问题价值笔记](./01-problem-value.md)保留供追溯，不再定义本轮范围。
