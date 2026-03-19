# E01-S002: 内容搜索 - 总览

> Epic 1 第 2 个迭代：给 Agent 加上 `grep_search` 工具，实现内容搜索能力。

---

## 迭代目标

**核心目标**：让学习者掌握"如何从零设计一个 Agent 工具"的思考方法。

**定位**：在 S001 的只读闭环基础上，新增内容搜索能力，是第一个"增量扩展"的迭代。

**你将学到**：
- 如何用四个核心问题框架设计 Agent 工具
- ripgrep 集成的实践方式
- 工具输出格式对 Agent 行为的影响
- grep_search → read_file 的工具链协作模式

---

## 设计原则

1. **对人好用 = 对 AI 好用** — 好的工具设计天然对两者都友好
2. **MVP 优先** — 核心参数先行，扩展参数后续迭代
3. **纯新增** — 不改动 S001 的现有代码
4. **工具链思维** — grep_search 的输出要服务于下一步 read_file

---

## 核心功能

### grep_search 工具

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `pattern` | string | 是 | — | 搜索模式（正则表达式） |
| `path` | string | 否 | 项目根目录 | 搜索目录 |
| `include` | string | 否 | — | 文件过滤 glob，如 `*.ts` |
| `exclude` | string | 否 | — | 文件排除 glob，如 `*.test.ts` |
| `context` | number | 否 | 0 | 匹配行前后各显示的上下文行数 |

### 输出格式

```
Found 5 matches for "runLoop" in 3 files
---
File: src/core/loop.ts
L42: export async function runLoop(config: AgentConfig) {
L88: const result = await runLoop(updatedConfig)
---
File: src/core/index.ts
L15: import { runLoop } from './loop'
---
File: src/test/loop.test.ts
L23: const output = await runLoop(testConfig)
L45: expect(runLoop).toHaveBeenCalled()
```

### 自动化行为

- `.gitignore` 规则自动遵守（ripgrep 默认行为）
- 结果按文件修改时间降序排列
- 匹配上限 100 条，超出截断并提示

---

## 技术选型

| 类别 | 选择 | 理由 |
|------|------|------|
| 搜索引擎 | ripgrep | 性能远超 Node.js 原生，天然支持 .gitignore |
| ripgrep 获取 | `@vscode/ripgrep` npm 包 | install 时自动下载，零运行时网络依赖 |
| 工具接口 | 复用 S001 的 `Tool` 接口 | 纯新增，不改现有代码 |

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

- 讨论记录：`.discuss/2026-03-16/e01-s002-content-search/outline.md`
- 决策文档：`.discuss/2026-03-16/e01-s002-content-search/decisions/D01-D11`
- 竞品调研：`researches/grep-search/`（OpenCode / Codex / Pi / Gemini CLI）
- 迭代日志：`CHANGELOG.md`
