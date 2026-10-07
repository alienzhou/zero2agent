# E03-S006 验收证据

2026-10-08，macOS arm64 / Node v22.15.1。候选 `8fde2fecac3e2ef22e5d6d35c6e7fba4fbc074b8`；完整源哈希及每项命令见 [summary.json](./summary.json)。最终交付在此基础上只追加文档与证据。

- [offline.txt.gz](./offline.txt.gz)：575 PASS / 56 SKIP / 0 FAIL；56 为默认关闭的真实模型用例。
- [live-results.json](./live-results.json)、[live.txt.gz](./live.txt.gz)、[live-evidence](./live-evidence/)：另外 6 项真实服务全通过，0 skip；Checkpoint 的原请求、工具调用、实际文件和无新增请求证据见 checkpoint-live.json.gz。
- build.txt、e2e-types.txt、lint.txt.gz、format.txt、whitespace.txt：工程门禁通过，lint 44 warnings / 0 errors。
- checkpoint-demo.txt.gz、logging-demo.txt、session-demo.txt、runtime-demo.txt、terminal-restore.txt：新旧演示及原生 stty 恢复。
- [benchmark-first.json](./benchmark-first.json)为课程 P18 固定引用；[benchmark.json](./benchmark.json)为本轮完整基准。三模式的持久保证不等价，不能按耗时作同保证算法排名。
- [screens/capture.json](./screens/capture.json)、[原始 PTY](./screens/raw-pty.ansi.gz)：生产 CLI 的本地 SSE 演示；PNG 为 xterm.js 6.0.0 无损流重放，旁边 .txt 为去行末空白的展示副本，不作为原始终端字节。
- [课程 QA](../../../.authoring/site/chapters/epic03-story006/verification/browser-checks.json)：20 页、PC/H5 导航、展开、放大及页面哈希。

原始失败分别保存为 initial-*、terminal-restore-initial、live-initial-*、handoff-initial、readline-initial-*；second/third/pre-handoff-summary 为阶段性运行，不替代最终 summary。[失败解释](../../../.vibecoding/2026-10-07/e03-s006-file-checkpoints/failures.md)记录对应修正。gzip 为无损压缩，不清理原始控制码/空白。

复跑：`node scripts/e03-s006-acceptance-report.mjs --live`（需要现有 API 配置）；不传 --live 仅运行离线层。`--resume` 只允许源哈希完全不变且先前门禁定义不变时，从失败项继续。课程 PC/H5 自动检查另由 authoring 中 verify.mjs 执行。
