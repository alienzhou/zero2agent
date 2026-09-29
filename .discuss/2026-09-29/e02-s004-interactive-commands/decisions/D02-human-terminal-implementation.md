# D02：按人工接管终端推进实现

> 2026-09-29 21:55｜用户方向已明确，实施中，验证待回填。

[讨论大纲](../outline.md) | [核心原理](../notes/00-core-principles.md) | [Story](../../../../specs/E02-act-and-execute/S004-interactive-commands/README.md)

## 用户明确了什么

用户纠正此前理解：核心是让人能进行 bash 命令交互，并要求参考成熟实现提出方案和技术实现、直接推进实施。原理介绍仍放在前面。

该授权允许围绕人工接管落地，无需等待旧五问逐项讨论完；不等于逐项批准依赖版本、控制键和异常策略。

## 本轮实现选择

- POSIX 真实 TTY；PTY 依赖精确 `@lydell/node-pty@1.2.0-beta.15`；外层 `/bin/bash --noprofile --norc -c command`。
- 模型 terminal 的 interactive: true 调用宿主 runInteractive；CLI --terminal [command]、REPL /terminal [command] 共用能力。空命令进 bash，独立 CLI 不要求 LLM key。
- 默认 No 确认，仅 y/yes 加 Enter 启动；空、EOF、其他拒绝，批准后创建 PTY。
- raw 输入只交 PTY、resize 同步；Ctrl-C/Ctrl-D 留给程序，Ctrl-] 结束整个会话。恢复原 readline 监听、raw mode、paused 状态。
- 模型等结束，仅收 status/exitCode/signal 等摘要，不新增模型 stdin 工具。正文不进 OutputSink、Zero2Agent 输出日志或模型。
- 清理普通子孙与进程组，不承诺复杂逃逸或宿主 SIGKILL。外部 shell history、子程序日志、录屏和 command 已在上下文的风险不因“不采集正文”消失。

## 参考与取舍

[Aider](../../../../researches/interactive-commands/aider.md)提供人工 PTY 参照；[pi-mono](../../../../researches/interactive-commands/pi-mono.md)提供停止/恢复 TUI 与摘要参照；[Gemini CLI](../../../../researches/interactive-commands/gemini-cli.md)提供人按键到 PTY 的路由参照。使用已有固定源码报告，不联网刷新，也不声称已运行产品。

不采用 Aider 默认 Yes/EOF 同意，不捕获交互正文，不引入 Gemini 的后台面板、模型读日志体系。

## 对旧讨论的影响

旧“程序还在运行，Agent 也能继续决策”导读已替换，旧稿查 Git。D01 的组织方式属于历史确认，旧 Q1–Q5 范围及 01-problem-value 候选不再是实施前提；保留历史，不删除其他候选笔记。

## 待回填

实现提交、真实 PTY/REPL 验收、默认非交互回归、终端恢复与进程清理证据。验证未完成前保持实施中。
