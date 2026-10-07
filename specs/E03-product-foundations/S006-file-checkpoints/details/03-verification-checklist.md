# 验收范围与交付状态

[课程](../README.md) | [跟练](../follow-along.md)

2026-10-08 完成交付门禁。被测代码/测试候选为 `8fde2fe`；最终交付只补充文档与证据，`summary.json` 保存全部 Core/TUI/E2E 源文件 SHA-256，开始/结束一致。生产恢复逻辑最后修改于 `bbca278`，readline 测试修正于 `8fde2fe`。

分支 `codex/e03-s006-file-checkpoints`，草稿 [PR #22](https://github.com/alienzhou/zero2agent/pull/22)。固定跟练 Tag `E03-S006-file-checkpoints` 对应本次交付提交；main 仍为 `4f89f40`。本课尚未合入或部署。

## 验证矩阵

| 层级 | 检查内容 | 实际结果 |
| --- | --- | --- |
| Core | 权限后捕获、拒绝/失败不执行、取消、结果配对 | 新增针对性 4 项，包含于全量 |
| 文件存储 | 字节/模式、复用、预算、冲突、损坏、锁、交接窗口与真实 SIGKILL | 12 项，包含于全量 |
| 生产 CLI/PTY | SDK 文件效果、无密钥管理、关闭保护、令牌、焦点、会话事实 | 新增 4 项，包含于全量 |
| 全量离线 | 旧工具、压缩、会话、日志、审批、终端和新能力 | **575 通过、56 默认跳过、0 失败**；Core 413、E2E 161、CDP 1 |
| 真实服务 | 运行交互 3、会话 1、日志 1、Checkpoint 1 | **6 通过、0 跳过**；实际 write_file → undo → redo，字节完全一致且管理步骤无新模型请求 |
| 工程 | build、E2E tsc、lint、改动 TS 格式、diff 空白 | 全通过；lint 0 errors / 44 warnings |
| 原生终端 | stty、正常退出、SIGTERM、SIGHUP | 通过；真实 PTY 七个画面另有无损字节与源哈希 |
| 课程 | 20 页布局、PC 1440×1000/H5 390×844、目录/文字/放大 | 全通过；site build/check 共 14 章、213 图解 |
| 演示 | 新课完整闭环 + S003/S004/S005 回归脚本 | 全通过 |
| 空间基准 | 固定种子、4 MiB 文件、20 次前部小插入、恢复完整哈希 | 三模式均通过；本轮分块文件长度 6,007,126 B，分配 6,283,264 B，保存 P50 167 ms |

## 可复查证据

- [完整门禁索引](../../../../researches/file-checkpoints/acceptance/README.md)、[summary.json](../../../../researches/file-checkpoints/acceptance/summary.json)、[复跑脚本](../../../../scripts/e03-s006-acceptance-report.mjs)。
- [真实 PTY 捕获说明](../../../../researches/file-checkpoints/acceptance/screens/capture.json)：生产 CLI + 本地确定性 SSE，在 xterm.js 重放原始字节，不冒充真实模型。
- [浏览器检查与页面哈希](../../../../.authoring/site/chapters/epic03-story006/verification/browser-checks.json)、[课程审阅](../../../../.authoring/site/chapters/epic03-story006/review.md)。
- [失败与修正](../../../../.vibecoding/2026-10-07/e03-s006-file-checkpoints/failures.md)：路径别名、stderr/HOME 兼容、真实写入末尾换行、恢复交接窗口、旧 PTY 匹配竞态、布局与原始证据空白，均保留失败附件。

真实服务通过当前配置的兼容端点；请求携带 model `claude-sonnet-4-20250514`。此名称来自请求证据，不推断端点背后的实际模型身份。真实测试使用临时合成文件，提交前检查附件及解压后的原始内容不含当前环境凭据。

## 限制与审阅

实测 macOS arm64、Node v22.15.1。未验证 Windows/Linux、网络文件系统或突然断电。故障注入与真实 SIGKILL 分开记载。哈希是内容一致性校验，不是防篡改签名；多文件恢复不是原子事务，也不能隔离任意外部写入者。

人工代码/教学审阅：尚未完成。AI 源码自查、故障注入、实际进程与自动页面检查均不能替代人工。网站未部署，PR 保持 draft；本课未执行合并。
