# Codex 请求与遥测日志

## 基本信息

仓库：[openai/codex](https://github.com/openai/codex)。调研 commit：d83bb540ec64bf6b009bca0283b0be91ea33f26a，日期 2026-10-07T12:47:04Z；调研日 2026-10-07。浅克隆无可用 Tag。仅源码阅读，未实测该构建。

## 结论与来源

- 流消费代码保存 upstream_request_id 和 Instant，消费者取消时记录 cancelled，并带同一请求身份：[client.rs#L2390-L2438](https://github.com/openai/codex/blob/d83bb540ec64bf6b009bca0283b0be91ea33f26a/codex-rs/core/src/client.rs#L2390-L2438)。
- SessionTelemetry 中 request_id、duration_ms 与 log_user_prompts 是明确字段，不需要从屏幕文字推断：[session_telemetry.rs](https://github.com/openai/codex/blob/d83bb540ec64bf6b009bca0283b0be91ea33f26a/codex-rs/otel/src/events/session_telemetry.rs)。
- TUI 禁止随意 stdout/stderr 打印，说明绘制与记录需分工：[tui/lib.rs#L1-L5](https://github.com/openai/codex/blob/d83bb540ec64bf6b009bca0283b0be91ea33f26a/codex-rs/tui/src/lib.rs#L1-L5)。

本课借鉴请求身份与状态，不采集原始正文；不声称具有 Codex 的云端追踪与所有 attempt 观测能力。
