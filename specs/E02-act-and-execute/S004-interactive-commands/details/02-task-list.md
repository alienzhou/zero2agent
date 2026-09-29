# E02-S004：任务清单

> Story 状态：实施中。文档形成不代表代码或验收完成。

[Story](../README.md) | [总览](./00-overview.md)

## Step 1：纠偏与设计

- [x] 记录 21:55 纠偏与直接实施授权。
- [x] 替换旧模型续写导读，保留其他历史候选笔记。
- [x] 创建 Story 与固定五篇 details，区分意图和实现选择。

## Step 2：core 与宿主协议

- [ ] 核对 interactive 分流、workdir 校验、缺失宿主错误及摘要契约。
- [ ] 验证交互分支不创建 OutputSink，默认/false 保持 S003 行为。
- [ ] 回填新增 core 分支测试结果。

## Step 3：TUI 接管

- [ ] 接入精确 PTY 依赖、真实 TTY 检查与默认 No 确认。
- [ ] 实现 raw 输入、stdout 输出、resize、Ctrl-] 中止。
- [ ] 隔离旧 readline 监听，覆盖各出口恢复与进程清理。
- [ ] 接入 --terminal 和 /terminal，独立 CLI 不检查 LLM key。

## Step 4：验证与交付

- [ ] 按[验收清单](./03-verification-checklist.md)运行单测及真实 PTY/REPL 场景。
- [ ] 回归普通 terminal 的取消、跳过和输出策略。
- [ ] 回填 runtime 入口、最终结果字段和验证证据。
- [ ] 集成负责人补齐 Epic/上一篇导航、根 README、CHANGELOG、复盘和协作实录。

未勾选实现项表示尚未由本文核验，不断言其他协作者尚未编写代码。
