# 来源映射

截至 2026-10-07。本课 S/T/D 资料随固定 Tag `E03-S005-runtime-logging` 保存；竞品固定版本在 researches/runtime-logging 中，不据源码阅读声称实测对应二进制。

| ID | 来源 | 说明 |
| --- | --- | --- |
| S01 | packages/core/src/diagnostics.ts、loop.ts、context-manager.ts、context-summary.ts、context-budget.ts | 操作、逻辑 SDK 请求、计数、摘要、权限与后台父身份 |
| S02 | packages/tui/src/run-log.ts | 白名单、独占文件、有界队列、只读校验、完整性提示 |
| S03 | packages/tui/src/conversations.ts、runtime-tui.ts、cli.ts；packages/core/src/tools/terminal.ts、terminal-runtime.ts | 宿主保存、查看焦点、CLI 入口与原生终端结果 |
| T01 | packages/core/src/__tests__/diagnostics.test.ts | 真实 Anthropic SDK + 本地 HTTP，历史与诊断分离 |
| T02 | e2e/src/run-log.test.ts、runtime-logging.test.ts、runtime-tui.test.ts、runtime-logging-live.test.ts | 文件效果、真实 PTY、失败/崩溃、只读与真实服务关联 |
| D01 | specs/E03-product-foundations/S005-runtime-logging/deep-dive/01-logs-and-side-effects.md | 日志缺失与副作用 / 事务日志边界 |
| D02 | scripts/e03-s005-logging-demo.mjs | 本地 HTTP/SSE + 生产 CLI/SDK/工具，含实际 401 |
| D03 | specs/E03-product-foundations/S005-runtime-logging/deep-dive/02-log-and-trace.md | 本地 ID 与分布式 Trace，逻辑调用和内部重试 |

运行元信息不等于匿名数据；正文排除不改变会话快照的正文保存规则。本课仅实测 macOS，不承诺网络卷、Windows、跨主机或断电事务；没有工具重放、文件回退或远端 exporter。耗时图是机制示意，没有假造性能数据。
