# E01-S004：固定 Prompt 结构

> 这是 Epic 1 的第四个 Story。目标是把当前 `cli.ts` 里的 21 行内联 SYSTEM_PROMPT 重构成可演化、可组合、可解释的结构化 prompt。

[Epic 1：能看 / 能查](../README.md) | [首页](../../../README.md) | [迭代日志](../../../CHANGELOG.md#e01-s004-prompt-structure-done)

---

## 从"能用"到"可演化"

前三个 Story 让 Agent 具备了读文件、搜内容、找文件的能力。但如果你打开 `packages/tui/src/cli.ts`，会发现 System Prompt 还是一段 21 行的内联字符串：

```typescript
const SYSTEM_PROMPT = `你是 Zero2Agent 课程配套的一个只读文件 Agent Harness 演示...

你有以下工具可以使用：
- read_file: 读取文件内容
- list_directory: 列出目录结构
- grep_search: 搜索文件内容（支持正则表达式）
- find_files: 按 glob 模式搜索文件路径...`;
```

这段 prompt 能用，但有几个问题：

| 问题 | 表现 |
|------|------|
| 工具描述双写 | prompt 里写一遍，tool schema 里又写一遍，容易漂移 |
| 结构不清晰 | 身份、能力、工作流、输出约束混在一起 |
| 不可扩展 | 想加 plan/debug/review 模式？只能继续往字符串里塞 |
| 动态内容混入 | 如果要加 cwd/date，也只能硬拼进这段静态文本 |

这些问题在工具少、功能简单时不明显。但随着 Agent 能力增长，prompt 会变成一个难以维护的"大泥球"。

**S004 要做的，就是在 Agent 还简单的时候，把 prompt 结构固定下来。**

---

## 这个 Story 要做什么

### 问题

1. **结构问题**：当前 System Prompt 是一段无结构的内联字符串，职责混杂
2. **双写问题**：工具描述在 prompt 和 tool schema 中重复维护
3. **扩展问题**：没有为 mode/instruction/runtime context 预留位置

### 目标

希望当前 Story 完成后：

- System Prompt 由 `buildSystemPrompt(options)` 函数生成，结构清晰
- Default System 固定为 5 个静态 section：Role → Scope → Tool Policy → Workflow → Output
- 工具完整描述只在 tool schema，System Prompt 只写 Tool Policy
- Runtime Context 放入 UserTaskContext，不污染 Default System
- 为 Instruction / Mode / Skills 预留扩展位置（本 Story 不实现）

### 边界

- **做**：`buildSystemPrompt()` 函数、5 段式 Default System、UserTaskContext 格式定义
- **不做**：AGENTS.md 加载、plan/debug/review 模式、skills 加载、prompt cache

---

## 关键实现

### 消息层级设计

S004 把 prompt 相关的信息分成六层，但本 Story 只实现其中一部分：

| 层级 | 职责 | S004 处理 |
|------|------|-----------|
| System | Agent 长期身份、能力边界、全局行为约束 | ✅ 实现 Default System 5 段 |
| Instruction | 项目/用户/组织级指令（AGENTS.md、skills） | 只预留位置，不实现加载 |
| User Task | 用户原始输入 + 当前任务上下文 | ✅ 定义 UserTaskContext 格式 |
| Tool | 工具 schema、调用策略、tool response | ✅ 确认 schema-only 策略 |
| Mode | plan/debug/review 等模式规则 | 只预留扩展点，不实现 |
| Response | 最终回答的格式、语言、引用策略 | ✅ 放入 Output section |

### Default System 的 5 个 Section

```text
Role / Identity
  → 你是谁，为什么存在

Scope / Capability
  → 能做什么，不能做什么

Tool Policy
  → 什么时候用什么工具，如何组合

Workflow
  → 面对普通任务时的默认推进方式

Output Contract
  → 回答语言、格式、简洁程度
```

这个顺序参考了 Codex、Gemini CLI、OpenCode、Pi Mono、Aider 等竞品的共性模式。

### 工具描述策略

**决策**：Tool schema 写完整工具 description，Default System 只写 Tool Policy。

| 位置 | 负责内容 |
|------|----------|
| Tool schema | 工具能做什么、参数是什么、输入输出约束 |
| Tool Policy | 什么时候用工具、如何组合工具、如何避免误用 |

这消除了当前 prompt 和 schema 的双写问题。

### Runtime Context 的归属

**决策**：Runtime Context（cwd、date、platform 等）放入 UserTaskContext，不放入 Default System。

理由：
- Default System 应尽量稳定，承载长期身份和硬约束
- Runtime Context 是动态事实，和本轮任务更接近
- 分离后有利于未来的 prompt cache

### UserTaskContext 格式

采用 XML-like tags 作为标准格式：

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

这个格式：
- 边界清晰，机器注入内容和用户原文有强分隔
- 可扩展，后续可加入 task_mode、focused_files、conversation_summary

### 实现轮廓

这次改动分三步：

1. **创建 prompt builder**
   - `packages/core/src/prompt/system.ts`：`buildSystemPrompt(options)` 函数
   - `packages/core/src/prompt/user-task.ts`：`buildUserTaskMessage(options)` 函数
   - `packages/core/src/prompt/index.ts`：导出入口

2. **迁移 System Prompt**
   - 从 `packages/tui/src/cli.ts` 移除内联 SYSTEM_PROMPT
   - 改为调用 `buildSystemPrompt()`

3. **集成 UserTaskContext**
   - Agent 层构造 UserTaskContext
   - 用户原始输入包装为 UserTask

### 推荐阅读顺序

1. 先看 [details/00-overview](./details/00-overview.md)
   - 建立消息层级和 prompt builder 的全局感
2. 再看 [details/01-technical-design](./details/01-technical-design.md)
   - 重点看 5 段式 System 的具体内容、UserTaskContext 的构造
3. 然后看代码（按改动顺序）：
   - `packages/core/src/prompt/system.ts` — System Prompt builder
   - `packages/core/src/prompt/user-task.ts` — UserTask builder
   - `packages/tui/src/cli.ts` — 集成入口
4. 最后回看 [CHANGELOG.md](../../../CHANGELOG.md#e01-s004-prompt-structure-done)

看代码时，重点留意三件事：

- 5 个 section 是怎么组织的
- Tool Policy 和 tool schema description 的分工
- UserTaskContext 是怎么包装用户输入的

---

## 做完后的效果

完成这一步后，你应该能观察到：

- System Prompt 由函数生成，结构清晰可读
- 工具描述不再双写，prompt 只写使用策略
- 用户输入被包装成带 Runtime Context 的 UserTask
- 代码结构为未来的 mode/instruction/skills 预留了扩展位

这一篇做完后，Agent 的能力没有变化，但：

> 它的 prompt 从一段"能用的字符串"升级为"可演化的结构化协议"。

资料入口：

- [总览](./details/00-overview.md)
- [技术设计](./details/01-technical-design.md)
- [任务清单](./details/02-task-list.md)
- [验收检查清单](./details/03-verification-checklist.md)
- [Backlog](./details/04-backlog.md)
- [迭代日志](../../../CHANGELOG.md#e01-s004-prompt-structure-done)
- Git tag：`E01-S004-prompt-structure`

---

## 技术实现细节

| 文档 | 说明 |
|------|------|
| [details/00-overview](./details/00-overview.md) | 设计概述 |
| [details/01-technical-design](./details/01-technical-design.md) | 技术设计方案 |
| [details/02-task-list](./details/02-task-list.md) | 开发任务清单 |
| [details/03-verification-checklist](./details/03-verification-checklist.md) | 验收检查项 |
| [details/04-backlog](./details/04-backlog.md) | 后续优化方向 |

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [讨论记录](../../../.discuss/2026-04-27/e01-s004-prompt-structure/outline.md) | 技术选型讨论（D06–D15） |
| [竞品调研](../../../researches/prompt-structure/) | Codex / Gemini CLI / OpenCode / Pi / Aider / Claude Code 的 prompt 结构 |
| [S003：文件搜索](../S003-file-search/README.md) | 上一篇（find_files + ToolContext） |

---

上一篇：[E01-S003：让 Agent Harness 能在项目里找到该看的文件](../S003-file-search/README.md)
