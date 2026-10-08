# 验收结果与证据

[课程](../README.md) | [跟练](../follow-along.md)

2026-10-08，macOS/darwin、Node22.15.1、pnpm9.15.9、锁定SDK0.52.0。实现基线a99f7eb；最终运行时字节与原始报告哈希见[来源清单](../../../../researches/failure-recovery/acceptance/source-hashes.json)。课程与文档随后收尾，没有修改该基线的运行时逻辑。

## 工程与运行

| 层级 | 结果 | 证明范围 |
| --- | --- | --- |
| build | 通过 | 全部workspace构建，生产CLI产物 |
| pnpm test | 620通过 / 57跳过 | Core446、E2E173、CDP1；离线全仓旧能力及新故障矩阵 |
| E2E tsc | 通过 | E2E TypeScript静态检查 |
| lint | 0错误 / 44既有警告 | packages/e2e；本课新增警告已处理 |
| 改动TS格式 | 通过 | 全部本课改动packages/e2e .ts |
| SDK专项 | 33通过（包含在Core） | 真HTTP/SSE、断连接、结束证据、重试头、鉴权/协议停止、取消和额度 |
| CLI/PTY专项 | 12通过（包含在E2E） | 单次、plain、管道、TUI、配置覆盖、文件、Checkpoint、exit7和取消后新Turn |
| 真实服务 | 3通过，单独运行 | 本课故障注入真实写入；原日志只读；原Checkpoint回退/恢复 |
| 真实PTY | 成功取证 | 等待20s时取消、未完成草稿、窄屏、日志身份与焦点；原始ANSI无损保存 |
| stty恢复 | 3路径通过 | 正常exit / SIGTERM / SIGHUP，模式与后续canonical输入恢复 |

原始输出：[全仓](../../../../researches/failure-recovery/acceptance/offline-confirmed.txt)、[构建](../../../../researches/failure-recovery/acceptance/build-final.txt)、[类型](../../../../researches/failure-recovery/acceptance/e2e-types-confirmed.txt)、[lint](../../../../researches/failure-recovery/acceptance/lint-final.txt)、[格式](../../../../researches/failure-recovery/acceptance/format-rerun.txt)。跳过的57项是未开启真实服务的测试，不宣称全部live矩阵已运行。

## 必须成立的契约

- 可重试状态408/429/5xx、连接错误、超时、识别出的流式中断有限恢复；鉴权、参数/协议、取消、预算停止。x-should-retry:false优先，Retry-After不能提前缩短。
- SDK隐藏重试关闭；主模型、摘要与provider计数的每次attempt消耗统一请求额度，逻辑与实际身份分别记录。
- 缺少message_stop时工具不执行，半截草稿不进正式历史；失败显示与新尝试区分。
- 后续请求失败不重放已结算工具。批次限额仍保留全部配对；相同错误停止，修正作为新调用重新授权。相同审批拒绝与人工终端declined不重复接管。
- terminal真实exitCode=7属于失败，即使没有Error:正文；取消与错误不解释为效果回滚。不配合signal的工具可能晚到写入，未结算时仍拒绝新run。
- Session原史、压缩、权限、保存、日志隐私/兼容及Checkpoint边界由全仓回归和选定真实服务分别验证；诊断不采集正文或人工终端字节。

[真实服务本课证据](../../../../researches/failure-recovery/acceptance/live/failure-recovery-live.json.gz)核对4次本地HTTP、2次远端成功响应、1条write_file Checkpoint和实际文件字节；500/503由本地代理注入，不冒称自然供应商故障。[日志回归](../../../../researches/failure-recovery/acceptance/live/runtime-log-live.json.gz)及[文件回退回归](../../../../researches/failure-recovery/acceptance/live/checkpoint-live.json.gz)单独保留。

[PTY元信息](../../../../researches/failure-recovery/acceptance/screens/capture.json)、[原始字节](../../../../researches/failure-recovery/acceptance/screens/raw-pty.ansi.gz)和[stty报告](../../../../researches/failure-recovery/acceptance/terminal-restore.json)区分实际运行与PNG/txt派生画面。

## 课程与交付

18页包含封面。site:build/check通过（15章229页），本课作者源、实际18份HTML、pages.json与检索目录一致。逐页边界和PC/H5导航、放大、文字检查通过，详见[最终报告](../../../../.authoring/site/chapters/epic04-story001/verification-final/checks.json)及[作者审阅](../../../../.authoring/site/chapters/epic04-story001/review.md)。

Spec五篇、跟练、两篇延伸、复盘、协作/失败记录、四课计划及上下游导航已补齐。最终Tag/PR状态记录在[交付审计](../../../../.vibecoding/2026-10-08/e04-s001-failure-recovery/completion-audit.md)，人工审查、main合并和网站部署独立追踪。

## 已知复测与范围

原始失败均保留：旧契约断言修正、单次日志不可用未复现、慢shell夹具超过5秒采集窗口，以及课程布局/取证脚本修正。默认pnpm test最终620项通过；没有放宽生产时限、失败语义或部署格式。日志偶发原因尚未定位，不能把复测成功写成故障已修复。

只验收当前macOS及当前配置服务，不扩张Windows/Linux或所有供应商。任意JS硬终止、跨进程继续、外部幂等和单次计费保证均不属于本课。
