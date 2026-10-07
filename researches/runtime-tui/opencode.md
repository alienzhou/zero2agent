# OpenCode：分开会话、工具内容与输入焦点

## 基本信息

| 项目 | 值 |
|---|---|
| 官方仓库 | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| 调研 Commit | `ecc4916b5a9608c30e6dd58a67f2137b594407ca` |
| Commit 日期 | `2026-10-06T15:32:45-07:00` |
| 最近 Tag | 浅克隆深度 100 内无可达 tag，以 SHA 为准 |
| 调研日期 | 2026-10-07（Asia/Shanghai） |
| 证据级别 | 固定源码静态核对；不代表已运行该产品 |

## 调研目标与结论

核对事件投影、审批、上下文相关取消与终端交接。当前仓库路径已有迁移，引用实际读取的 `packages/tui`，不沿用旧教程路径。

## 详细分析

### session 与工具属于不同状态层

[session schema](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/schema/src/session-status-event.ts#L9-L40)有 idle/retry/busy，retry 携带 attempt、message、next；[工具 schema](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/schema/src/session-message.ts#L81-L140)另有 pending/running/completed/error、工具 ID、内容和时间。[session 事件](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/src/context/sync.tsx#L316-L319)与 [part 更新/增量](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/src/context/sync.tsx#L376-L414)分别更新客户端 store。

### 审批结算绑定请求

[权限 UI](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/src/routes/session/permission.tsx#L400-L435)提供 once/always/reject，按请求 ID 调用 permission.reply。Escape 在这里用于拒绝，不能同时交给全局会话取消。

### Esc 根据焦点解释

[默认键位](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/src/config/keybind.ts#L90-L100)把 session_interrupt 绑定 Escape；[中断处理](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/src/component/prompt/index.tsx#L392-L422)先排除自动完成和非聚焦输入，shell mode 先返回普通模式，再通过计数要求重复触发才 abort，计数有清零时间窗。因此按一次 Esc 并非无条件停止。

[焦点恢复](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/src/component/prompt/index.tsx#L635-L645)在 dialog 活动时 blur prompt，关闭后恢复；组件重挂载也不能抢走弹层焦点。

### 交接必须恢复终端

[openEditor](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/src/editor.ts#L26-L54)先 suspend renderer，以继承 stdio 运行编辑器，在 finally 中 resume 并重绘。这覆盖外部编辑器交接，不证明本项目人工 PTY 的私密输入边界相同。

## 关键源码与参考

[TUI 依赖](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/package.json#L53-L66)为 OpenTUI 与 Solid，不能称为 Ink 实现。[官方 TUI](https://opencode.ai/docs/tui/)和[键位文档](https://opencode.ai/docs/keybinds/)作为入口，当前网页与固定源码可能跨版本，具体行为以 SHA 为准。
