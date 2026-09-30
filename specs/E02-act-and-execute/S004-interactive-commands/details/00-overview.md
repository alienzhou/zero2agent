# E02-S004：人工交互终端总览

> 实现、工程复验、两项用户试用与源码专项复核完成，脱敏发布分支已推送，尚未合入 main 或打 Tag。技术细节是本轮实现选择，不把试用正常扩展为逐项设计批准。

[Story](../README.md) | [Epic 2](../../README.md)

## 迭代目标

让人通过真实终端操作 bash 命令，结束后回到 Agent。学习重点是终端输入所有权、PTY 双端连接与宿主恢复，而非模型跨调用续写。

## 核心功能

三个入口共享接管：模型 terminal 的 interactive 参数、CLI --terminal、REPL /terminal。真实 TTY 和默认 No 确认是创建 PTY 的前提。交互期间输入归 PTY、正文只显示给人；工具结束后返回摘要，普通命令保持 S003 行为。

## 设计原则

分开“谁发起”和“谁操作”：模型可以请求，人批准并操作。交互正文不建立日志或模型回传旁路；控制字节不等于宿主取消。

## 技术选型

| 类别 | 本轮选择 | 理由 |
|---|---|---|
| PTY | `@lydell/node-pty` 精确 `1.2.0-beta.15` | 异步读写、退出与 resize |
| shell | POSIX `/bin/bash --noprofile --norc -c command` | 明确 shell 语义，不猜测命令是否交互 |
| 输出 | 原始数据直写 stdout | 复用真实终端，不缓存正文 |
| 分层 | core 的 runInteractive 宿主钩子 | core 管契约，TUI 管终端设备 |

外层 bash 的 --noprofile/--norc 不构成环境隔离，也不约束嵌套 shell 的配置加载。

## 文档导航

| 编号 | 文档 | 说明 |
|---|---|---|
| 00 | [总览](./00-overview.md) | 本文 |
| 01 | [技术设计](./01-technical-design.md) | 接管与恢复 |
| 02 | [任务清单](./02-task-list.md) | 开发进度 |
| 03 | [验收检查清单](./03-verification-checklist.md) | 功能与边界 |
| 04 | [Backlog](./04-backlog.md) | 延后事项 |

## 关联文档

- [纠偏与实施决策](../../../../.discuss/2026-09-29/e02-s004-interactive-commands/decisions/D02-human-terminal-implementation.md)
- [调研总览](../../../../researches/interactive-commands/README.md)
- [迭代日志](../../../../CHANGELOG.md)与[实现复盘](../../../../retros/E02-S004-human-terminal.md)。
