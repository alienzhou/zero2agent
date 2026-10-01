# pi-mono：会话状态与运行生命周期

## 基本信息

| 项目 | 值 |
|---|---|
| 仓库 | https://github.com/badlogic/pi-mono |
| Commit | `11894012dd461232eb075bc890538b6866860a10` |
| Commit 日期 | 2026-09-28 17:21:20 +0200 |
| 最近 Tag | 当前浅克隆无法解析该提交的祖先 Tag |
| 调研日期 | 2026-10-01 |

## 调研目标与结论

追踪跨轮历史归属、并发／重置和失败结果。Agent 持有 state，Loop 接收快照；最终消息事件写回历史。流式 UI 状态与已完成消息不是同一个东西。

## 详细分析

- `reset()` 与 `prompt()` 都检查 activeRun，防止清空或第二轮输入插入尚未结束的执行。
- `createContextSnapshot()` 复制消息顶层数组。`message_end` 追加最终消息，失败由带 error/aborted 状态的消息表达。
- `failToolCallsFromTruncatedMessage()` 为截断响应中的每个调用生成错误结果，而不执行可能缺字段的参数。

## 关键源码引用

- [agent.ts：reset / prompt](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/agent/src/agent.ts#L355-L380)
- [agent.ts：快照与生命周期](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/agent/src/agent.ts#L460-L579)
- [agent-loop.ts：截断工具调用](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/agent/src/agent-loop.ts#L469-L500)

Zero2Agent 借鉴运行互斥和截断不执行，但不照搬事件驱动状态机及队列。源码阅读不代表产品交互验收。
