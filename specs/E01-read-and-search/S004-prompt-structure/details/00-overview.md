# E01-S004: Prompt Structure - 总览

> Epic 1 第 4 个迭代：把只读 Agent 的 prompt 从 TUI 内联字符串整理成 core 侧可演进的消息结构。

---

## 迭代目标

**核心目标**：让学习者理解“Prompt Structure”不是文案排版，而是模型调用前后不同信息源如何被放入正确消息层的设计问题。

**定位**：S001-S003 已经完成只读工具闭环。S004 不新增工具，而是整理驱动工具使用的 system prompt、user task、runtime context 与 tool schema 的边界。

**你将学到**：

- 如何用 Message Layer Map 判断信息应该放在哪一层
- 如何把 Default System 拆成稳定 section
- 为什么工具完整描述应以 tool schema 为唯一事实来源
- 为什么 Runtime Context 更适合放到 UserTaskContext，而不是 Default System
- 如何给 mode、Instruction、skills、prompt cache 预留位置而不过度实现

---

## 核心功能

### 1. Default System Builder

Default System 固定为五段静态 section：

| 顺序 | Section | 作用 |
|------|---------|------|
| 1 | Role / Identity | 说明这是 Zero2Agent 课程里的只读 Agent Harness |
| 2 | Scope / Capability | 说明当前能力边界：读文件、看目录、搜内容、找文件；不编辑、不执行命令 |
| 3 | Tool Policy | 说明工具组合策略，不重复工具完整参数 |
| 4 | Workflow | 说明默认推进方式：先定位，再精读，再回答 |
| 5 | Output Contract | 说明中文、简洁、必要时引用路径 |

Runtime Context 不进入 Default System。

### 2. UserTaskContext

S004 阶段将 UserTask 与 UserMessage 合并理解：用户这条消息就是当前任务入口。但 UserMessage 可以被 builder 包装成两个 section：

```text
UserMessage
  ├─ UserTaskContext
  │   └─ Runtime Context
  └─ UserTask
      └─ 用户原始输入
```

目标格式采用 XML-like tags：

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

### 3. Tool 描述策略

工具完整说明只放在 tool schema 的 `description` 和 `input_schema` 中。Default System 不再手写 `read_file` / `list_directory` / `grep_search` / `find_files` 的完整说明，只保留工具组合策略。

| 位置 | 负责内容 |
|------|----------|
| Tool schema | 工具能做什么、参数是什么、输入输出约束 |
| Tool Policy | 什么时候用工具、如何组合工具、如何避免误用 |

### 4. 未来扩展位

S004 设计覆盖完整范围，但代码实现只落最小闭环：

| 能力 | 所属层级 | S004 处理方式 |
|------|----------|--------------|
| AGENTS.md / 项目指令 | Instruction | 只预留位置和优先级 |
| skills | Instruction / Skills | 只预留动态注入位置 |
| plan/debug/review/compact/promotion | Mode System Fragment/Profile | 只预留扩展点 |
| prompt cache | Prompt lifecycle | 只明确静态/动态边界 |
| tool response hint | Tool | 放入 backlog |

---

## 设计原则

1. **先分层，再写文案** — 不先问“这句话怎么写”，而是先问“这条信息属于哪一层”。
2. **静态 System 保持稳定** — Default System 只放长期规则，动态事实进入 UserTaskContext。
3. **Schema 是工具描述事实源** — tool schema 已经传给模型，不在 prompt 中重复工具参数说明。
4. **预留不等于实现** — mode、skills、Instruction 都要有位置，但不提前塞进 Default System。
5. **core 拥有 agent 行为** — prompt builder 属于 `packages/core`，TUI 只是交互外壳。

---

## 技术选型

| 类别 | 选择 | 理由 |
|------|------|------|
| Prompt 存储形态 | TypeScript builder | 与当前代码风格一致，可测试；比模板文件更适合教学项目 |
| System 结构 | 5 个静态 section | 覆盖当前只读 Agent 的长期行为，不污染动态上下文 |
| UserTaskContext 格式 | XML-like tags | 比 Markdown section 边界更清晰，适合分隔机器注入上下文和用户原文 |
| System 返回类型 | 先返回 `string` | 保持实现简单；内部按 section 组织，未来可演进为 fragments |
| Runtime Context 第一版 | `cwd` + `date` | 覆盖当前最有用的动态事实，platform/git 等后续再加 |

---

## 文档导航

| 编号 | 文档 | 说明 |
|------|------|------|
| 00 | [总览](./00-overview.md) | 本文档 |
| 01 | [技术设计](./01-technical-design.md) | 架构设计与实现方案 |
| 02 | [任务清单](./02-task-list.md) | 开发任务拆解 |
| 03 | [验收检查清单](./03-verification-checklist.md) | 验收时的检查项 |
| 04 | [Backlog](./04-backlog.md) | 当前版本不做的事项 |

> 本目录的 [README.md](../README.md) 是迭代入口，包含目标、内容和成果展示。

---

## 关联文档

- 讨论记录：`.discuss/2026-04-27/e01-s004-prompt-structure/outline.md`
- 决策文档：`.discuss/2026-04-27/e01-s004-prompt-structure/decisions/D06-D15`
- 竞品调研：`researches/prompt-structure/`
- 复盘笔记：`retros/E01-S004-prompt-structure.md`（迭代完成后创建）
