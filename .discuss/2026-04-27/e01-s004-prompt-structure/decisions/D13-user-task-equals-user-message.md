# D13：S004 阶段 UserTask = UserMessage

## 决策

S004 阶段将 UserTask 与 UserMessage 合并理解：

```text
UserTask = 当前这条 user message
```

不做独立 task extraction，也不从用户原文里提前抽象出结构化 task object。

## 进一步约定

虽然 UserTask 与 UserMessage 在 S004 合并，但 UserMessage 的内容可以被构造成一个包含多个 section 的任务消息。

概念上：

```text
UserMessage
  ├─ UserTaskContext
  │   ├─ Runtime Context
  │   └─ 未来其它 task context
  └─ UserTask
      └─ 用户原始输入
```

其中用户原始输入必须保真，不应被 builder 改写或覆盖。

## 为什么不做 task extraction

S004 的目标是固定 Prompt 结构，而不是实现完整任务理解层。

过早引入 task extraction 会带来新的问题：

- task schema 如何定义？
- 多轮追加消息如何合并？
- 用户原文和抽象 task 冲突时谁优先？
- plan/debug/review mode 是否需要不同 extraction？

这些问题应该在后续 Task/Mode story 中处理。

## 对后续扩展的预留

未来可以在 UserTaskContext 内新增：

- `taskMode`
- `constraints`
- `acceptanceCriteria`
- `conversationSummary`
- `focusedFiles`

但 S004 只保留结构位置，不实现这些字段。
