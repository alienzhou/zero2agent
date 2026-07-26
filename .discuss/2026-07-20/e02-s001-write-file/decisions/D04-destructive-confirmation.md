# D04：破坏性操作确认 —— S001 不做，后续专章完整实现

## 状态
✅ Confirmed

## 决策

- `write_file` 覆盖已有文件、`delete` 删除文件，**S001 都不做任何事前确认 / dry-run / 二次校验**。
- 破坏性操作的完整机制（事前确认 / 权限体系）**留到后续专门开一章完整做一套**，S001 不碰。
- 与之绑定：S001 **不扩展 ToolContext**（见 D07）——因为一旦引入 approval 回调就要动 `ctx` 接口，等做那一章时统一处理。

## 竞品对照

破坏性确认有两条路，S001 都暂缓：

| 路线 | 代表 | 依赖 |
|------|------|------|
| **事前确认** | OpenCode `ctx.ask` / Gemini `ApprovalMode` | 需扩展 ToolContext + 审批框架 |
| **事后回滚** | Aider：每次编辑自动 git commit，靠 `git revert` 撤销 | 需 git 集成 |

## 理由

1. **保持第一个写工具的最小闭环**：S001 的教学重点是「Agent 跨过只读边界、能动手改文件」。把 approval 塞进来会立刻牵扯 ToolContext 接口改造和 TUI 交互，喧宾夺主。
2. **approval 值得一个独立章节**：事前确认是一套完整的能力（权限粒度、批准模式、diff 呈现、人在环路），做半套不如不做。用户明确希望「后面章节里完整做一套」。
3. **事后回滚归 Epic 3**：Aider 的 git-as-undo 是 Checkpoint 机制的思路来源，属于 Epic 3（安全边界 / Checkpoint）范畴。

## Backlog / 演进路径

- **事前确认** → 未来专章：扩展 `ToolContext`（approval 回调）+ 审批模式 + diff 呈现。
- **事后回滚** → Epic 3：Checkpoint / git 集成，支持撤销破坏性操作。
