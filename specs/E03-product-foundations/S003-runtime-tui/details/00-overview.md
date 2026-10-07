# E03-S003：运行状态与 TUI · 总览

[课程](../README.md) | [Epic 3](../../README.md)

## 迭代目标

让使用者从界面判断 Agent 当前在做什么，并用明确的控制操作改变执行。读者需要理解：模型文本、执行状态、权限询问和人工终端是不同来源，不能靠解析混在 stdout 中的文字恢复状态。

## 核心功能

| 能力 | 契约 |
|---|---|
| 运行事件 | turnId + seq，工具再带 toolCallId；同名工具有独立状态 |
| Turn 取消 | 中断请求、审批、压缩与协作工具；停止后续调度，保留已发生的证据 |
| 终端显示 | 阶段、耗时、流式文字、工具状态和审批全文 |
| 输入所有权 | 输入编辑、审批、运行取消、人工 PTY 按阶段切换 |
| 恢复 | resize、异常、信号、正常退出后恢复终端；保留 plain 路径 |

## 技术选型

使用 Node TTY 与现有 PTY 依赖，界面状态归 reducer 管理，绘制只消费视图数据。已有 Core 不依赖 TUI。选型比较见[调研](../../../../researches/runtime-tui/README.md)，控制契约见[决策](../../../../.discuss/2026-10-07/e03-s003-runtime-tui/decisions/D01-events-and-control.md)。

## 文档导航

| 编号 | 文档 | 内容 |
|---|---|---|
| 00 | [总览](./00-overview.md) | 目标与分层 |
| 01 | [技术设计](./01-technical-design.md) | 事件、取消与输入交接 |
| 02 | [任务清单](./02-task-list.md) | 全部交付项 |
| 03 | [验收](./03-verification-checklist.md) | 证据与边界 |
| 04 | [Backlog](./04-backlog.md) | 后续能力 |

关联材料：[需求讨论](../../../../.discuss/2026-10-07/e03-s003-runtime-tui/outline.md)、[跟练](../follow-along.md)。
