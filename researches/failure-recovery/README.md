# 失败恢复研究与验收

[课程规格](../../specs/E04-reliability-and-context/S001-failure-recovery/details/00-overview.md) | [SDK 研究](./anthropic-sdk.md) | [Gemini CLI 研究](./gemini-cli.md)

当前：请求/工具/时间预算、统一传输执行器、宿主配置与通知已实现，Core 439 项通过，build 通过；完整宿主与课程交付仍在进行。测试源码为 `packages/core/src/__tests__/failure-recovery.test.ts`，使用真实 Node HTTP/SSE 和生产 SDK，不使用真实远端模型。

已经验证：HTTP 有限恢复与非重试状态、服务禁止/等待头、超时关闭实际连接、等待取消、缺少 message_stop、不重放已结算工具、批次限额配对、修正参数、相同失败/拒绝、provider 计数额度，以及不配合 signal 的工具必须结算。

最终验收应在 acceptance/ 保存原始输出、源哈希、真实 PTY 和实际服务证据，并分别标明层级。当前记录不能替代未执行的宿主、页面或真实服务验收。
