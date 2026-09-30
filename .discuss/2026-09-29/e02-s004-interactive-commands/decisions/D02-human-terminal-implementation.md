# D02：按人工接管终端推进实现

> 2026-09-29 21:55 用户授权｜实现与自动验证完成，待人工验收与合入。

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

## 实施与验证结果

实现分支为 `feat/e02-s004-human-terminal`。core 宿主协议始于 `a14fd1c`，TUI 主实现始于 `6b35bde`；收尾输入隔离和组清理修正见 `d09a87e`，真实断连处理见 `716563c`，信号与退出摘要见 `11898d9`、`2c7bd96`。

9 月 29 日初次交付：构建通过；core 198、E2E 46、cdp-debug 1 项通过，25 项 E2E 跳过，其中 28 项人工终端场景。9 月 30 日复核补修 drain 计时测试与活终端 SIGHUP 恢复；固定候选 `7438fa8` 连续两轮全量回归每轮 248 通过、25 跳过，人工终端增至 30 项。精确覆盖和缺口见[验收清单](../../../../specs/E02-act-and-execute/S004-interactive-commands/details/03-verification-checklist.md)。

已补[复盘](../../../../retros/E02-S004-human-terminal.md)与[协作记录](../../../../.vibecoding/2026-09-29/e02-s004-human-terminal/dialogue.md)。未运行付费模型或外部产品；未推送、合入或打 Tag，不把自动验证写成人工批准。
