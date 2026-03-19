# D02：工具粒度 — 一个 grep_search 工具

## 状态
✅ Confirmed

## 决策

S002 只新增**一个 `grep_search` 工具**，聚焦内容搜索。文件名搜索留给 S003。

## 竞品佐证

四家头部 Coding Agent 都把内容搜索和文件名搜索拆成独立工具：

| 项目 | 内容搜索 | 文件名搜索 |
|------|---------|-----------|
| OpenCode | `grep` | `glob` |
| Codex | `grep_files` | 无独立工具（shell `rg --files`） |
| Pi | `grep` | `find` |
| Gemini CLI | `grep_search` | `glob` |

## 理由

1. 内容搜索和文件名搜索是正交维度，各用一个工具更清晰
2. 与 D01 的 S002/S003 边界一致
3. 单一工具对 LLM 认知负担更低
