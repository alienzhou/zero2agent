# S01-E001: ReACT 基础版

> Stage 1 第 1 个迭代：实现最基础的 ReACT Agent 循环 + 工具调用。

---

## 迭代目标

**核心目标**：让学习者建立"调用模型完成实际任务"的意识。

**你将学到**：
- [什么是 ReACT 模式](./learnings/01-react-pattern.md#什么是-react)（Reasoning + Acting）
- [Agent Loop 的基本结构](./learnings/01-react-pattern.md#agent-loop)
- 如何使用 Anthropic SDK 调用 LLM
- [如何实现 Tool Use](./learnings/02-tool-use.md)（工具调用）

---

## 迭代内容

本迭代实现了一个 Toy/Demo 级别的 ReACT Agent，包含：

| 模块 | 说明 |
|------|------|
| `@zero2agent/core` | Agent 核心实现（loop、tools、llm） |
| `@zero2agent/tui` | 命令行交互界面 |
| `@zero2agent/shared` | 共享类型定义 |

**实现的能力**：
- ReACT 循环（Reasoning + Acting）
- 工具调用（`read_file`、`list_directory`）
- 多轮对话
- 调用过程日志输出

---

## 迭代成果

### 快速启动

```bash
# 1. 安装依赖
pnpm install

# 2. 构建所有包
pnpm build

# 3. 启动 TUI
pnpm --filter @zero2agent/tui start
```

### 效果展示

```
zero2agent - 文件助手
输入你的问题，输入 exit 退出

你: 看下项目里有哪些文件

[Loop] Starting with model: claude-sonnet-4-20250514
[Loop] User message: 看下项目里有哪些文件
[Loop] Tools available: read_file, list_directory

[Loop] Iteration 1
[Loop] Stop reason: tool_use
[Tool] Executing: list_directory
[Tool] Input: { "path": ".", "recursive": false }
[Tool] Output (83 chars)

[Loop] Iteration 2
[Loop] Stop reason: tool_use
[Tool] Executing: list_directory
[Tool] Input: { "path": "src", "recursive": true }
[Tool] Output (37 chars)

[Loop] Iteration 3
[Loop] Stop reason: end_turn
[Loop] Final response received

助手: 当前项目结构如下：

.
├── dist/                    # 编译输出目录
├── node_modules/           # 依赖包目录
├── src/                    # 源代码目录
│   ├── cli.ts              # CLI 入口文件
│   └── index.ts            # 主入口文件
├── package.json            # 项目配置文件
└── tsconfig.json           # TypeScript 配置文件
```

**特点**：
1. **自动工具调用**：Agent 根据用户问题自动选择合适的工具
2. **多步推理**：复杂问题会触发多次工具调用（如先列目录，再读文件）
3. **过程透明**：日志清晰展示每一步的推理和执行过程

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [00-overview](./00-overview.md) | 设计概述 |
| [01-technical-design](./01-technical-design.md) | 技术设计方案 |
| [02-task-list](./02-task-list.md) | 开发任务清单 |
| [03-verification-checklist](./03-verification-checklist.md) | 验收检查项 |
| [04-backlog](./04-backlog.md) | 后续优化方向 |
