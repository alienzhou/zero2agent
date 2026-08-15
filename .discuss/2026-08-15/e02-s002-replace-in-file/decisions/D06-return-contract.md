# D06：返回契约 —— 沿用 string 回执（英文，与既有工具一致）

## 状态
✅ Confirmed

## 决策

`replace_in_file` 沿用 `Promise<string>` 回执，不引入结构化返回。**回执采用英文措辞，与既有 6 个工具的实际实现一致**：

| 情况 | 回执 |
|------|------|
| 成功（唯一替换） | `Replaced <path> (1 occurrence)` |
| 成功（replace_all） | `Replaced <path> (N occurrences)` |
| 未找到匹配 | `Error: Match not found: <path>` |
| 匹配不唯一 | `Error: Match not unique: <path> (N occurrences, add more context to disambiguate)` |
| 文件不存在 | `Error: File not found: <path>` |
| 目标是目录 | `Error: <path> is a directory, cannot replace` |
| 越界 | `Error: <path> is outside the workspace, operation refused` |
| old_string 为空 | `Error: old_string must not be empty` |
| 其他 IO 错误 | `Error: Failed to replace: <message>` |

## 理由

1. **吸取 E02-S001 复盘教训**：S001 的 D06/Spec 用中文描述回执、代码却落英文，造成 doc/code 漂移。本次在决策阶段就**明确英文回执**，Spec 与代码统一，不再两套并存。
2. **一致性**：既有 6 个工具（read_file / grep_search / write_file / delete 等）实际都返回英文回执，`replace_in_file` 沿用。
3. **信息量恰到好处**：报告「替换了几处 + 哪个文件」，让模型明确知道结果；不附 diff / LSP 诊断（太重，记 backlog）。
4. **结构化返回留给未来**：若日后要传 diff、诊断等富信息，再评估升级，S002 不提前设计。
