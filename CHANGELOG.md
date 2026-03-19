# Changelog

> 跟着迭代走，逐步理解 Agent 是如何从一个简单循环演化成完整工具的。

[首页](./README.md) | [Roadmap](./docs/roadmap/README.md) | [Epic 1](./specs/E01-read-and-search/README.md)

本项目使用**两层版本结构**：`E01-S001`（Epic 阶段 + Story 迭代）。

---

## 如何使用迭代

每个迭代都有对应的 Git Tag，可以随时切换：

```bash
# 查看所有迭代
git tag -l "E*" "S*"

# 切换到某个迭代
git checkout E01-S001-react-basic

# 回到最新
git checkout main
```

### 学习建议

1. **设计文档先行** - 先看 `specs/E0x-epic-slug/S0xx-story-slug/README.md`，再按需进入 `details/`，理解目标
2. **代码对照** - 边看设计边看代码
3. **复盘收尾** - 看 `retros/E0x-S00x-name.md`，学习经验教训
4. **动手实践** - Fork 后自己改代码

### 每个迭代的完整资料

| 资料 | 路径 | 说明 |
|------|------|------|
| 设计文档 | `specs/E0x-epic-slug/S0xx-story-slug/README.md` + `details/` | Story 入口与技术细节 |
| 代码 | `packages/` | 实际实现 |
| 复盘笔记 | `retros/E0x-S00x-name.md` | 反思和经验 |
| 讨论记录 | `.discuss/` | 需求讨论过程 |
| VibeCoding | `.vibecoding/E0x/S00x/` | AI 协作对话记录 |

---

## 进度跟踪

### Epic 1: 基础 POC

> 核心目标：跑通模式和流程，建立"调用模型完成任务"的意识。

| 迭代 | 内容 | 状态 |
|------|------|------|
| [E01-S001](./specs/E01-read-and-search/S001-react-basic/README.md) | ReACT 基础版 | Done |
| [E01-S002](./specs/E01-read-and-search/S002-content-search/README.md) | 内容搜索 (grep_search) | Done |

---

## [Unreleased]

### E01-S002-content-search (Done)

所属 Epic：[Epic 1：能看 / 能查](./specs/E01-read-and-search/README.md) | Story 详情：[S002](./specs/E01-read-and-search/S002-content-search/README.md)

**目标**：给 Agent 加上内容搜索能力，学习如何从零设计 Agent 工具

**你会学到**：
- 如何用四个核心问题框架设计 Agent 工具
- ripgrep 集成的实践方式
- 工具输出格式对 Agent 行为的影响
- grep_search → read_file 的工具链协作模式

**关键文件**：
- `specs/E01-read-and-search/S002-content-search/` - 设计文档
- `packages/core/src/tools/grep-search.ts` - grep_search 工具实现
- `.discuss/2026-03-16/e01-s002-content-search/` - 讨论记录与决策

**学习要点**：
1. 工具设计核心原则：对人好用 = 对 AI 好用
2. 设计工具前回答四个问题：解决什么问题 → 控制什么/自动化什么 → 输出契约 → 边界兜底
3. 类比 VS Code 全局搜索推导参数设计

**变更内容**：
- [x] `grep_search` 工具：5 参数（pattern/path/include/exclude/context）
- [x] ripgrep 集成（`@vscode/ripgrep`，`--json` 模式解析）
- [x] 结果处理：修改时间排序、100 条截断、Gemini CLI 风格输出
- [x] 16 个测试用例（基本搜索/参数/排序/格式/正则/错误处理）
- [x] 流式输出：`client.messages.create()` → `client.messages.stream()`
- [x] 事件回调：`LoopEventHandlers`（onText/onToolStart/onToolEnd/onToolError）
- [x] TUI 工具展示优化（流式打印 + 工具调用摘要）

---

### E01-S001-react-basic (Done)

所属 Epic：[Epic 1：能看 / 能查](./specs/E01-read-and-search/README.md) | Story 详情：[S001](./specs/E01-read-and-search/S001-react-basic/README.md)

**目标**：实现最基础的 ReACT Agent 循环 + 工具调用

**你会学到**：
- 什么是 ReACT 模式（Reasoning + Acting）
- Agent Loop 的基本结构
- 如何使用 Anthropic SDK 调用 LLM
- 如何实现 Tool Use（工具调用）

**关键文件**：
- `specs/E01-read-and-search/S001-react-basic/` - 设计文档
- `packages/core/src/` - 核心实现
- `retros/E01-S001-react-basic.md` - 复盘笔记（迭代完成后）

**学习要点**：
1. Agent 不是一次性调用 LLM，而是循环
2. 每次循环：思考 → 工具调用 → 执行工具 → 继续或结束
3. 使用 Anthropic Tool Use 机制实现工具调用

**变更内容**：
- [x] 项目基础设施（post-commit hook、版本编号规范）
- [x] 设计文档完成（specs/E01-read-and-search/S001-react-basic/）
- [x] VibeCoding 对话记录（.vibecoding/E01/S001/）
- [x] Anthropic SDK 集成
- [x] read_file / list_directory 工具实现
- [x] ReACT 循环实现
- [x] 端到端测试验证

---

## S000 - Repository Initialization (2026-03-10)

**目标**：搭建项目基础结构

**变更内容**：
- Monorepo structure with pnpm workspaces
- Three packages: `@zero2agent/core`, `@zero2agent/tui`, `@zero2agent/shared`
- Project documentation and directory structure
