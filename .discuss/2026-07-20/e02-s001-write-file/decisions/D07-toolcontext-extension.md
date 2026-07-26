# D07：ToolContext 是否扩展 —— S001 不扩展，维持只有 cwd

## 状态
✅ Confirmed

## 决策

- S001 **不修改 `ToolContext` 接口**，维持现状（只有 `cwd` 字段）。
- `write_file` 与 `delete` 仅依赖 `ctx.cwd` 完成路径解析（`path.resolve(ctx.cwd, path)`）与边界校验（D03）。

## 理由

1. **与 D04 绑定**：唯一会驱使我们扩展 `ctx` 的需求是 approval 回调（破坏性确认）。既然 S001 明确不做 approval、留待后续专章，`ctx` 就没有扩展的理由。
2. **接口稳定性**：`ToolContext` 是所有工具的公共契约，改它会波及现有 4 个只读工具。没有硬需求就不动，避免为单个 Story 的便利污染公共接口。
3. **写能力用 cwd 已足够**：路径解析和 cwd 边界校验是写/删工具全部所需的上下文，现有 `cwd` 完全覆盖。

## 竞品对照

- OpenCode / Gemini 之所以有更丰富的 context，是因为它们承载了 permission / approval / IDE diff 等能力——而这些正是 S001 主动排除的（D04）。
- 印证：**不做 approval，就不需要扩展 context**。

## 演进路径

- 未来做 approval 专章时，统一评估 `ToolContext` 扩展（approval 回调 / 只读开关 / workspace 根等），一次性设计好，避免零敲碎打。
