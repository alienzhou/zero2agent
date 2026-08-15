# E02-S002: 高效修改已有内容（replace_in_file）- 总览

> Epic 2 第 2 个迭代：引入局部修改工具 `replace_in_file`，让 Agent 能对已有文件做「只动一处」的精确替换，而不是整篇重写。

---

## 迭代目标

**核心目标**：让学习者理解「局部修改」与「全量重写」的本质差异，以及局部修改背后最关键的设计判断——**唯一性约束**。

**定位**：Epic 2 的「高效修改」环节。在 S001 的 `write_file`（全量写）之上，补上 `replace_in_file`（局部替换），让 Agent 的写能力从「能写」进化到「能改」。

**你将学到**：

- 为什么「整篇重写」在真实编码里 token 昂贵、易出错、易污染格式
- 唯一性约束如何倒逼模型提供足够上下文、从根上防止改错位置
- `replace_all` 开关如何平衡「安全默认」与「批量重命名的效率」
- 字符串精确替换为何是局部改的主流范式（对比补丁/块语法）

---

## 核心功能

### replace_in_file 工具

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 目标文件相对路径，基于 `ctx.cwd` 解析（与既有工具一致） |
| `old_string` | string | 是 | 要匹配的原文片段（逐字符精确匹配，含空白/缩进），不可为空 |
| `new_string` | string | 是 | 替换后的内容（可为空字符串，等价删除该片段） |
| `replace_all` | boolean | 否 | 默认 `false`；为 `true` 时替换所有匹配处 |

**语义**：在文件里精确匹配 `old_string`，替换为 `new_string`。默认要求 `old_string` **唯一出现**；`replace_all: true` 时替换全部并报告处数。

**成功回执**（英文，与既有工具一致）：

```text
Replaced src/config.ts (1 occurrence)
Replaced src/config.ts (4 occurrences)
```

**失败回执**：

```text
Error: Match not found: src/config.ts
Error: Match not unique: src/config.ts (3 occurrences, add more context to disambiguate)
Error: File not found: src/config.ts
Error: src/../../etc/hosts is outside the workspace, operation refused
```

---

## 设计原则

1. **确定性优先** — 字符串精确匹配 + 唯一性约束，宁可报错让模型补上下文，也不静默猜改哪处
2. **安全默认 + 显式逃逸** — 默认要求唯一匹配；`replace_all` 把「批量替换是有意为之」显式化
3. **单一职责** — 一次调用只做「一处替换」（或显式的全量替换），多文件/多段替换不在此列
4. **沿用既有契约** — 复用 `resolveInsideCwd` 硬拒绝、`Promise<string>` 回执、英文措辞，不另起炉灶

---

## 技术选型

| 类别 | 选择 | 理由 |
|------|------|------|
| 匹配方式 | `String.prototype.split(needle)` 计数与切分 | 字符串字面量匹配（非正则），`split`/`join` 避免 `$` 等替换占位符陷阱 |
| 唯一性判定 | `split(old_string).length - 1` 计算出现次数 | 0 次=未找到、1 次=唯一、≥2 次=不唯一（默认拒绝） |
| 全量替换 | `split(old_string).join(new_string)` | 与唯一替换共用同一机制，仅分支不同 |
| 写入实现 | `fs.readFile` → 替换 → `fs.writeFile` | 先读后改后写，复用 S001 的 Node 原生方案 |
| 路径边界 | 复用 `resolveInsideCwd`（`path-guard.ts`） | 与 S001 一致，越界硬拒绝 |
| 返回契约 | `Promise<string>`，错误用 `Error:` 前缀 | 与既有 6 个工具一致 |

> 明确**不做**：统一补丁范式、instruction 语义编辑、纯插入（空 old_string）、破坏性确认、软链解析、多文件/多段替换。

---

## 文档导航

| 编号 | 文档 | 说明 |
|------|------|------|
| 00 | [总览](./00-overview.md) | 本文档 |
| 01 | [技术设计](./01-technical-design.md) | 架构设计与实现方案 |
| 02 | [任务清单](./02-task-list.md) | 开发任务拆解 |
| 03 | [验收检查清单](./03-verification-checklist.md) | 验收时的检查项 |
| 04 | [Backlog](./04-backlog.md) | 当前版本不做的事项 |

> 本目录的 [README.md](../README.md) 是迭代入口，包含教学叙事、目标与设计动机。

---

## 关联文档

- 讨论记录：`.discuss/2026-08-15/e02-s002-replace-in-file/outline.md`
- 决策文档：`.discuss/2026-08-15/e02-s002-replace-in-file/decisions/D01–D07`
- 竞品调研：`researches/replace-in-file/`（opencode / codex / pi-mono / gemini-cli / aider）
- 迭代日志：`CHANGELOG.md`
