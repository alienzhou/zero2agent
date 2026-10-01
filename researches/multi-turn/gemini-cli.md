# Gemini CLI：历史所有权与失败后的对话边界

## 基本信息

| 项目 | 值 |
|---|---|
| 仓库 | https://github.com/google-gemini/gemini-cli |
| Commit | `2fe7c2d3f065dc40ad573d50b2091116f8a4aa18` |
| Commit 日期 | 2026-09-25 22:50:05 +0000 |
| 最近 Tag | 当前克隆无可解析 Tag |
| 调研日期 | 2026-10-01 |

## 调研目标与结论

追踪历史容器、失败与新一轮的衔接。AgentChatHistory 统一持有历史；GeminiChat 区分普通请求失败、用户中止和已有工具响应的情况，并为未得到模型答复的工具响应补收尾消息。

## 详细分析

- AgentChatHistory 提供 push、clear、rollback 和快照投影；稳定 ID 同时用于记录与恢复，超出本课需要。
- `sendMessageStream()` 的 finally 根据中止和请求类型选择历史回滚位置，不是统一删除整个历史。
- `closeUnansweredToolResponseTurn()` 在工具响应后补 model 收尾，防止下一用户消息与工具响应意外合并为同一轮。

## 关键源码引用

- [agentChatHistory.ts：历史容器](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/core/agentChatHistory.ts)
- [geminiChat.ts：失败与收尾](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/core/geminiChat.ts#L790-L847)

Zero2Agent 采用更小的策略：已完成的工具证据保留，未完成流式响应不入历史，失败后由明确的 Harness 标记结束本轮。不引入 Gemini 专用角色、持久化 ID 和自动重试。该选择是教学取舍，不是对上游方案的等价实现。
