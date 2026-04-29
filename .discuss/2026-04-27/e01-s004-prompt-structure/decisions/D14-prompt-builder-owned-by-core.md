# D14：Prompt Builder 归属 core

## 决策

S004 将 System Prompt 的 build-up 归属到 `packages/core`。

TUI 不再拥有 System Prompt 文案，只负责把用户输入作为 UserTask 传给 core。

## 目标结构

```text
packages/core
  └─ buildSystemPrompt()
  └─ 未来 buildUserTaskMessage()

packages/tui
  └─ 收集用户输入
  └─ 传入 UserTask
```

## 原因

System Prompt 描述的是 agent 行为，不是 UI 行为。

如果 prompt 文案放在 TUI：

- 未来接入非 TUI host 时会重复 prompt。
- core 内部工具、消息装配和 prompt 规则分散在不同包。
- 课程讲解时难以说明「agent runtime」的边界。

放在 core 更符合职责：

| 包 | 职责 |
|----|------|
| `packages/core` | agent 行为、工具、prompt/message builder |
| `packages/tui` | 命令行交互、用户输入输出 |

## Runtime Context 的来源

Runtime Context 可以分成两类：

| 来源 | 例子 | 归属 |
|------|------|------|
| core 可自行获取 | date、process cwd、平台信息 | core 默认收集 |
| host 需要传入 | workspace root、外部 sandbox、用户指定路径 | TUI 或未来 host 传入 |

因此后续可设计为：

```ts
type UserTaskContextInput = {
  cwd?: string;
  date?: string;
  platform?: string;
};
```

core 负责补齐默认值，host 负责传入自己才知道的上下文。
