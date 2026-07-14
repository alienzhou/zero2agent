# Changelog

> 跟着迭代走，逐步理解 **Agent Harness** 是如何从一个简单循环演化成完整工具体系的。

[首页](./README.md) | [Roadmap](./docs/roadmap/README.md) | [Epic 1](./specs/E01-read-and-search/README.md)

本项目使用**两层版本结构**：`E01-S001`（Epic 阶段 + Story 迭代）。

---

## 如何使用迭代

每个迭代都有对应的 Git Tag，可以随时切换：

```bash
# 查看所有迭代
git tag -l "E*" "S*"

# 切换到某个迭代（示例）
git checkout E01-S001-react-basic
git checkout E01-S002-grep-search
git checkout E01-S003-file-search

# 回到最新
git checkout main
```

若本地尚未列出某个 Tag，可用 `main` 最新提交对照下方迭代小节；Tag 与提交历史的整理以仓库实际为准。

### 学习建议

1. **设计文档先行** - 先看 `specs/E0x-epic-slug/S0xx-story-slug/README.md`，再按需进入 `details/`，理解目标
2. **代码对照** - 边看设计边看代码
3. **复盘收尾** - 看 `retros/README.md` 与各 Story 对应的 `E0x-S0xx-<slug>.md`（正文陆续补充）
4. **动手实践** - Fork 后自己改代码

### 每个迭代的完整资料

| 资料 | 路径 | 说明 |
|------|------|------|
| 设计文档 | `specs/E0x-epic-slug/S0xx-story-slug/README.md` + `details/` | Story 入口与技术细节 |
| 代码 | `packages/` | 实际实现 |
| 复盘笔记 | `retros/`（见 `retros/README.md`） | 反思和经验 |
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
| [E01-S003](./specs/E01-read-and-search/S003-file-search/README.md) | 文件搜索 (find_files) | Done |
| [E01-S004](./specs/E01-read-and-search/S004-prompt-structure/README.md) | Prompt 结构化 (buildSystemPrompt) | Done |

---

## [Unreleased]

### E01-S004-prompt-structure (Done)

所属 Epic：[Epic 1：能看 / 能查](./specs/E01-read-and-search/README.md) | Story 详情：[S004](./specs/E01-read-and-search/S004-prompt-structure/README.md)

**目标**：把内联在 `cli.ts` 里的 System Prompt 重构成可维护、可扩展的 Prompt Builder

**你会学到**：
- 为什么 System Prompt 需要结构化，而不能只是一段字符串
- 5 段式 System Prompt 的组织方式（Role / Scope / Tool Policy / Workflow / Output）
- Tool Schema 和 System Prompt 的职责分工，消除双写问题
- Runtime Context（cwd、date）为什么应该放在 UserTaskContext 而不是 System Prompt

**关键文件**：
- `specs/E01-read-and-search/S004-prompt-structure/` - 设计文档
- `packages/core/src/prompt/system.ts` - System Prompt Builder
- `packages/core/src/prompt/user-task.ts` - UserTask Builder
- `packages/core/src/prompt/types.ts` - 类型定义
- `packages/tui/src/cli.ts` - TUI 集成入口

**学习要点**：
1. Prompt 结构化的核心动机：当前能用，但不可扩展
2. 5 段式分工：身份 → 能力边界 → 工具策略 → 工作流 → 输出约束
3. Tool Schema 写"工具能做什么"，System Prompt 写"什么时候用工具"
4. Dynamic Runtime Context 与 Static System Prompt 分离，为未来 prompt cache 铺路

**变更内容**：
- [x] `packages/core/src/prompt/` 模块（`system.ts` / `user-task.ts` / `types.ts` / `index.ts`）
- [x] `buildSystemPrompt()` 函数：组装 5 段式 Default System
- [x] `buildUserTaskMessage()` 函数：将用户输入包装为 UserTaskContext + UserTask
- [x] Core `index.ts` 导出新的 prompt 模块
- [x] TUI `cli.ts` 移除内联 SYSTEM_PROMPT，改用 `buildSystemPrompt()`
- [x] 9 个测试用例（System Prompt / UserTask Builder 各段内容 + 格式验证）

---

### E01-S003-file-search (Done)

所属 Epic：[Epic 1：能看 / 能查](./specs/E01-read-and-search/README.md) | Story 详情：[S003](./specs/E01-read-and-search/S003-file-search/README.md)

**目标**：给 Agent 加上文件搜索能力，同时补上工具体系的工作目录基础设施

**你会学到**：
- 如何设计 ToolContext 统一工具的运行环境
- 从隐式依赖（process.cwd）到显式注入的重构思路
- ripgrep `--files` 模式与 `--json` 模式的差异
- find_files 与 grep_search / list_directory 的分工

**关键文件**：
- `specs/E01-read-and-search/S003-file-search/` - 设计文档
- `packages/core/src/tools/types.ts` - ToolContext 定义
- `packages/core/src/tools/find-files.ts` - find_files 工具实现
- `packages/core/src/loop.ts` - 上下文传递

**学习要点**：
1. 第三个工具到来时，前两个 Story 的隐式假设被暴露
2. ToolContext 是扩展点——后续加字段不需要改签名
3. 相对路径输出：省 token + 工具链衔接 + 一致性

**变更内容**：
- [x] `ToolContext` 基础设施（`types.ts`、`loop.ts`、`agent.ts`）
- [x] 三个现有工具适配（`read-file.ts`、`list-directory.ts`、`grep-search.ts`）
- [x] `find_files` 工具：3 参数（pattern/path/exclude）
- [x] ripgrep `--files` 模式集成
- [x] 结果处理：mtime 降序排序、100 条截断、相对路径输出
- [x] 11 个测试用例（基本搜索/参数/排序/格式/.gitignore/错误处理）
- [x] TUI 更新：system prompt 增加 find_files 说明

---

### E01-S002-grep-search (Done)

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

**目标**：实现最基础的 ReACT Agent Harness 循环 + 工具调用

**你会学到**：
- 什么是 ReACT 模式（Reasoning + Acting）
- Agent Loop 的基本结构
- 如何使用 Anthropic SDK 调用 LLM
- 如何实现 Tool Use（工具调用）

**关键文件**：
- `specs/E01-read-and-search/S001-react-basic/` - 设计文档
- `packages/core/src/` - 核心实现
- `retros/` - 复盘笔记（规划路径见 `retros/README.md`，正文陆续补充）

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
