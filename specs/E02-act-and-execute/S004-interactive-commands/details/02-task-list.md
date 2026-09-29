# E02-S004：任务清单

> 实现与自动验证已完成，待人工验收与合入。未推送、未打发布 Tag。

[Story](../README.md) | [总览](./00-overview.md)

## Step 1：纠偏与设计

- [x] 记录 21:55 纠偏与直接实施授权。
- [x] 替换旧模型续写导读，保留其他历史候选笔记。
- [x] 创建 Story 与固定五篇 details，区分意图和实现选择。

## Step 2：core 与宿主协议

- [x] 核对 interactive 分流、workdir 校验、缺失宿主错误及摘要契约。
- [x] 验证交互分支不创建 OutputSink，默认/false 保持 S003 行为。
- [x] 新增 19 项 core 交互契约测试与 2 项真实非交互分流回归。

## Step 3：TUI 接管

- [x] 接入精确 PTY 依赖、真实 TTY 检查与默认 No 确认。
- [x] 实现 raw 输入、stdout 输出、resize、Ctrl-] 中止。
- [x] 隔离旧 readline 监听与收尾期间输入，恢复完整 stty 属性。
- [x] 清理原进程组与已观察后代；处理扫描失败、外部信号及真实终端断连。
- [x] 接入 --terminal 和 /terminal，独立 CLI 不检查 LLM key。

## Step 4：验证与交付

- [x] 按[验收清单](./03-verification-checklist.md)运行单测及 28 项人工终端契约场景。
- [x] 回归普通 terminal 的取消、跳过和输出策略。
- [x] 回填 runtime 入口、最终结果字段和验证证据。
- [x] 补齐 Epic/上一篇导航、根 README、CHANGELOG、复盘和协作实录。

## 后续人工发布流程

- [ ] 用户在常用终端与目标命令中验收、人工代码审查。
- [ ] 获得授权后推送、合入并按项目规范打 Tag。

这些是发布前动作，不表示自动测试已替代人工批准。Windows、模型续写和慢终端压力范围见 [Backlog](./04-backlog.md)。
