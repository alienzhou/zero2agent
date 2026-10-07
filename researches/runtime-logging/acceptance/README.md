# E03-S005 验收证据索引

[Story 验收](../../../specs/E03-product-foundations/S005-runtime-logging/details/03-verification-checklist.md) · [失败与修正](../../../.vibecoding/2026-10-07/e03-s005-runtime-logging/failures.md)

最终生产/测试源码 `6ab631a12d8d21349b3e77c116dcba7381c6c4c5`，macOS arm64 / Node v22.15.1。summary.json 记录 13 项门禁、SHA-256、命令、耗时与退出码；最终 passed/sourceStable 均为 true。离线 555 通过、55 跳过；指定真实服务 5 通过、0 跳过。

| 附件 | 来源 |
| --- | --- |
| offline.txt.gz、lint.txt.gz、live.txt.gz | 完整门禁输出，gzip 无损保存 |
| live-results.json、live-evidence/ | 最终五项真实服务结果与请求、PTY、文件/日志断言证据 |
| screens/raw-pty.ansi.gz、capture.json | 实际 node-pty 原始字节及源码哈希；96×30 / 42×18 |
| screens/*.png、*.txt | 原始字节在 xterm.js 6.0.0 的回放画面与派生展示文字 |
| initial-offline.* | 第一次精确 ToolContext 兼容失败，Core 405 通过 / 4 失败 |
| second-offline-* | 第二次完整离线收尾时机竞争；旧用例单独通过，之后等待真实完成边界再全套重验 |
| first-live-*、live-retest-* | 两轮原 Prompt 的真实审批失败，均 4 通过 / 1 失败 / 0 跳过 |
| approval-clarified-* | 生产 Prompt 明确一次拒绝与新请求范围后，原失败用例专项通过；另外两项未在该专项运行 |

复现完整门禁：`node scripts/e03-s005-acceptance-report.mjs --live`，会使用真实服务并产生费用。保存前检查配置密钥；不采集真实用户人工终端私密字节。附件中的工具内容来自显式构造的临时测试文件，不能拿来声称运行日志默认采集正文。

课程图解是 SVG 教学示意，课程逐页/PC/H5 报告另见 `.authoring/site/chapters/epic03-story005/verification/`。自动验证和 AI 作者审查均不代替人工代码审查、教学审阅或用户签收。
