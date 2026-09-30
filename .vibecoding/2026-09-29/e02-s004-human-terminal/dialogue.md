# S004 人工终端：需求原文与实施纪要

> 此页保存可核对的用户请求与实施纪要，不是逐字完整会话。实施过程经历上下文交接；不补造不可见的助理原话，不收录系统提示、凭据或原始工具日志。

2026-09-30 补充：[可见对话原文归档](../../2026-09-30/e02-s004-acceptance/visible-dialogue.md)已从服务端按明确起止消息导出；包含本轮实施到复核的用户正文与公开回复，排除内部推理、工具日志和自动通知。

[请求原文](./prompt.md) | [经验](./learnings.md) | [此前讨论](../e02-s004-discussion/dialogue.md)

## 用户纠偏

用户（2026-09-29 21:55）：

> 我的意思是核心原理是如何实现让人能进行 bash 命令的交互。
> 这些实现，你可以参考其他最好的实现给出一版方案和技术实现么？然后直接推进到实现呢

## 方案与实施纪要

1. 确认主线是人操作、模型等待，不再等待旧五问全部讨论完，也不新增模型 write_stdin 协议。
2. 参考已有 Aider、pi-mono、Gemini CLI 源码报告，选择默认 No 确认、PTY 桥接、TUI 输入独占、结束仅返摘要。
3. 在 `feat/e02-s004-human-terminal` 实现。core 宿主契约及隔离测试先完成；后续接入 TUI、独立 CLI 与 REPL，保留默认八工具行为。
4. 真 PTY 测试逐步覆盖确认、read、read -s、控制键、resize、less、readline 恢复、退出期间输入、子孙清理与真实物理断连。
5. 修复测试暴露的问题：stdin 被留在 flowing 导致 CLI 不退出；OPOST 双换行；退出期私人输入进入 Agent 的风险；根退出后的组所有权；ps 故障兜底；终端挂断后恢复阻塞；信号退出被显示为成功。
6. 锁文件仅保留精确 PTY 及其平台包。S003 旧按键测试改从输入监听就绪计时，保留原断言。
7. 完成 spec 五篇 details、原理前置、讨论回填、README/CHANGELOG/导航和复盘。

## 验证与交付纪要

- 实现验证基线 `2c7bd96`：构建通过，core 198、E2E 46、cdp-debug 1 项通过；25 项 E2E 跳过。
- 本章人工终端契约 28 项；macOS arm64 真实 PTY 验证。平台 guard 和 native 故障注入不算 Windows 实测。
- lint 0 errors / 15 warnings；变更文件格式通过，27 个其他文件的全仓格式问题保留。
- 无 API key 的独立 bash 已由工具驱动体验；未调用付费模型、未使用真实 token。
- 不把自动验证作为人工签收；未推送、未合入、未打 Tag。

详细断言及未覆盖项以[验收清单](../../../specs/E02-act-and-execute/S004-interactive-commands/details/03-verification-checklist.md)为准，失败过程与设计教训见[复盘](../../../retros/E02-S004-human-terminal.md)。
