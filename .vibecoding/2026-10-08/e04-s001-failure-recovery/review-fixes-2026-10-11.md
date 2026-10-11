# PR #23 最终审阅修复

用户先要求“你再最后 review 下呢”，随后授权：“那把这两个 P2 修掉，补上回归测试，再更新到 PR 里。”审阅基线为 `b3e0dc872a5626d6054ebbcf645f14e8d41bdaff`，在原独立 worktree 和 PR 分支继续修改。

## 复现与修复

1. 后台摘要的重试通知插入主模型的两段流式输出，随后主请求缺失 `message_stop`。原投影只修改最后一段文本，第一段仍以普通回答展示。现在 Core 的文本事件携带实际尝试的 `requestId`；投影只合并同一次请求的片段，并把该请求的全部保留片段标为废弃草稿。标签置于已截短文本之外，长草稿也不会裁掉标识；其他已完成回答保持原样。该可选事件字段兼容原有文本事件调用方。
2. provider 计数时设置 `maxRequests: 1`，第二次计数触发预算停止，Context 层包装错误后先被 Session 保存为通用中断，外层才恢复预算类型。现在在 Session 执行回调中恢复 `RunBudgetError`，确保具体原因进入正式历史与快照，并可发送给恢复后的下一轮。

## 先失败、后通过

新增/扩展回归在修改生产代码前运行。以下是失败输出摘录，不是完整终端记录：

```text
Core: 34 tests | 1 failed | 33 passed
retains the request-budget reason when the quota of 1 stops preparation or sending
Expected: "Run budget stopped: requests."
Received: "[Harness] This turn was interrupted. Completed tool results are retained; no file changes were rolled back. Re-check the workspace before continuing."

E2E projection: 1 test | 1 failed
marks every abandoned model fragment when a background-summary retry splits the display
Expected: { kind: 'notice', text: StringContaining '[未完成草稿 · 未写入会话]' }
Received: { kind: 'text', text: 'DRAFT ONE' }
```

投影集成用真实本地 HTTP/SSE、生产 SDK、Agent 和 TUI reducer。通过已经观测到的文本事件协调摘要失败与后续断流，不依赖固定延时推测并发顺序。它同时断言两段草稿都有标记、最终回答正常、正式历史没有草稿。另有短文本/超长文本的请求身份隔离检查。

预算回归分别覆盖额度 1（准备阶段耗尽）和 2（发送阶段耗尽），断言实际请求数、停止原因、快照序列化与恢复，以及下一轮真实模型请求保留停止事实。

修复后专项：Core 94 项通过；投影、CLI 故障和实际 TUI/PTY 42 项通过。`pnpm build`、E2E `tsc --noEmit` 通过；lint 0 错误、44 项既有警告。最初在根目录执行 tsc 时找不到该命令，改为 E2E 包内执行后通过，没有修改类型检查配置。

修复提交为 `a494fb46e01e4962e9f832d2a863029f8ae5d9ed`。默认 `pnpm test` 全仓 624 项通过（Core 447、E2E 176、CDP 1），57 项真实服务测试离线跳过；[完整输出](../../../researches/failure-recovery/acceptance/review-fixes-tests-2026-10-11.txt)与[本轮源码哈希](../../../researches/failure-recovery/acceptance/review-fixes-source-hashes-2026-10-11.json)另存，不覆盖早先验收证据。主工作区两份未提交文件的 SHA-256 与开始时一致。

本轮只处理这两条 P2；先前偶发日志不可用的根因仍未确认。固定课程 Tag 保留原版本，后续代码修复以 PR 分支为准。交付继续更新同一 PR #23 的分支及说明，不合并 main、不部署站点。
