# 本轮用户 Prompt

> 发起：2026-09-28；交付汇总跨至 2026-09-29。任务类型：调研和文档，不实现 S004。

## 用户原话

“你先进行一次全面完整的调研吧，一定详细全面，可以参考之前的格式。注意沉淀文档和开分支”

## 已有上下文

- E02-S003 terminal 已完成，S004 只聚焦交互式命令。
- PR #12 包含 D01–D05 讨论初稿，尚未合并。
- 用户提醒刷新原五个 Agent 的旧快照，并关注 DeepSeek Harness、Grok Build 等新实现。
- 原推进方式是问题框定、源码取证、分议题讨论、实验、决策、spec，而非先选方案再找证据。

## 本轮执行边界

- 独立本地分支：feat/e02-s004-interactive-research。
- 主报告按项目 repo-research 格式；不改业务代码、历史研究或原 PR。
- 固定 SHA，检查默认启用链，区分模型输入与人工终端。
- 不运行外部 Agent 产品、不使用真实凭据；本地只运行自编机制夹具和已有语言 REPL。
- 保留用户原有 .discuss/.snapshot.yaml 改动；只提交本轮明确文件，不 push、不新建 PR。

## 产物

[调研总览](../../../researches/interactive-commands/README.md)、[讨论入口](../../../.discuss/2026-09-28/e02-s004-interactive-research/outline.md)、[经验记录](./learnings.md)、[对话记录](./dialogue.md)。
