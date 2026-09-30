# S004 交互式命令：先刷新证据，再评审五个议题

> 2026-09-28 发起，2026-09-29 凌晨汇总。阶段：调研完成、待讨论；不是设计定稿。

[完整调研](../../../researches/interactive-commands/README.md) | [决策输入](../../../researches/interactive-commands/notes/decision-inputs.md) | [原讨论 PR #12](https://github.com/alienzhou/zero2agent/pull/12)

> 后续进展（2026-09-29 晚间）：用户确认按五个顶层问题推进，并要求原理介绍前置。[继续讨论入口](../../2026-09-29/e02-s004-interactive-commands/outline.md)与[原理开篇](../../2026-09-29/e02-s004-interactive-commands/notes/00-core-principles.md)已建立；以下内容保留为调研交接时的记录。

## 用户要求和边界

用户要求一次详细、全面、参考既有格式的调研，并沉淀文档、开独立分支。此前讨论提醒需要刷新社区样本，特别加入 DeepSeek Harness、Grok Build。

本轮从 S003 已完成的 main 基线开 `feat/e02-s004-interactive-research`，没有合入或改写 PR #12 的 D01–D05，也不直接进入 spec/实现。七份主报告与广筛、实验、基线核对、决策输入均落在 researches/interactive-commands。

## 本轮做了什么

1. 读取旧调研格式、S003 实现、PR #12 固定 head 的五份讨论稿。
2. 刷新原五个源码样本，增加 DeepSeek Harness 与 Grok Build；追到 schema、注册、配置、runtime 和清理。
3. 广筛另十个产品/历史对照；对旧 Kimi 跟进迁移，记录 OpenHands 默认池的待验证张力。
4. 实际运行 12 项机制实验、4 组真实 Python/Node REPL 对照；保留首轮失败与修正。
5. 区分旧误读、真实代码变化和运行缺口，不按品牌计“多数共识”。

## Confirmed：已经具备证据的事实

| 事实 | 证据入口 |
|---|---|
| S003 的 10 秒不是静默检测，也不会自动 yield | [基线 B01](../../../researches/interactive-commands/notes/zero2agent-baseline.md) |
| detached/unref 不断开 stdin，宿主存活引用须另处理 | [E09](../../../researches/interactive-commands/experiments/README.md) |
| pipe 的 Ctrl-C/Ctrl-D 不是通用信号/EOF，EOF 可能触发处理 | [E03–E05、E12](../../../researches/interactive-commands/experiments/README.md) |
| Python/Node 显式交互模式可在 pipe 多轮运行 | [真实 REPL](../../../researches/interactive-commands/experiments/real-repls-results.json) |
| Codex 旧快照非 Windows 已默认开启 unified_exec | [Codex 旧/新对照](../../../researches/interactive-commands/codex.md) |
| DeepSeek 有可选六工具 PTY 与 Linux 等待探测 | [DeepSeek Harness](../../../researches/interactive-commands/deepseek-harness.md) |
| Grok 模型后台任务与客户端 PTY 分离 | [Grok Build](../../../researches/interactive-commands/grok-build.md) |
| 无 PTY 不是凭据安全保证，人机输入需要所有权协议 | [基线 B06/B07](../../../researches/interactive-commands/notes/zero2agent-baseline.md) |

这里的 Confirmed 是研究事实，不表示所有对应产品已现场跑通；产品源码 S 与本地机制 E 的级别见总览。

## Rejected：不能再沿用的论据

- “模型配置表写 shell_command，所以 unified_exec 默认关”。
- “会话必须一直连着，因此绝不能 detached/unref”。
- “操作系统压根不暴露输入等待信息，所有人都只绕开”。
- “无 PTY 从物理上堵死了模型写密码”。
- “EOF 比 kill 温和，所以空闲时自动 EOF 没有行为风险”。
- “把 stdin 改 pipe 并复用 OutputSink，就完成了交互回路”。
- “人写输入只是 UI 多加一条通道，不影响协议”。

否定论据不等于否定某个最终方案：pipe-only、固定 yield、小型硬上限依然是可讨论选择。

## Pending：交回 D01–D05 讨论

| 议题 | 需要确认的结果 |
|---|---|
| D01 | 选定 2–3 个真实跨轮故事；明确输入授权和人参与范围 |
| D02 | 有限 yield 的语义，是否再加静默或程序提示协议 |
| D03 | 创建入口、续写/读取/关闭操作、回执、owner 与增量输出 |
| D04 | pipe-only、可选 PTY 或 PTY-first；实际支持的平台与程序 |
| D05 | 取消/EOF/关闭的区别，寿命、配额、输出预算、退出清理 |

数值暂不拍板：不把“8 个会话”“60–120 秒空闲”从初稿抄成最终要求。

## 下一步和验证缺口

下一轮从 D01 的真实故事开始，按[决策输入](../../../researches/interactive-commands/notes/decision-inputs.md)比较方案。确认范围后再进入 spec，而非自动套用调研建议。

未验证的主要项目：Agent 产品 E2E、模型实际任务表现、Linux/Windows、秘密日志全链、压力和进程逃逸、人机接管恢复。OpenHands 默认池的输入冲突需要定向运行验证，尚不是已复现 bug。
