# Core 独立交叉审阅

2026-10-07。审阅者负责本课 TUI，未编写被审阅的 Core 实现。本次比较 `caa47ea..07c93a4` 的 `packages/core/`，并追读本次改动依赖的 Session、ContextManager、token counting、summary 与 terminal 生命周期。生产代码保持冻结，仅新增本记录。

## 结论

在下列检查范围内，未发现需要修复后才能合入的确切缺陷。结论来自逐路径代码审查、测试断言核对与已有执行记录，不等同于证明所有自定义工具、平台或进程逃逸方式都能被强制终止。本轮没有重新运行全量测试；最终构建和测试结果以主代理生成的稳定源码验收记录为准。

## 检查范围与证据

| 检查项 | 当前实现与审阅结果 | 直接证据 |
| --- | --- | --- |
| Turn 互斥与 signal | Agent 在进入 run/compact 前设置 active controller；finally 才释放。run、compact、reset 不能重叠。cancelTurn 中断 controller，同时取消权限等待与上下文操作。 | `agent.ts`；`runtime.test.ts` 的非协作工具/重叠调用、空闲 cancel 与下一轮用例 |
| 请求发送前取消 | runLoop 在 turn-start、preparing、requesting 的观察通知后检查 signal。已经取消时不继续准备或发起模型请求。 | `loop.ts`；`runtime.test.ts` 的预取消、turn-start 同步取消用例 |
| 模型流取消 | signal 传入真实 SDK stream；等待 finalMessage 同时响应取消。acceptingText 与 signal 双重阻止迟到文字；不把中断的局部流写入正式 history。 | `loop.ts`、`runtime.ts`；`runtime-sdk.test.ts` 实际 HTTP 连接 close 断言，以及 `runtime.test.ts` late text/history 断言 |
| 观察者隔离 | RuntimeEmitter 先建立 turnId/seq，再 structuredClone 给观察者。同步异常及 Promise 拒绝被吸收；旧 onToolStart 输入也使用副本。结果写入与界面回调异常相互独立。 | `runtime.ts`、`loop.ts`；`runtime.test.ts` 的 mutation/rejected observer 与 `session.test.ts` 的旧回调隔离用例 |
| 观察者可重入取消 | turn-start、阶段切换、审批前后、工具开始前、最终 Harness notice 后均有取消检查。取消触发 cancelling 事件只通知一次；turn-end 发布前关闭 emitter，后续事件不再进入界面。 | `loop.ts`；`runtime.test.ts` 的 turn-start / final notice 同步取消、迟到文字用例 |
| 审批生命周期 | ctx.signal 转发到独立审批 controller；注册 abort listener 后再次检查已取消状态。超时/取消以 deny 收尾，requestId 校验拒绝不匹配响应；finally 移除 timer 和 signal listener。 | `permissions.ts`；既有 `permissions.test.ts`，新增整批取消与生产 TUI timeout/late-key 回归 |
| 工具结果与配对 | 已收到的每个 tool_use 先显示 pending，按顺序执行。unknown、权限拒绝、抛错和 Error 前缀输出分别产生终态与 tool_result；取消后未启动的调用也补充错误回执。整批结果追加完毕后才抛 TurnCancelledError。 | `loop.ts`；`runtime.test.ts` 的 distinct calls、缺失工具、拒绝、Error 输出、取消批次、截断调用配对用例 |
| 非协作工具 | 不对 tool.execute 做 Promise.race。取消后仍等待实际 settle，保留它返回的真实结果和已有副作用，再跳过后续调用。若工具失败，回执明确没有自动回滚。 | `loop.ts`；`runtime.test.ts` 的 deferred 非协作工具，包含互斥、真实成功结果保留、后续调用未执行和下一轮断言 |
| count 与 summary | ContextManager.cancel 中断当前 operation controller、压缩 job 并更新 epoch；计数等待可取消，summary 有独立可取消等待；异步工作晚到后不能通过 epoch/prefix 验证。手动 compact 的 Agent controller 通过 cancelCompaction 到达相同机制。 | `context-manager.ts`、`context-budget.ts`、`context-summary.ts`；`runtime-sdk.test.ts` 实际 count/manual summary/automatic summary HTTP close 断言；既有 context-manager reset/cancel 竞态用例 |
| 前台终端清理 | terminal 收到 ToolContext.signal；runCommand 注册 abort 后补查 signal。取消先结束进程组，再等待清理与输出 drain；完成/错误/转后台路径卸载中断绑定。已经转后台的进程不会被之后的 Turn 取消再次终止。 | `terminal.ts`；`terminal-cancellation.test.ts` 的已完成文件/输出保留、后续写入不存在；TUI 真实前台 PID 消失断言 |
| 人工终端边界 | signal 随 HumanTerminalRequest 传到宿主。Core 只接收 completed/declined/cancelled、退出码与 signal 元数据，不接收人工 PTY 输入输出。 | `terminal-runtime.ts`、`terminal.ts`；生产 TUI 两次 handoff 后全 API 正文审计用例 |
| 异常与下一轮 | Session 中断时保留已配对的历史及 Harness 中断说明；getHistory 返回副本。取消不会撤销文件写入。下一轮重新获取独立 controller 与 turnId。 | `session.ts`、`agent.ts`；runtime 单元测试、生产 TUI HTTP/PTY 测试和 `runtime-live.test.ts` 的取消后继续 |

## 已执行证据的使用范围

- 已读取 `researches/runtime-tui/acceptance/initial/offline.txt`：该轮 Core 为 28 个文件、394 项通过。此记录先于最后两项 TUI 补验，不能拿旧 E2E 数量替代最终结果。
- 已读取 `researches/runtime-tui/acceptance/initial/runtime-demo.txt`：本地 SSE 经真实 SDK/Core/tools，覆盖先拒绝再批准、两份工具配对、实时 HTTP 取消及取消后释放，`passed: true`。
- 已核对 `e2e/src/runtime-live.test.ts` 的真实模型断言：读文件、新对话、拒绝与批准写入、真实前台终端取消、已完成文件保留及下一请求中的取消回执。运行和证据保存由主代理负责，本审阅不冒充重新执行。
- TUI 实现者在本轮先前实际执行 `runtime-tui-state.test.ts` 与 `runtime-tui.test.ts`：18 项通过，并通过 E2E 类型检查。新增两项明确覆盖真实审批超时/晚到按键，以及两次真实人工 PTY 后的全部 API 请求隐私审计。

## 保留边界

1. 任意忽略 signal、永不结束的自定义 JS 工具会保持 Session busy；这是当前选择的证据保留语义，需要 Worker/独立进程才可能安全强制终止，已在 Backlog 明示。
2. 普通 terminal 的 POSIX 取消针对受控进程组，不能推导成对主动 setsid/逃逸后代的全面沙箱保证。已有 drain-timeout 回执保留输出可能不完整的说明。本课没有扩张此安全边界。
3. 当前验收环境是 macOS/POSIX，不能据此宣称 Windows taskkill 或人工 PTY 支持已经经过实机验证。
4. 工具 completed 表示工具返回了正常回执，不等于用户任务已经成功；shell 的非零退出码仍需读取其 Exit code。当前运行状态契约仅把抛错、Error 前缀回执与明确取消回执映射为相应错误/取消终态。
