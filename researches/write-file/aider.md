# Aider — 写文件 / 删除文件 调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [paul-gauthier/aider](https://github.com/paul-gauthier/aider) |
| 调研 Commit | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` |
| Commit 日期 | `2026-05-22 07:02:20 -0700` |
| 调研日期 | `2026-07-24` |

## 调研目标

为 E02-S001 提供竞品参考：Aider 作为「非 Function-Tool 架构」的代表，它如何让模型写文件？这个范式对 zero2agent 意味着什么？

## 调研结论

1. **Aider 根本没有 "工具" 概念——它用 Edit Format（编辑格式）而非 LLM Function Tool。** 模型在**普通回复文本**里按约定格式输出文件内容/补丁，Aider 用正则/解析器从回复里提取出编辑并落盘。这是与其他 4 家完全不同的范式。

2. **多种 edit format 对应不同"写"策略**（`aider/coders/` 下）：
   - `whole`（WholeFileCoder）：模型输出**整个文件的新内容**（fenced code block + 文件名），Aider 整体覆盖。最接近 zero2agent 的 `write_file`。
   - `editblock`（EditBlockCoder）：`SEARCH/REPLACE` 块，局部替换（对应 zero2agent 未来的 `replace_in_file`）。
   - `udiff`：unified diff 格式。
   - `editblock_func`：把 editblock 包成 function call。

3. **"写"是从模型回复文本里解析出来的，不是结构化工具调用。** `WholeFileCoder.get_edits()` 逐行扫描回复，靠 fence（```）和文件名切分出 `(fname, new_lines)`，再写入。

4. **没有独立 delete 概念。** 删除文件不在 edit format 的核心能力里；Aider 靠 git 集成和用户交互管理文件生命周期。

5. **强依赖 git**：Aider 每次编辑后自动 commit，用 git 作为「撤销/审计」层。这替代了其他工具的「破坏性确认」——反正都能 `git revert`。

## 详细分析

### A. WholeFileCoder（最接近 write_file 的范式）

```python
class WholeFileCoder(Coder):
    """A coder that operates on entire files for code modifications."""
    edit_format = "whole"

    def get_edits(self, mode="update"):
        content = self.get_multi_response_content_in_progress()
        lines = content.splitlines(keepends=True)
        # 逐行扫描，遇到 fence + 文件名，切出一个整文件编辑块
        # ...收集 (fname, fname_source, new_lines)
```

模型被要求：输出文件名，然后用 ``` 围起该文件的**完整新内容**。Aider 解析后整体覆盖目标文件。语义上等价于 `write_file(path, content)`，只是「参数」是从自然语言回复里 parse 出来的。

### B. Edit Format vs Function Tool 的取舍

| 维度 | Aider（Edit Format） | 其他 4 家（Function Tool） |
|------|---------------------|--------------------------|
| 写入触发 | 解析模型回复文本 | 模型显式 tool_call |
| 对模型要求 | 严格遵循文本格式约定 | 遵循 JSON schema |
| 兼容性 | 兼容不支持 tool-use 的老模型 | 需模型支持 tool calling |
| 健壮性 | 依赖 parser 容错 | 结构化，天然更稳 |
| 撤销/审计 | git 自动 commit | 各自实现 |

### C. 为什么这个范式对 zero2agent 仍有价值

zero2agent 的 Agent Harness 走的是标准 **Function Tool** 路线（`Tool.execute(input, ctx)`），与 Aider 范式不同。但 Aider 提供两个有价值的参照：

1. **`whole` format 印证了「全量写入」是最基础、最稳的写文件范式**——连不用 tool calling 的 Aider 都优先支持它。zero2agent S001 用 `write_file` 全量写入是稳妥的起点。
2. **Aider 用 git 替代破坏性确认**，提示 zero2agent：「写/删的安全兜底」除了「事前确认」，还有「事后可回滚」这条路。虽然 S001 不做，但这是 Epic 3（安全边界 / Checkpoint）的重要思路来源——zero2agent Roadmap 里 Epic 3 明确提到 Checkpoint。

## 对 zero2agent 的设计启示

| 维度 | Aider 做法 | zero2agent S001 启示 |
|------|-----------|---------------------|
| 写入范式 | Edit Format（文本解析） | zero2agent 走 Function Tool，不采用 |
| 全量写 | whole format | ✅ 印证全量写入是稳妥起点 |
| 局部改 | editblock（SEARCH/REPLACE） | 参考：zero2agent S002 replace_in_file 可借鉴 SEARCH/REPLACE 格式 |
| 安全兜底 | git 自动 commit + revert | 💡 Epic 3 Checkpoint 的思路来源，非 S001 |
| delete | 无 | 🔑 与其他 4 家一致：无独立 delete |

**结论**：Aider 是一个「架构对照组」——它证明了写文件不一定要 Function Tool，但也反衬出 zero2agent 选 Function Tool 路线的合理性（结构化、健壮、贴合现代模型）。它对 S001 的直接借鉴少，但 `whole` format 和 git-as-undo 两点值得写进 deep-dive 作为视野拓展。

## 关键源码引用

- `aider/coders/wholefile_coder.py#L10-L50`：`WholeFileCoder.get_edits`，从回复文本解析整文件编辑
- `aider/coders/editblock_coder.py`：SEARCH/REPLACE 块解析（对应局部替换）
- `aider/coders/` 目录：多种 edit format 并存（whole / editblock / udiff / func 变体）

## 参考资料

- [OpenCode write 调研](./opencode.md)
- [Codex apply_patch 调研](./codex.md)
