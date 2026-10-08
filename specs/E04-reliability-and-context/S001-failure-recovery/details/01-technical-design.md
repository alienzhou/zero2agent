# 失败恢复与预算设计

[课程](../README.md) | [决策](../../../../.discuss/2026-10-08/e04-s001-failure-recovery/decisions/D01-request-and-effect-boundaries.md)

RunBudget 使用单调时钟管理总时间，组合用户 signal 与本地预算 signal。迭代、传输请求和工具调用在开始前消费各自额度；不将一次模型重试计为新的推理迭代。工具失败签名只保留本 Turn 内的有界哈希，日志不保存参数。达到限制后保留原始结果并以 RunBudgetError 退出。

RequestExecutor 接受请求 purpose、正文和执行回调。逻辑身份固定，实际尝试分别建立诊断 span；SDK maxRetries=0，每次等待覆盖响应正文和 SSE 整个生命周期。错误分类与 Retry-After 解析独立；退避可取消且不得超出预算。计数和摘要使用同一执行器，仍保留 ContextBudget 的硬输入边界与摘要专属限制。

完整流结束之前只发送展示事件。失败的草稿与新尝试分段，正式历史只接受收到 message_stop 的完整回复。总时间停止会取消压缩与请求，但工具执行不被 Promise.race 抛弃；批次内剩余调用生成未执行结果。

结构化重试事件包含用途、逻辑身份、尝试、等待与错误类别。日志继续元信息白名单，旧日志兼容；新事件字段由读取器验证。CLI 参数和环境变量映射到同一 RunLimits 校验，plain、TUI 与单次共享策略。
