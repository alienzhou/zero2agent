# E03-S003：验收清单

[课程](../README.md) | [任务](./02-task-list.md)

2026-10-07 最终验证：**509 项离线通过（Core 394 + E2E 114 + cdp-debug 1），53 项真实模型用例默认跳过；本课真实模型定向复验 3 项通过**。TUI 的 27 项包含在 E2E 中。构建、E2E 类型、格式、demo、课程检查、3 条真实终端恢复路径通过；仓库 lint 为 0 error / 原有 15 warning，最终改动的 live 测试额外显式 lint 通过。

[最终验证记录](../../../../researches/runtime-tui/acceptance/final-verification.json)核对生产源码与完整回归时的哈希一致；只修改 live 测试的有限确认对话后定向复验，没有重复跑整库。[证据索引](../../../../researches/runtime-tui/acceptance/README.md)保留各次失败与修正。确定性响应、真实 PTY、真实模型和人工审查分开记录。

| ID | 要求 | 权威证据 | 状态 |
|---|---|---|---|
| R01 | 每 Turn 身份与 seq、同名工具独立状态、文本/通知分离 | Core 单元 + 真实 SDK SSE | 通过 |
| R02 | 观察者不能篡改执行，迟到事件不覆盖新 Turn | Core 与 reducer 测试 | 通过 |
| R03 | 请求/审批/计数/压缩/工具各阶段取消 | 单元、SSE 断连与进程存活检查 | 通过 |
| R04 | 中断批量调用配对、已完成副作用保留、续聊 | 历史与下次请求正文、文件效果 | 通过 |
| R05 | TUI 流式阶段、工具状态、输入编辑、滚动与尺寸变化 | 真实 PTY 与终端屏幕检查 | 通过 |
| R06 | 审批全文/拒绝/默认否/超时/取消/连续调用 | 真实 CLI/PTY + 文件副作用 | 通过 |
| R07 | 人工 PTY 独占与恢复、私密正文不入请求 | 双层 PTY + API 请求审计 | 通过 |
| R08 | Unicode、恶意控制字符、窄终端与退出恢复 | renderer 测试 + PTY | 通过 |
| R09 | 单次、管道、plain、旧全量回归 | 构建、全量测试、lint、格式 | 通过 |
| R10 | 真实模型实际 CLI 流程 | 独立 live 测试与脱敏记录 | 通过 |
| R11 | 四竞品固定来源、五篇 Spec、正文、跟练、复盘及导航 | 逐项文档审阅与链接检查 | 通过 |
| R12 | 在线图解、来源对应、PC/H5 可读性 | site:build/site:check、逐页审阅 | 通过 |
| R13 | 提交、PR、固定跟练版本 | Git、远端 PR 与 Tag | 待推送 |

平台范围按实测记录；未执行的平台或人工审阅不能标成已通过。

## 证据入口

- R01–R04：`runtime.test.ts`、`runtime-sdk.test.ts`、`terminal-cancellation.test.ts`，完整回归日志保留于验收目录。
- R05–R08：[交互兼容矩阵](../../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/interaction-compatibility.md)、真实 TUI/PTY 测试、8 个终端画面与 `terminal-restore.txt` 的 stty 比较。
- R09–R10：[完整门禁及定向重验](../../../../researches/runtime-tui/acceptance/README.md)，不是仅用模型自述判定成功。
- R11–R12：[研究索引](../../../../researches/runtime-tui/README.md)、[18 页课程复核](../../../../.authoring/site/chapters/epic03-story003/review.md)，另经主代理在内嵌浏览器检查 PC/H5、目录、文字展开与放大恢复。
- [TUI / 文档交叉审查](../../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/review.md)与[Core 交叉审查](../../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/core-review.md)均为 AI 审阅。人工审查、合并及站点部署尚未执行。
