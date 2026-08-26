# D03 - find_files 工具参数与行为契约

**Status**: ✅ 已确认
**Related Outline**: [Back to Outline](../outline.md)

---

## 📋 Background

### 问题 / 需求

E01-S003 要给 Agent 加上「按 glob 模式搜索文件」的能力。底层技术已选定 `rg --files`（D01），现在要确定**面向模型的工具接口**：工具名、参数列表、输出格式、排序策略、截断策略，以及与现有 `list_directory` 的分工边界。

### 约束

- 底层走 `rg --files --glob`（D01 已定）
- 工具输出是给 LLM 消费的——token 经济性很重要
- 需要和 `read_file`、`grep_search`、`list_directory` 风格一致
- 教学项目，简洁优先

---

## 🎯 Objective

定义 `find_files` 工具的完整行为契约，使后续 Spec 编写和实现有明确依据。

---

## ✅ Final Decision

### 工具名

`find_files`

**选型依据：** 对比四家竞品（OpenCode `glob`、Codex 无、Pi `find`、Gemini CLI `glob`），`find_files` 更能表达意图——"按模式找文件"。避免了 `glob` 对非技术背景读者的认知门槛，也避免了与 Unix `find` 混淆。

### 参数列表

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `pattern` | string | ✅ | — | glob 模式，如 `**/*.ts`、`src/**/test_*.js` |
| `path` | string | ❌ | `cwd`（工作目录） | 搜索根目录，相对于 Agent 工作目录解析 |
| `exclude` | string | ❌ | — | 额外的 glob 排除过滤（传给 rg `--glob=!xxx`） |

**对比：**
- OpenCode 只有 `pattern` + `path`——最简但缺灵活性
- Gemini CLI 有 5 个参数（含 `case_sensitive`、两个 ignore 控制）——过于复杂
- 我们选择简洁路线：`pattern` + `path` + `exclude`

> **2026-03-30 更新**：移除 `include` 参数。原因是 `include` 与 `pattern` 功能重叠——用户可以直接在 `pattern` 中表达包含逻辑（如 `**/*.test.ts`）。保留该参数会导致：(1) ripgrep 多个 `--glob` 是 OR 关系，无法做 AND 过滤，需要 JS 层后处理；(2) JS 后处理需要引入 glob 匹配库或简化实现，增加复杂度和边界 case；(3) 与 `grep_search` 的 `include` 语义不一致（后者用于文件类型过滤，这里用于路径模式匹配）。简化为 3 参数符合「教学项目，简洁优先」的约束。

### 输出格式

**相对路径（POSIX 格式）**，相对于搜索根目录。

```
src/utils/api.ts
src/components/Button.tsx
tests/unit/api.test.ts
```

**选型依据：**

| 方案 | 使用者 | 优劣 |
|------|--------|------|
| 绝对路径 | OpenCode、Gemini CLI | Token 浪费（重复前缀），但无歧义 |
| 相对路径 | Pi、Codex (shell rg) | Token 经济，与 `read_file`/`grep_search` 路径风格一致 |

选择相对路径。原因：
1. 省 token——大型项目的绝对前缀（如 `/Users/xxx/projects/myapp/`）每行重复
2. 与 `read_file(path: "src/foo.ts")` 和 `grep_search(path: "src/")` 的路径风格一致，模型可以直接把输出当其他工具的输入
3. Pi 实践验证可行

### 排序策略

**mtime 降序**（最近修改的文件在前）。

**选型依据：**

| 方案 | 使用者 | 优劣 |
|------|--------|------|
| mtime 降序 | OpenCode | 简单，最近改的文件往往最相关 |
| 无排序 | Pi、Codex | 最简，但对模型不友好 |
| 双档分区（24h mtime + older 字典序） | Gemini CLI | 精巧但复杂，收益有限 |

选择 mtime 降序。原因：
1. 与 `grep_search` 一致（S002 已采用 mtime 排序）
2. Agent 场景下最近修改的文件通常最相关
3. 实现简单——`stat` 后 sort 即可

### 截断策略

**条数硬截断，默认 100 条。**

- 超过 limit 时保留前 100 条（mtime 最新的），末尾追加截断提示（如 `... and N more files`）
- 后续可根据需要加字节限、可配 limit 参数

**选型依据：**
- OpenCode 100（硬编码）
- Pi 1000（默认）+ 50KB 字节限
- 先做简单的，复杂策略（如 Pi 的双限）留后续迭代

### 与 `list_directory` 的分工

| 维度 | `list_directory` | `find_files` |
|------|-----------------|-------------|
| **定位** | 目录浏览器 | 项目级文件搜索 |
| **典型问题** | "这个目录下有什么？" | "项目里所有 `*.test.ts` 在哪？" |
| **输入** | `path`（目录）、`recursive?` | `pattern`（glob）、`path?`、`exclude?` |
| **输出** | 缩进目录树（`[dir]`/`[file]` 标记） | 扁平路径列表 |
| **底层** | `fs.readdir` | `rg --files --glob` |
| **排序** | 字母序（目录在前） | mtime 降序 |
| **`.gitignore`** | 不感知 | rg 自动尊重 |
| **深度** | 可选递归 | 默认全深度递归 |

两者互补：`list_directory` 回答"结构是什么"，`find_files` 回答"文件在哪"。

---

## ❌ Rejected Solutions

### 工具名 `glob` / `glob_search`
- **拒绝原因**：对非技术背景读者认知门槛高，`find_files` 更直观
- **重新考虑条件**：如果社区/用户强烈偏好

### 输出绝对路径
- **拒绝原因**：浪费 token，重复前缀无信息量
- **重新考虑条件**：如果后续发现模型在相对路径解析上频繁出错

### Gemini CLI 双档排序
- **拒绝原因**：增加复杂度但收益有限
- **重新考虑条件**：如果纯 mtime 排序在大仓场景下效果不佳

### Pi 式双限截断（条数 + 字节）
- **拒绝原因**：当前阶段简单条数限就够
- **重新考虑条件**：遇到单条路径极长或结果集需要更精细控制时

---

## 🔗 Related Links

- [D01 - Glob 底层技术选型](./D01-glob-underlying-tech.md)
- [D02 - Benchmark 设计方案](./D02-benchmark-design.md)
- [D04 - Agent 统一工作目录](./D04-tool-context-cwd.md)
- [OpenCode 调研](../../../../researches/glob-search/opencode.md)
- [Codex 调研](../../../../researches/glob-search/codex.md)
- [Pi 调研](../../../../researches/glob-search/pi.md)
- [Gemini CLI 调研](../../../../researches/glob-search/gemini-cli.md)
