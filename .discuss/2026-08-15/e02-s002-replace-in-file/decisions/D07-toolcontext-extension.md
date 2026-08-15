# D07：ToolContext 扩展 —— 不扩展，维持只有 cwd

## 状态
✅ Confirmed

## 决策

`replace_in_file` **不扩展 `ToolContext`**，维持只有 `cwd`（延续 S001 D07）。

## 理由

1. **无 approval 需求**：局部替换同样不做破坏性确认（覆盖前不弹确认，留后续专章），因此没有驱动 `ctx` 扩展的需求。
2. **接口稳定优先**：`ToolContext` 是公共契约，不为单个 Story 的便利污染它。S001 已立住「不扩展」的基调，S002 延续。
3. **将来扩展的触发点明确**：一旦引入 approval 回调（破坏性确认专章），再一次性扩展 `ctx`，那时 `write_file` / `delete` / `replace_in_file` 一起适配。
