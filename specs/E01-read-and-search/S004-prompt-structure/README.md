# E01-S004：把 Prompt 从一段字符串整理成可演进的消息结构

> 这是 Epic 1 的第四个 Story。前三步让 Agent 具备了读文件、搜内容、找文件的能力；这一篇回头整理驱动这些能力的 Prompt / Message 结构。

[Epic 1：能看 / 能查](../README.md) | [首页](../../../README.md) | [讨论记录](../../../.discuss/2026-04-27/e01-s004-prompt-structure/outline.md)

---

## 工具能跑了，但 Prompt 还混在一起

到 S003 为止，Agent Harness 已经具备四个只读工具：

| 能力 | 工具 |
|------|------|
| 读取文件 | `read_file` |
| 查看目录 | `list_directory` |
| 搜索内容 | `grep_search` |
| 搜索文件路径 | `find_files` |

但当前 prompt 仍然是一段写在 `packages/tui/src/cli.ts` 里的内联 `SYSTEM_PROMPT`。它把角色、工具列表、工具组合提示和回答语言全部写在一起。

这在工具少时能工作；继续往后做 AGENTS.md、skills、plan/debug/review 模式、上下文压缩、写文件工具时，就会变成一个问题：每新增一种信息源，都可能被顺手塞进 system prompt，最后 prompt 变成不可维护的大杂烩。

---

## 这个 Story 要做什么

### 问题

S004 要解决的不是“把 system prompt 写漂亮一点”，而是先建立一套最小的 **Prompt / Message Assembly 规则**：

1. 哪些信息属于长期稳定的 Default System？
2. 哪些信息属于用户任务和运行时上下文？
3. 工具描述到底写在 prompt 里，还是交给 tool schema？
4. TUI 和 core 谁拥有 prompt builder？
5. mode、skills、AGENTS.md、prompt cache 这些未来能力应该预留在哪里？

### 目标

希望当前 Story 完成后：

- Default System 被拆成稳定的 5 个 section：Role / Scope / Tool Policy / Workflow / Output Contract
- System Prompt builder 归属 `packages/core`，TUI 不再持有 prompt 文案
- 工具完整说明只保留在 tool schema，System 只写工具组合策略
- Runtime Context 放入 UserTaskContext，并用 XML-like tags 与用户原文分隔
- mode、skills、Instruction、tool response hint、prompt cache 都有明确扩展位，但不在本 Story 实现

### 边界

- **做**：S004 的配套 spec、Default System 设计、UserTaskContext 设计、实现任务拆解和验收检查项
- **不做**：AGENTS.md loader、skills 加载、多模型 prompt profile、plan/debug/review 具体模式、prompt cache、tool response hint envelope

---

## 核心设计

### 一张 Message Layer Map

S004 先把 prompt 设计范围扩成六层，但只落地其中一部分：

| 层级 | 放什么 | S004 处理方式 |
|------|--------|---------------|
| System | 长期稳定的身份、边界、默认流程、输出契约 | 实现 Default System builder |
| Instruction | AGENTS.md、项目指令、用户偏好、skills | 只预留位置和优先级 |
| User Task | 用户原文 + 当前任务上下文 | 设计 UserTaskContext 格式 |
| Task Mode | plan/debug/review/compact/promotion | 只预留 mode fragment/profile |
| Tool | tool schema、tool policy、tool response | schema 写描述，system 写策略 |
| Response | 最终回答语言、简洁度、引用规则 | 放在 Default System 的 Output section |

### Default System 的 5 段顺序

```text
Role / Identity
→ Scope / Capability
→ Tool Policy
→ Workflow
→ Output Contract
```

Runtime Context 不进入 Default System。它随 cwd、date、repo、平台变化，更适合放到 UserTaskContext 中。

### UserTaskContext 的目标格式

```xml
<user_task_context>
  <runtime_context>
    <cwd>{cwd}</cwd>
    <date>{date}</date>
  </runtime_context>
</user_task_context>

<user_task>
{rawUserMessage}
</user_task>
```

这样做的重点不是 XML 本身，而是给“系统注入的动态上下文”和“用户原始输入”划清边界。

---

## 推荐阅读顺序

1. 先看 [details/00-overview](./details/00-overview.md)
  - 建立 S004 的范围和消息分层地图
2. 再看 [details/01-technical-design](./details/01-technical-design.md)
  - 重点看 Default System、UserTaskContext、Prompt builder 归属和业务操作流程
3. 然后看 [details/02-task-list](./details/02-task-list.md)
  - 按步骤进入实现阶段
4. 最后看 [details/03-verification-checklist](./details/03-verification-checklist.md) 和 [details/04-backlog](./details/04-backlog.md)
  - 明确验收门槛和本 Story 不做的事情

实现时重点留意三件事：

- `packages/core` 是否成为 prompt/message builder 的归属点
- `packages/tui` 是否只负责收集用户输入和传递必要上下文
- Default System 是否保持静态，动态 Runtime Context 是否进入 UserTaskContext

---

## 做完后的效果

完成这一步后，Agent 的行为不一定立刻变“更聪明”，但结构会从：

```text
TUI 内联 SYSTEM_PROMPT 字符串
```

演进为：

```text
core 拥有 Default System builder
+ UserTaskContext 承载动态上下文
+ tool schema 成为工具描述唯一事实来源
+ mode / instruction / skills / cache 有明确预留位置
```

这一步的价值是给后续 Agent Runtime 演进打基础：未来加写文件、执行命令、AGENTS.md、skills 或 plan/debug/review 模式时，不需要继续往一段字符串里硬塞规则。

资料入口：

- [总览](./details/00-overview.md)
- [技术设计](./details/01-technical-design.md)
- [任务清单](./details/02-task-list.md)
- [验收检查清单](./details/03-verification-checklist.md)
- [Backlog](./details/04-backlog.md)

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [讨论记录](../../../.discuss/2026-04-27/e01-s004-prompt-structure/outline.md) | S004 Discuss 主线 |
| [竞品调研](../../../researches/prompt-structure/) | Codex / Gemini CLI / OpenCode / Pi / Aider / Claude Code |
| [Message Layer Map](../../../.discuss/2026-04-27/e01-s004-prompt-structure/notes/message-layer-map.md) | 六层消息地图 |
| [System Prompt 设计框架](../../../.discuss/2026-04-27/e01-s004-prompt-structure/notes/system-prompt-design-framework.md) | System section 和检查表 |
| [UserTaskContext 格式设计](../../../.discuss/2026-04-27/e01-s004-prompt-structure/notes/user-task-context-format.md) | Runtime Context 的目标格式 |

---

上一篇：[E01-S003：让 Agent Harness 能在项目里找到该看的文件](../S003-file-search/README.md)
