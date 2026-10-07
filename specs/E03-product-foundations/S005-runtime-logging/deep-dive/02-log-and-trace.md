# 从本地身份到分布式 Trace

[本课](../README.md) | [研究对照](../../../../researches/runtime-logging/README.md)

本课的身份已经能连接本地链路：run → operation → request → tool，session 横跨多个 run。若服务跨机器，你还需要将父身份随请求传递，并定义哪个组件对哪一段事实负责。

## 日志与 Span 的差别

一行日志是一条观察；span 表示有起止、父身份和持续时间的一段工作。一次 request/start 与 request/completed 可以组成一个 span，但请求失败、取消或记录丢失时，也可能无法闭环。

本课的 requestId 是本地逻辑 SDK 调用 ID；providerRequestId 只在 SDK 响应实际提供时保留。二者来源不同。SDK 内部重试可以产生多个服务端请求，本课没有截获每次 HTTP 尝试，因此不能把一对日志说成完整网络 attempt 轨迹。

## 后台工作的父关系

用户轮次结束后，摘要和后台命令仍可能运行。若完成时读取「当前 operationId」，它们会被挂到后来的一轮。本课在发起时捕获 session/operation/request 身份；新的轮次不会改写旧闭包。

跨进程恢复也一样：对话恢复的是 sessionId，宿主新建 runId。把进程身份假装恢复成旧 ID，会混淆两次独立运行和故障现场。

## 若接入 OpenTelemetry

后续可以把操作与请求映射成 span，增加父子关系和 exporter，接收后台完成后统一结算。仍要明确正文采集、保留策略、采样与 flush 失败的承诺。不能因为接了云端，就把原始 prompt 和工具结果全部发送出去。

[Gemini 官方遥测文档](https://geminicli.com/docs/cli/telemetry/)把启用、输出位置与 prompt 采集分别配置；[本课 Codex 研究](../../../../researches/runtime-logging/codex.md)展示请求 ID、耗时和取消的代码来源。本课尚未实现这些产品的云端 exporter、跨服务传播或生产平台。
