# E03-S001：总览

[Story](../README.md) | [Epic 3](../../README.md)

## 迭代目标

把历史所有权从单轮局部变量提升到进程内会话，理解 Session / Turn / Loop 的边界。第二轮能看到第一轮的用户消息、完整 assistant 内容及工具结果。

## 核心功能

- Agent 实例连续运行，共享一个 Session；独立实例与静态调用互不串话。
- `/new` 或 reset 清空历史，保留配置及工作目录。
- 同一会话并发与运行中重置拒绝；读取历史得到深拷贝。
- 网络错误、截断与迭代上限不会留下孤立工具调用。

## 文档导航

| 编号 | 文档 | 用途 |
|---|---|---|
| 00 | [总览](./00-overview.md) | 目标与范围 |
| 01 | [技术设计](./01-technical-design.md) | 所有权与失败契约 |
| 02 | [任务清单](./02-task-list.md) | 实施进度 |
| 03 | [验收检查清单](./03-verification-checklist.md) | 验证证据 |
| 04 | [Backlog](./04-backlog.md) | 推迟与拒绝的方案 |

## 关联文档

- [讨论](../../../../.discuss/2026-10-01/e03-s001-multi-turn/outline.md)
- [调研](../../../../researches/multi-turn/README.md)
