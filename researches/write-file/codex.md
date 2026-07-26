# OpenAI Codex CLI — 写文件 / 删除文件 调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [openai/codex](https://github.com/openai/codex) |
| 调研 Commit | `ce803c45aed425b08b94d8e3c5fb7db0d2193568` |
| Commit 日期 | `2026-07-23 17:55:22 +0000` |
| 调研日期 | `2026-07-24` |

## 调研目标

为 E02-S001 提供竞品参考：Codex 是否有 `write_file` / `delete` 这类独立工具？它如何统一处理「创建 / 修改 / 删除 / 移动」文件？

## 调研结论

1. **Codex 没有 `write_file`、也没有 `delete` 工具。它把「所有文件写操作」收敛到一个工具：`apply_patch`。** 在 `codex-rs/core/src/tools/handlers/` 下没有 write/delete，只有 `apply_patch.rs`。

2. **`apply_patch` 是一个 FREEFORM（自由文本 + Lark 语法）工具，不是 JSON 参数工具。** 模型输出一段 `*** Begin Patch ... *** End Patch` 的补丁文本，由 Lark 语法约束格式。工具描述明确：`This is a FREEFORM tool, so do not wrap the patch in JSON.`

3. **一个工具覆盖 4 种文件操作**（见 `apply_patch.lark`）：
   - `*** Add File: <path>` —— 新建文件（后跟 `+` 行）
   - `*** Delete File: <path>` —— 删除文件
   - `*** Update File: <path>` —— 修改文件（diff hunk）
   - `*** Move to: <path>` —— 修改的同时重命名/移动

4. **「创建」和「删除」不是独立工具，而是同一补丁语法里的两种 hunk 类型。** 这与 zero2agent Roadmap「write + delete 各自独立工具」的方向截然不同——Codex 用「统一补丁」范式把它们合一。

5. **这套范式为 GPT-5 系列定制**（注释：`Well-suited for GPT-5 models`），依赖模型有很强的补丁格式遵循能力。对教学项目和能力较弱的模型不友好。

## 详细分析

### A. `apply_patch.lark` 语法全文

```lark
start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
```

一次 `apply_patch` 调用可以包含**多个 hunk**——即在一次工具调用里同时新建 A、删除 B、修改 C，这是「统一补丁」范式相比「单文件单工具」的核心优势（原子性、批量性）。

### B. 为什么用 FREEFORM 而非 JSON

- JSON 转义大段代码内容（尤其含引号、换行）非常笨重，易出错；
- 补丁文本更接近 `git diff` 的自然形态，模型训练语料里见得多；
- 代价：需要一套 Lark 语法 + parser 来校验和解析，工程复杂度高。

### C. 与 zero2agent 的范式分歧

| 维度 | Codex（apply_patch） | zero2agent Roadmap 方向 |
|------|---------------------|------------------------|
| 工具数量 | 1 个统一工具 | write_file + delete + (未来)replace_in_file |
| 参数形态 | FREEFORM 补丁文本 | JSON 结构化参数 |
| 创建文件 | `*** Add File:` hunk | write_file |
| 删除文件 | `*** Delete File:` hunk | delete 工具 |
| 局部修改 | `*** Update File:` hunk | replace_in_file（S002） |
| 移动/重命名 | `*** Move to:` | 未规划 |
| 模型门槛 | 高（需精确遵循补丁语法） | 低（填 JSON 字段） |

## 对 zero2agent 的设计启示

1. **Codex 的「统一补丁」范式教学价值高但不适合 S001 主线。** zero2agent 是教学项目，`write_file(path, content)` 这种 JSON 工具对读者和模型都直观得多。apply_patch 更适合作为 deep-dive 里的「进阶范式对照」。

2. **`*** Delete File:` 佐证了「删除值得作为一等操作」——** 但 Codex 把它做成补丁里的一种 hunk，而非独立工具。zero2agent 若坚持独立 `delete` 工具，是有意选了「更直观、更细粒度」的教学路线，需在 spec 里说明这个取舍。

3. **「一次调用批量多操作」是 apply_patch 的独特优势**，zero2agent 的单文件工具做不到。这一点可以在 backlog 里记录为未来演进方向。

## 关键源码引用

- `codex-rs/core/src/tools/handlers/apply_patch.lark#L1-L19`：补丁语法全文（Add/Delete/Update/Move File 四种 hunk）
- `codex-rs/core/src/tools/handlers/apply_patch_spec.rs#L9-L30`：`create_apply_patch_freeform_tool`，FREEFORM 工具定义与描述
- `codex-rs/core/src/tools/handlers/`：目录下无 write/delete，佐证「统一到 apply_patch」

## 参考资料

- [OpenCode write 调研](./opencode.md)
- [pi-mono write 调研](./pi-mono.md)
