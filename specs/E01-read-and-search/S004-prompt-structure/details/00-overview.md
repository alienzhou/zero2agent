# E01-S004: 固定 Prompt 结构 - 总览

> Epic 1 第 4 个迭代：把内联 System Prompt 重构为结构化的 prompt builder，为未来扩展奠定基础。

---

## 迭代目标

**核心目标**：让学习者理解"prompt 不是一段文本，而是一套可组合的消息协议"。

**定位**：在 S003 的工具体系基础上，把 prompt 从"能用的字符串"升级为"可演化的结构"。

**你将学到**：

- 如何设计消息层级（System / Instruction / User Task / Tool / Response）
- 如何用 builder 函数组织 System Prompt 的多个 section
- 工具描述应该放在 prompt 还是 tool schema
- Runtime Context 和静态 System 的边界划分

---

## 核心功能

### 1. System Prompt Builder

创建 `buildSystemPrompt(options)` 函数，生成结构化的 Default System：

| Section | 职责 | 内容示例 |
|---------|------|----------|
| Role / Identity | Agent 是谁 | Zero2Agent 课程的只读 Agent Harness |
| Scope / Capability | 能做什么、不能做什么 | 查看文件、搜索内容；不编辑、不执行 shell |
| Tool Policy | 什么时候用什么工具 | find_files 找文件名，grep_search 找内容 |
| Workflow | 默认推进方式 | 先定位再精读，必要时搜索缩小范围 |
| Output Contract | 回答格式约束 | 中文回答、简洁、必要时引用路径 |

### 2. UserTask Builder

创建 `buildUserTaskMessage(options)` 函数，包装用户输入：

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

### 3. 工具描述策略调整

- Tool schema 写完整工具 description
- System Prompt 只写 Tool Policy（什么时候用、如何组合）
- 消除双写，单一信息源

---

## 设计原则

1. **静态与动态分离** — Default System 保持稳定，Runtime Context 放入 UserTaskContext
2. **职责单一** — prompt 写策略，schema 写能力
3. **预留优于实现** — 为 Instruction / Mode / Skills 预留位置，但不在本 Story 实现

---

## 技术选型

| 类别 | 选择 | 理由 |
|------|------|------|
| Prompt 存储形态 | 单函数 `buildSystemPrompt(options)` | 比 .md 文件更灵活，比多段渲染函数更简单 |
| 工具描述归属 | 仅 tool schema | 消除双写，模型调用工具时直接看 schema |
| System message 类型 | 当前返回 string，预留 string[] | 为未来 cache / mode 预留 |
| UserTaskContext 格式 | XML-like tags | 边界清晰，可扩展 |

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
- 竞品调研：`researches/prompt-structure/`（Codex / Gemini CLI / OpenCode / Pi / Aider / Claude Code）
- 迭代日志：`CHANGELOG.md`
