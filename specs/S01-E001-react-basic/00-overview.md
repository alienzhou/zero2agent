# S01-E001: ReACT 基础版 - 总览

> Stage 1 第 1 个迭代：实现最基础的 ReACT Agent 循环 + 工具调用。

---

## 迭代目标

**核心目标**：让学习者建立"调用模型完成实际任务"的意识。

**定位**：这是一个 Toy/Demo/MVP 级别的实现，重点是跑通模式和流程，而非追求工程完备。

**你将学到**：
- 什么是 ReACT 模式（Reasoning + Acting）
- Agent Loop 的基本结构
- 如何使用 Anthropic SDK 调用 LLM
- 如何实现 Tool Use（工具调用）

---

## 设计原则

1. **MVP 优先** - 最小可行版本，不做过度抽象
2. **小步快跑** - 问题留到持续迭代中解决
3. **只读安全** - 初期只实现只读工具，避免风险
4. **模型友好** - 输出格式对 LLM 友好，便于后续处理

---

## 核心功能

### 1. ReACT 循环

```
┌─────────────────────────────────────────────────────────────────┐
│  用户输入 → 模型思考 → 工具调用 → 执行工具 → 返回结果 → 继续循环  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 工具清单

| 工具 | 功能 | 参数 |
|------|------|------|
| `read_file` | 读取文件内容 | `path`, `start_line?`, `end_line?` |
| `list_directory` | 列出目录结构 | `path`, `recursive?` |

---

## 技术选型

| 类别 | 选择 | 理由 |
|------|------|------|
| LLM SDK | Anthropic TypeScript SDK | 官方支持、类型完善、支持 baseURL 切换 |
| Tool Use | Anthropic Tool Use | `stop_reason: tool_use` 机制清晰 |
| 模型 | 可配置（默认 Claude Sonnet） | 支持通过 baseURL 切换到 MiniMax 等 |

---

## 文档导航

| 编号 | 文档 | 说明 |
|------|------|------|
| 00 | [总览](./00-overview.md) | 本文档 |
| 01 | [技术设计](./01-technical-design.md) | 架构设计与实现方案 |
| 02 | [任务清单](./02-task-list.md) | 开发任务拆解 |
| 03 | [验收检查清单](./03-verification-checklist.md) | 验收时的检查项 |
| 04 | [Backlog](./04-backlog.md) | 当前版本不做的事项 |

---

## 关联文档

- 讨论记录：`.discuss/2026-03-12/react-basic-implementation/outline.md`
- 迭代日志：`CHANGELOG.md`
- 复盘笔记：`retros/S01-E001-react-basic.md`（迭代完成后创建）
