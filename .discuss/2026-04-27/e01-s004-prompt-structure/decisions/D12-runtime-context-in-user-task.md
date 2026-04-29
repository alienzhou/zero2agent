# D12：Runtime Context 放入 UserTaskContext

## 决策

S004 将 Runtime Context 放入 UserTaskContext，而不是放入 Default System。

Runtime Context 包括这类随运行环境和单次任务变化的信息：

- `cwd`
- 当前日期
- platform / OS
- git 状态
- repo root
- 未来可能的 sandbox / permission / workspace 信息

S004 实现不必一次注入所有字段，但结构上先确认它属于 UserTaskContext。

## 原因

Default System 应尽量稳定，承载长期身份、能力边界和全局行为约束。

Runtime Context 是动态事实，和本轮任务更接近：

- 用户问的问题通常发生在某个 cwd / repo / 时间点。
- 动态内容放进 Default System 会污染静态 section，后续也不利于 prompt cache。
- 放在 UserTaskContext 里，可以让 System 保持稳定，同时让任务上下文更完整。

## 与竞品的关系

竞品做法不完全一致：

| 项目 | Runtime Context 位置 |
|------|----------------------|
| Pi Mono | 放在 prompt 末尾 |
| OpenCode | 独立 `<env>` system 段 |
| Codex | 运行时 developer/context instructions |
| Gemini CLI | sandbox/git 等后置 section |

zero2agent 选择 UserTaskContext，是因为当前课程阶段更重视静态 System 与动态任务上下文的边界。

## 仍需下一步设计

Runtime Context 的具体文本格式仍需单独确认：

- Markdown section
- XML-like tags
- JSON/YAML block

当前推荐方向见 `notes/user-task-context-format.md`。
