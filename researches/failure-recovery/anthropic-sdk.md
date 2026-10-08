# Anthropic SDK 的重试与流结束证据

| 项目 | 固定值 |
| --- | --- |
| 仓库 | [anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript) |
| Commit | b7ebb908223a9c470eb322407d97fca5f72f6f4c |
| Tag / npm | sdk-v0.52.0 / @anthropic-ai/sdk 0.52.0 |
| Commit 日期 | 2025-05-22T09:37:48-07:00 |
| 调研日期 | 2026-10-08 |

锁文件与安装包均为 0.52.0，不拿在线最新 SDK 的实现替代生产依赖。客户端默认两次重试、600000ms fetch 超时；HTTP 408/409/429/5xx 和连接错误可被内部重试，退避支持服务头和抖动。若外层再重试，实际传输次数可能大于外层观察的调用次数。

MessageStream 消费完整 SSE 后才提供 finalMessage，文本事件只是展示。连接成功后读取正文的生命周期不能只靠连接阶段的超时保护；Harness 用涵盖整个 attempt 的 signal 和计时器，且单独要求 message_stop。错误或中断的 tool_use 不执行。

本课设置 SDK maxRetries=0，并为模型、摘要和计数使用同一执行器。409 在本课保守停止；服务 Retry-After 超过预算时停止而不提前重发。请求重新计算可能产生额外供应商费用，不能从本地工具未重放推断请求只计费一次。

关键引用：

- [src/client.ts](https://github.com/anthropics/anthropic-sdk-typescript/blob/b7ebb908223a9c470eb322407d97fca5f72f6f4c/src/client.ts)：默认选项、makeRequest、shouldRetry、retryRequest、fetchWithTimeout。
- [src/lib/MessageStream.ts](https://github.com/anthropics/anthropic-sdk-typescript/blob/b7ebb908223a9c470eb322407d97fca5f72f6f4c/src/lib/MessageStream.ts)：_createMessage、finalMessage、streamEvent、message_stop。
- [官方错误文档](https://platform.claude.com/docs/en/api/errors)：状态码及 200 后仍可能发生的流式错误，2026-10-08 读取；与固定源码版本分别记载。
