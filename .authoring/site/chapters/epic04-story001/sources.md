# E04-S001 内容来源

实现基线 `a99f7eb`，运行时源哈希见[验收来源](../../../../researches/failure-recovery/acceptance/source-hashes.json)。最终页源码与样式哈希见[课程检查](./verification-final/checks.json)。P09是实际PTY屏幕文字的派生HTML，只去行末空白；P17日志UUID缩写属于教学重排。其余SVG是可编辑教学图，均不冒充实机截图。

| ID | 来源 | 范围 |
| --- | --- | --- |
| S01 | packages/core/src/run-budget.ts | 默认、校验、时间、计数、失败签名 |
| S02 | packages/core/src/request-executor.ts | 错误分类、等待、超时、尝试身份 |
| S03 | packages/core/src/loop.ts | 完整流、权限、配对、原生终态 |
| S04 | packages/core/src/context-budget.ts、context-summary.ts、context-manager.ts | 计数与摘要统一执行器及原有上下文边界 |
| S05 | packages/core/src/diagnostics.ts、packages/tui/src/run-log.ts | 元信息、日志字段与只读浏览 |
| S06 | packages/tui/src/run-options.ts、runtime-state.ts、runtime-tui.ts、cli.ts | 配置、草稿、重试与交互 |
| T01 | packages/core/src/__tests__/failure-recovery.test.ts | 真实 HTTP/SSE + SDK 故障验收 |
| T02 | e2e/src/failure-recovery.test.ts | 生产 CLI/PTY、文件、原生退出与日志 |
| T03 | researches/failure-recovery/acceptance/screens/capture.json 与 raw-pty.ansi.gz | 实际PTY字节、屏幕、源码和工具版本；P09显示来源 |
| D01 | scripts/e04-s001-recovery-demo.mjs | 离线跟练，真实文件和 Checkpoint 计数 |
| R01 | researches/failure-recovery/anthropic-sdk.md、gemini-cli.md | 固定源码与当前官方文档，版本分别记录 |

HTTP 与 SDK 的测试不是远端模型质量评估。半截流、输入修正和数据行来自确定性夹具；原生 terminal exitCode 和文件效果真实运行。真实服务三项通过，原始PTY与最终逐页审阅结果在review.md和课程验收页记录。人工审查、main合并及网站部署尚未进行。
