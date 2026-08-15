# D01：工具范式 —— 字符串精确替换，不做统一补丁

## 状态
✅ Confirmed

## 决策

`replace_in_file` 采用**字符串精确替换**范式：参数 `old_string`（要匹配的原文片段）+ `new_string`（替换后的内容）。不采用：

- Codex 的 `apply_patch`（FREEFORM 补丁文本 + 多文件 hunk）
- Aider 的 `editblock`（SEARCH/REPLACE fenced block 语法）

参数名沿用 Anthropic 约定 `old_string` / `new_string`（而非 OpenAI 的 `search` / `replace`），与本项目 Anthropic SDK 技术栈一致。

## 竞品对照

| 竞品 | 局部改范式 | 特点 |
|------|-----------|------|
| OpenCode | `edit`（oldText/newText） | 字符串替换 |
| Codex | `apply_patch`（FREEFORM） | 补丁语法，需 Lark parser |
| pi-mono | `edit`（oldString/newString） | 字符串替换 |
| Gemini CLI | `edit`（old_string + instruction） | 字符串替换 + 语义编辑 |
| Aider | `editblock`（SEARCH/REPLACE） | 块语法 |

五家里三家用字符串替换，这是主流；补丁/块语法是为「批量多文件变更」服务的重方案。

## 理由

1. **教学直观**：字符串对模型最友好、对人类读者最易验证——`old_string` 匹配不上就是匹配不上，没有语法解析的隐晦空间。
2. **延续 S001「一个工具一种意图」**：`replace_in_file` 只做「一处局部替换」，语义清晰；补丁范式天然是「一个工具改一堆文件」，违背单一职责。
3. **不引入 parser**：补丁/块语法需要专门解析器（Codex 用 Lark），教学项目不背这个复杂度。
