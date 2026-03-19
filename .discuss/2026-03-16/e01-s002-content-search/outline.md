# E01-S002：让 Agent 能在内容里定位信息

> 讨论始于 2026-03-16，目标是明确 S002 的需求、设计与实现方案，最终输出 Spec。

---

## 🔵 Current Focus

- ✅ 讨论完成，所有设计决策已拍板，准备输出 Spec

## ⚪ Pending

（无）

---

## ✅ Confirmed

### 决策索引

| 编号 | 决策 | 文档 |
|------|------|------|
| D01 | S002/S003 边界：S002=内容搜索，S003=文件名搜索 | `decisions/D01-s002-s003-boundary.md` |
| D02 | 工具粒度：一个 `grep_search` 工具 | `decisions/D02-tool-granularity.md` |
| D03 | 问题场景：大文件定位 + 多文件查找 | `decisions/D03-problem-scenarios.md` |
| D04 | 工具设计方法论：四个核心问题 | `decisions/D04-tool-design-methodology.md` |
| D05 | 边界情况推迟到扩展阅读 | `decisions/D05-edge-cases-deferred.md` |
| D06 | 参数设计：pattern/path/include/exclude | `decisions/D06-parameter-design.md` |
| D07 | 输出格式：Gemini CLI 风格 | `decisions/D07-output-format.md` |
| D08 | context 参数：默认 0，LLM 按需指定 | `decisions/D08-context-parameter.md` |
| D09 | 技术选型：ripgrep + @vscode/ripgrep | `decisions/D09-tech-selection.md` |
| D10 | 排序（修改时间降序）、截断（100条）、描述（模板字符串） | `decisions/D10-sorting-truncation-description.md` |

### 设计总览

**工具定义**：一个 `grep_search` 工具，5 个参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `pattern` | string | 是 | — | 搜索模式（正则表达式） |
| `path` | string | 否 | 项目根目录 | 搜索目录 |
| `include` | string | 否 | — | 文件过滤 glob |
| `exclude` | string | 否 | — | 文件排除 glob |
| `context` | number | 否 | 0 | 匹配行前后各显示的上下文行数 |

**技术方案**：ripgrep（`@vscode/ripgrep` npm 包），按修改时间降序排列，100 条匹配上限

**输出格式**（Gemini CLI 风格）：
```
Found N matches for "pattern" in M files
---
File: src/path/to/file.ts
L42: matched line content
L43- context line (when context > 0)
---
```

**方法论**（D04）：S002 的教学点是"如何从零设计 Agent 工具"
- 核心原则：对人好用的工具对 AI 也好用
- 四个设计问题：解决什么问题 → 控制什么/自动化什么 → 输出契约 → 边界兜底

### 扩展阅读话题池

- 边界情况：复杂截断（单行/总量）、输入校验、超时机制
- 设计取舍：参数多 vs 少、绝对路径 vs 相对路径
- 业界进阶：自动上下文丰富、降级策略、模型适配 schema
- 后续扩展：`literal`/`case_sensitive` 参数、流式早停
- 发布分发：ripgrep 打包策略切换

---

## ❌ Rejected

（暂无）

---

## 📎 相关上下文

### 竞品调研

详见 `researches/grep-search/`：OpenCode、Codex、Pi、Gemini CLI 四份报告

### 现有代码结构

- Tool 接口：`packages/core/src/tools/types.ts`
- 现有工具：`read_file`、`list_directory`
- 工具注册：`packages/core/src/tools/index.ts` 的 `allTools` 数组
- Agent 循环：`packages/core/src/loop.ts`

### 相关讨论文档

- Story 模板：`.discuss/2026-03-15/epic-presentation-form/decisions/D02-story-page-template.md`
- Epic 1 规划：`specs/E01-read-and-search/README.md`
- S001 Backlog：`specs/E01-read-and-search/S001-react-basic/details/04-backlog.md`
