# E01-S003: 文件搜索 + 工具上下文 - 总览

> Epic 1 第 3 个迭代：给 Agent 加上 `find_files` 工具，同时引入 `ToolContext` 统一工具的工作目录。

---

## 迭代目标

**核心目标**：让学习者理解"当工具数量增长时，隐式假设如何变成显式基础设施"。

**定位**：在 S002 的内容搜索基础上，补全文件搜索维度；同时修补前两个 Story 积累的"隐式 cwd"技术债。

**你将学到**：

- 如何给工具体系加上统一的执行上下文（ToolContext）
- 相对路径在多工具协作中的衔接问题
- 复用已有基础设施（ripgrep）降低增量成本
- 文件搜索和内容搜索的分工设计

---

## 核心功能

### 1. ToolContext 基础设施

给 `Tool.execute` 新增第二个参数 `ctx: ToolContext`，包含 `cwd`（Agent 工作目录的绝对路径）。


| 改动层            | 变化                                                          |
| -------------- | ----------------------------------------------------------- |
| `Tool` 接口      | `execute(input, ctx: ToolContext)`                          |
| `AgentOptions` | 新增 `cwd?: string`，默认 `process.cwd()`                        |
| `runLoop`      | 构造 `ToolContext`，传给每次 `tool.execute`                        |
| 现有工具           | `read_file`、`list_directory`、`grep_search` 用 `ctx.cwd` 解析路径 |
| TUI            | 显式传入 `cwd: process.cwd()`                                   |


### 2. find_files 工具


| 参数        | 类型     | 必填  | 默认值   | 说明                                     |
| --------- | ------ | --- | ----- | -------------------------------------- |
| `pattern` | string | 是   | —     | glob 模式，如 `**/*.ts`、`src/**/test_*.js` |
| `path`    | string | 否   | `cwd` | 搜索根目录，相对于 Agent 工作目录                   |
| `include` | string | 否   | —     | 额外包含过滤（传给 rg `--glob`）                 |
| `exclude` | string | 否   | —     | 额外排除过滤（传给 rg `--glob=!xxx`）            |


### 输出格式

```
Found 12 files matching "**/*.test.ts"
src/tools/__tests__/grep-search.test.ts
src/tools/__tests__/read-file.test.ts
src/tools/__tests__/list-directory.test.ts
...
```

### 自动化行为

- `.gitignore` 规则自动遵守（ripgrep 默认行为）
- 结果按文件修改时间降序排列
- 匹配上限 100 条，超出截断并提示
- 输出相对路径（相对于搜索根目录）

---

## 设计原则

1. **显式优于隐式** — `process.cwd()` 的隐式依赖升级为 `ToolContext.cwd` 的显式传递
2. **复用优于新增** — 底层复用 S002 已接入的 ripgrep（`rg --files` 模式），零增量二进制依赖
3. **工具链衔接** — `find_files` 输出的相对路径可直接当 `read_file`/`grep_search` 的输入

---

## 技术选型


| 类别    | 选择                   | 理由                                   |
| ----- | -------------------- | ------------------------------------ |
| 搜索引擎  | ripgrep `--files` 模式 | S002 已接入 rg，零增量成本；自动 `.gitignore` 感知 |
| 工具上下文 | `ToolContext` 注入     | 显式、可测试、可扩展；优于闭包工厂和 `process.chdir`   |
| 输出路径  | 相对路径（POSIX）          | 省 token，与 `grep_search` 一致，工具链可衔接    |
| 排序策略  | mtime 降序             | 与 `grep_search` 一致，最近修改的文件更可能相关      |


---

## 文档导航


| 编号  | 文档                                       | 说明        |
| --- | ---------------------------------------- | --------- |
| 00  | [总览](./00-overview.md)                   | 本文档       |
| 01  | [技术设计](./01-technical-design.md)         | 架构设计与实现方案 |
| 02  | [任务清单](./02-task-list.md)                | 开发任务拆解    |
| 03  | [验收检查清单](./03-verification-checklist.md) | 验收时的检查项   |
| 04  | [Backlog](./04-backlog.md)               | 当前版本不做的事项 |


> 本目录的 [README.md](../README.md) 是迭代入口，包含目标、内容和成果展示。

---

## 关联文档

- 讨论记录：`.discuss/2026-03-29/e01-s003-glob-repo-research/outline.md`
- 决策文档：`.discuss/2026-03-29/e01-s003-glob-repo-research/decisions/D01-D04`
- 竞品调研：`researches/glob-search/`（OpenCode / Codex / Pi / Gemini CLI）
- 迭代日志：`CHANGELOG.md`

