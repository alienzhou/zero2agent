# 验收清单与证据

2026-10-07，macOS arm64、Node 22.15.1。最终 [final-verdict.json](../../../../researches/session-persistence/acceptance/final-verdict.json) 通过，并确认生产/测试源文件 SHA-256 与完整验收运行一致。

| 层级 | 结果 | 证据 |
|---|---|---|
| 构建 / E2E 类型 / ESLint / 修改文件格式 / whitespace | 全部通过；ESLint 有既有风格警告，无错误 | [完整运行报告](../../../../researches/session-persistence/acceptance/summary.json) |
| 离线测试 | **531 通过**：Core 402、E2E 128、CDP 1；54 项真实服务测试在此层跳过 | offline.txt.gz |
| 本课新增离线 | 快照 8、存储/控制器 8、SDK/PTY 6，共 22 项 | 对应测试文件 |
| 旧 TUI 交互 | 22 项 PTY + 5 项显示状态回归通过 | runtime-tui.test.ts / runtime-tui-state.test.ts |
| 本地演示 | 会话跨进程 demo、上一课运行 demo 通过 | session-demo.txt / runtime-demo.txt |
| 终端恢复 | exit、SIGTERM、SIGHUP 后 stty 一致 | terminal-restore.txt |
| 真实模型 | **4/4 通过**：读文件、新审批、取消后续聊、跨进程回忆 | [复验 JSON](../../../../researches/session-persistence/acceptance/live-results.json) |
| 实际 TUI 显示 | 96×30 与 42×18：恢复/列表/新建/找回/继续，8 张捕获 | [capture.json](../../../../researches/session-persistence/acceptance/screens/capture.json) |
| 图文课程 | 20 页全部布局通过；PC 1440×1000、H5 390×844 阅读交互通过 | [浏览器报告](../../../../.authoring/site/chapters/epic03-story004/verification/browser-checks.json) |
| 人工代码审查 / 教学签收 | 待人工完成 | 本记录不能替代人工审查 |

## 本课要求逐项核对

- [x] 进程 A 保存，进程 B 恢复后实际 HTTP 请求包含旧消息；真实模型新问题不复述识别码，实际回答仍正确。
- [x] 恢复不调用历史工具；旧工具卡可展开查看；新写入遵守当前权限，宿主 API key 不进入文件。
- [x] 原始历史与已采用摘要恢复；摘要进入请求，被覆盖的旧助手正文不会整段重发；临时替换与后台作业不序列化。
- [x] 未知版本、损坏内容、断裂配对、错误目录、符号链接与并发写入均明确失败，当前会话不被无效候选替换。
- [x] 旧 PID 活跃时拒绝 pending 恢复；真实 PTY 工具写文件后 SIGKILL，恢复上一结算边界并提醒，实际文件保留且旧调用未重放。
- [x] 磁盘失败保留内存，失败阻止切换，/save 可在存储恢复后重试；发布 pending 期间取消不发模型请求。
- [x] --list-sessions 无需凭据；--no-save 不写入会话；选择器独占焦点并保留草稿，恢复不丢失旧交互。
- [x] 课程源码、产物、Spec、跟练、复盘、导航及长期协作约束同步。

## 失败也属于证据

首次完整运行中 live 为 3/4：真实模型把拒绝后的另一目标文件也理解成应拒绝的操作，未调用 write_file。[原始失败](../../../../researches/session-persistence/acceptance/first-live-run/live-results.json)与 requests / responses / 原始终端输出保留在 first-live-run/live-evidence/。

随后不改提示、断言、测试或生产源码，重跑四项 live，全部通过。原始 summary.json 的 passed=false 仍保留，最终组合结论由 final-verdict.json 明确引用两轮结果。不能把一次复验通过解释成模型行为完全确定。

早期三个交互时序失败和类型/lint 问题、修正原因见[失败记录](../../../../.vibecoding/2026-10-07/e03-s004-session-persistence/failures.md)。课程保留两轮失败报告，第三轮全部通过。

## 实测范围和剩余限制

没有声明 Linux/Windows 实机通过，也没有覆盖跨主机、网络文件系统或断电。崩溃只保证恢复最后结算边界，未结算轮可能已有副作用。旧 revision 保留、单份 32 MiB 限制和 hard link 要求见设计；自动保留策略与逐工具日志属于后续工作。

终端原始输出无损 gzip 保存，screens/*.txt 是清理控制码与尾空白后的展示副本；截图由真实 node-pty 输出在 xterm.js 6.0.0 重放生成，模型回应来自离线夹具。真实服务证据另存 live-evidence/，没有把两类验证混为一谈。

复现：`node scripts/e03-s004-acceptance-report.mjs --live`；仅离线可省略 `--live`。需要已安装依赖与当前真实模型配置，缺凭据或跳过 live 不算通过该层。
