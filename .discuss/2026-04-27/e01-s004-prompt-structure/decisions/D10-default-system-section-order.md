# D10：Default System Section 顺序

## 决策

S004 的 Default System 固定为 5 个静态 section：

```text
Role / Identity
→ Scope / Capability
→ Tool Policy
→ Workflow
→ Output Contract
```

Runtime Context 不进入 Default System，放到 UserTaskContext 继续设计。

## Workflow 是什么

Workflow 不是某个具体 mode，也不是一次性 plan；它描述 agent 面对普通任务时的默认推进方式。

对 zero2agent 当前只读 Agent 来说，Workflow 的作用是把「如何使用工具完成任务」从工具说明里抽离出来：

```text
先定位可能相关的文件或目录；
再读取必要内容；
必要时使用搜索缩小范围；
最后用中文给出简洁回答。
```

它回答的是：当用户没有指定工作方式时，agent 应该如何自然地推进。

## 为什么保留 Workflow

竞品里基本都有类似段落，只是命名不同：

| 项目 | 类似 section |
|------|--------------|
| Codex | How you work / Planning / Editing constraints |
| Gemini CLI | renderPlanningWorkflow() / renderPrimaryWorkflows() |
| OpenCode | Doing tasks / Task Management |
| Aider | main_system 与 system_reminder 中的编辑流程约束 |
| Pi Mono | Guidelines 中的默认执行策略 |

这说明 Workflow 是稳定 System Prompt 的常见组成部分。

## 边界

- Workflow 只写默认流程，不写 plan/debug/review 等 mode-specific 规则。
- mode-specific 规则属于 D09 的 System Prompt Fragment/Profile 预留位。
- 工具参数和完整工具说明仍归 tool schema，不写进 Workflow。
