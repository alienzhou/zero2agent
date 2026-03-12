# Changelog

> 跟着迭代走，逐步理解 Agent 是如何从一个简单循环演化成完整工具的。

本项目使用**两层版本结构**：`S01-E001`（Stage 阶段 + Iteration 迭代）。

---

## 如何使用迭代

每个迭代都有对应的 Git Tag，可以随时切换：

```bash
# 查看所有迭代
git tag -l "S*" "E*"

# 切换到某个迭代
git checkout S01-E001-react-basic

# 回到最新
git checkout main
```

### 学习建议

1. **设计文档先行** - 先看 `specs/S0x-E00x-name/`，理解目标
2. **代码对照** - 边看设计边看代码
3. **复盘收尾** - 看 `retros/S0x-E00x-name.md`，学习经验教训
4. **动手实践** - Fork 后自己改代码

### 每个迭代的完整资料

| 资料 | 路径 | 说明 |
|------|------|------|
| 设计文档 | `specs/S0x-E00x-name/` | 要做什么、为什么 |
| 代码 | `packages/` | 实际实现 |
| 复盘笔记 | `retros/S0x-E00x-name.md` | 反思和经验 |
| 讨论记录 | `.discuss/` | 需求讨论过程 |
| VibeCoding | `.vibecoding/S0x/E00x/` | AI 协作对话记录 |

---

## 进度跟踪

### Stage 1: 基础 POC

> 核心目标：跑通模式和流程，建立"调用模型完成任务"的意识。

| 迭代 | 内容 | 状态 |
|------|------|------|
| S01-E001 | ReACT 基础版 | ✅ Done |

---

## [Unreleased]

### S01-E001-react-basic (Done)

**目标**：实现最基础的 ReACT Agent 循环 + 工具调用

**你会学到**：
- 什么是 ReACT 模式（Reasoning + Acting）
- Agent Loop 的基本结构
- 如何使用 Anthropic SDK 调用 LLM
- 如何实现 Tool Use（工具调用）

**关键文件**：
- `specs/S01-E001-react-basic/` - 设计文档
- `packages/core/src/` - 核心实现
- `retros/S01-E001-react-basic.md` - 复盘笔记（迭代完成后）

**学习要点**：
1. Agent 不是一次性调用 LLM，而是循环
2. 每次循环：思考 → 工具调用 → 执行工具 → 继续或结束
3. 使用 Anthropic Tool Use 机制实现工具调用

**变更内容**：
- [x] 项目基础设施（post-commit hook、版本编号规范）
- [x] 设计文档完成（specs/S01-E001-react-basic/）
- [x] VibeCoding 对话记录（.vibecoding/S01/E001/）
- [x] Anthropic SDK 集成
- [x] read_file / list_directory 工具实现
- [x] ReACT 循环实现
- [x] 端到端测试验证

---

## E000 - Repository Initialization (2026-03-10)

**目标**：搭建项目基础结构

**变更内容**：
- Monorepo structure with pnpm workspaces
- Three packages: `@zero2agent/core`, `@zero2agent/tui`, `@zero2agent/shared`
- Project documentation and directory structure
