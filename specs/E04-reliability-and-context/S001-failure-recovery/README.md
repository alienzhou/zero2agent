# E04-S001：失败恢复与运行预算

[Epic 4](../README.md) | [首页](../../../README.md) | [迭代日志](../../../CHANGELOG.md)

Agent 已经写好了文件，下一次请求却遇到网络故障。重新问模型可以恢复对话，但把整个任务重做一遍可能再次产生副作用。另一种问题是调用一直失败，模型不断改参数、试命令，程序虽然没有崩溃，却持续消耗时间和请求。

本课把这两种失败放到同一个 Turn 中：请求可以有限重试，工具修正是新的受控调用，运行有明确的停止条件。**预算到达后停止新工作，已完成的文件效果和工具结果仍保留。**

当前为开发分支的实现与验收候选，未合入 main；最终交付范围以[验收页](./details/03-verification-checklist.md)为准。

## 先看到效果

```bash
pnpm install --frozen-lockfile
pnpm build
node scripts/e04-s001-recovery-demo.mjs
node scripts/e04-s001-recovery-demo.mjs --tui
```

演示使用本地 HTTP/SSE 返回确定性响应，生产 CLI、SDK、授权、文件工具、会话和日志真实运行。它检查重试次数、写入只产生一条 Checkpoint、重复失败停止、半截流和鉴权失败；退出删除临时工作区。[分步跟练](./follow-along.md)解释如何观察。

## 三种“再来一次”

| 失败位置 | 处理 | 保留的事实 |
| --- | --- | --- |
| 模型请求未完整结束 | 对符合条件的错误有限重发同一发送视图 | 已完成工具结果不重放；半截文本只是草稿 |
| 工具返回错误 | 配对结果交回模型，由它提出修正调用 | 每次新调用重新授权和文件保护；相同失败达到限制后停止 |
| 整个 Turn 已消耗完预算 | 停止后续请求与工具，等待正在执行的工具结算 | 历史与真实效果保留，随后可以发起新 Turn |

请求重试不消耗新的推理迭代，但消耗实际请求额度和时间。SDK 的自动重试关闭，由 Harness 记录每次尝试。HTTP 408、429、5xx、连接错误、请求超时和可识别的流式中断可重试；鉴权、参数、协议错误和用户取消停止。上下文拒绝仍由 E03 的有限缩减流程处理，同样计入总请求额度。

## 等待也是运行的一部分

退避按指数增加并加入抖动，服务给出 Retry-After 时至少等待指定时间。等待超过单次允许等待或剩余 Turn 时间时停止，不能为了“更快恢复”提前请求。Ctrl-C 能取消等待。

每次尝试有独立 requestId 和编号，同一逻辑请求保持 logicalRequestId；主模型、摘要和 provider 计数共用执行器。重试通知独立于模型历史，日志只保存用途、身份、时长、类别与用量等元信息。

## 半截流为什么不能执行

收到工具参数或文本事件，不代表收到完整回复。生产入口要求 message_stop，之后仍检查 stop_reason：只有完整的 tool_use 回复才能执行工具。失败草稿在界面中明确标记，新尝试另起一段；正式历史只接受完整响应。

这只能保证本地工具不因传输重试被重放。远端模型可能已经计算过失败请求，不能承诺只计费一次；用量证据缺失时也不能猜费用。

## 可配置的限制

| 参数 | 默认值 | 环境变量 |
| --- | --- | --- |
| --max-retries | 2，最多 3 次尝试 | ZERO2AGENT_MAX_RETRIES |
| --request-timeout-ms | 120000 | ZERO2AGENT_REQUEST_TIMEOUT_MS |
| --max-duration-ms | 600000 | ZERO2AGENT_MAX_DURATION_MS |
| --max-iterations | 20 | ZERO2AGENT_MAX_ITERATIONS |
| --max-requests | 100，含模型/摘要/计数的实际尝试 | ZERO2AGENT_MAX_REQUESTS |
| --max-tool-calls | 64，含被拒调用 | ZERO2AGENT_MAX_TOOL_CALLS |
| --max-repeated-failures | 3，相同工具与参数 | ZERO2AGENT_MAX_REPEATED_FAILURES |
| --retry-base-ms | 500 | ZERO2AGENT_RETRY_BASE_MS |
| --max-retry-delay-ms | 30000 | ZERO2AGENT_MAX_RETRY_DELAY_MS |

CLI 参数覆盖环境变量。Core 的 AgentOptions.limits 使用同一校验；无效值在执行前拒绝。单次、管道、plain 与 TUI 使用相同限制，新的 Turn 重新计数。

工具批次中途耗尽额度时，其余 tool_use 会得到明确的未执行结果。相同被拒调用不能在同一 Turn 内重复打开 Approval。终端退出码与信号来自原生元信息，退出 7 不会因为输出没有 Error: 前缀而被当成成功。

时间预算是一条停止新工作的边界。正在写入的工具必须真实结算；不配合 signal 的自定义 JS 可能继续运行，不能用 Promise.race 丢掉其效果，再开放下一轮。本课不提供 Worker 或进程隔离。

## 从哪里读代码

1. [RunBudget](../../../packages/core/src/run-budget.ts)：各类额度、总时间、相同失败与拒绝。
2. [请求执行器](../../../packages/core/src/request-executor.ts)：错误分类、Retry-After、取消和尝试身份。
3. [Loop](../../../packages/core/src/loop.ts)：完整流、工具授权、批次结算与预算停止。
4. [宿主配置](../../../packages/tui/src/run-options.ts)、[展示状态](../../../packages/tui/src/runtime-state.ts)和[日志](../../../packages/tui/src/run-log.ts)：事件投影与证据边界。

技术资料：[总览](./details/00-overview.md) · [设计](./details/01-technical-design.md) · [任务](./details/02-task-list.md) · [验收](./details/03-verification-checklist.md) · [Backlog](./details/04-backlog.md)。

上一篇：[E03-S006 文件 Checkpoint](../../E03-product-foundations/S006-file-checkpoints/README.md) | 下一篇：E04-S002 大工具结果按需读取（规划）
