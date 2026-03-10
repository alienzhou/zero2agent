# Changelog

> 跟着迭代走，逐步理解 Agent 是如何从一个简单循环演化成完整工具的。

本项目使用**迭代编号**（`E001`, `E002`, ...）代替传统的语义化版本。

---

## 如何使用迭代

每个迭代都有对应的 Git Tag，可以随时切换：

```bash
# 查看所有迭代
git tag -l "E*"

# 切换到某个迭代
git checkout E001-agent-loop

# 回到最新
git checkout main
```

### 学习建议

1. **设计文档先行** - 先看 `specs/Exxx.md`，理解目标
2. **代码对照** - 边看设计边看代码
3. **复盘收尾** - 看 `retros/Exxx.md`，学习经验教训
4. **动手实践** - Fork 后自己改代码

### 每个迭代的完整资料

| 资料 | 路径 | 说明 |
|------|------|------|
| 设计文档 | `specs/Exxx-name.md` | 要做什么、为什么 |
| 代码 | `packages/` | 实际实现 |
| 复盘笔记 | `retros/Exxx-name.md` | 反思和经验 |
| AI 记录 | `.vibecoding/` | Prompt 和对话 |

---

## 进度跟踪

| 迭代 | 内容 | 状态 |
|------|------|------|
| E001 | 基础 Agent 循环 | 🔜 Coming |

---

## [Unreleased]

### E001-agent-loop (Coming Soon)

**目标**：实现最基础的 ReAct Agent 循环

**你会学到**：
- 什么是 ReAct 模式（Reasoning + Acting）
- Agent Loop 的基本结构
- 如何调用 LLM API

**关键文件**：
- `specs/E001-agent-loop.md` - 设计文档
- `packages/core/src/loop.ts` - 循环实现
- `retros/E001-agent-loop.md` - 复盘笔记

**学习要点**：
1. Agent 不是一次性调用 LLM，而是循环
2. 每次循环：思考 → 行动 → 观察 → 继续或结束
3. 最简单的 Agent 只需要 20 行代码

**变更内容**：
- [ ] Implement basic ReAct agent loop
- [ ] Add tool calling capability
- [ ] Create simple CLI interface

---

## E000 - Repository Initialization (2026-03-10)

**目标**：搭建项目基础结构

**变更内容**：
- Monorepo structure with pnpm workspaces
- Three packages: `@zero2agent/core`, `@zero2agent/tui`, `@zero2agent/shared`
- Project documentation and directory structure
