# 本课如何选择终端实现

核对日期：2026-10-07。取舍基于项目现有 Node 22、TypeScript、readline、node-pty；本轮没有做框架性能 benchmark。

## 建议先保留原生基础，补齐交互模型

现有 `human-terminal.ts` 已负责人工终端接管，`approval.ts` 复用会话输入。新增独立状态模型、输入控制器和渲染器，可以延续已有执行与隐私边界。关键目标是改善编辑输入、历史、粘贴、补全、忙时草稿、审批、取消和工具检查体验；仅增加状态日志并不足够。

| 选择 | 核实能力 | 本项目代价 | 判断 |
|---|---|---|---|
| Node readline/TTY | 行输入、SIGINT、可取消 question、游标、TTY 与 resize | 需自行管理重绘、字符宽度、焦点和草稿 | 适合当前单对话主线，但应集中管理输入与渲染 |
| Ink 8 + React | 声明式布局、useInput/isActive、raw mode、suspendTerminal | React 生命周期，迁移现有 stdin/PTY 契约 | 可行；复杂多区界面增多时重新评估 |
| OpenTUI + Solid | OpenCode 展示事件 store、dialog、焦点和 suspend/resume | 新渲染栈，需验证本项目打包与平台 | 借鉴架构，迁移不是本课先决条件 |
| Ratatui | Codex 展示 Rust TUI 和事件协议 | 增加 Rust 边界或重写宿主 | 本课作为架构对照 |

这是工程范围判断，不是原生方案在所有项目中更优。

## 原生 API 的约束

[Node 22 TTY 文档](https://nodejs.org/download/release/v22.0.0/docs/api/tty.html#readstreamsetrawmodemode)说明 raw mode 下 Ctrl+C 不再自动产生 SIGINT，当前输入所有者需处理其字节。[readline SIGINT](https://nodejs.org/download/release/v22.0.0/docs/api/readline.html#event-sigint)与 [question](https://nodejs.org/download/release/v22.0.0/docs/api/readline.html#rlquestionquery-options-callback)分别定义 Interface 生命周期与 AbortSignal 取消。取消问题不必关闭整场对话；暂停也不能当成清空排队字节。

这些 API 不决定忙时输入是否排队、如何恢复草稿和审批焦点。产品行为仍需明确设计并用真实 PTY 验证。

## Ink 已能显式交出终端

| 项目 | 值 |
|---|---|
| 官方仓库 | [vadimdemedes/ink](https://github.com/vadimdemedes/ink) |
| 调研 Commit | `26d2c3f83008142061c22267482489588cc3823c` |
| Commit 日期 | `2026-10-03T18:21:06+07:00` |
| 最近 Tag | `v8.0.0` |
| 调研日期 | 2026-10-07（Asia/Shanghai） |
| 证据级别 | 固定源码静态核对；不代表已运行该产品 |

[suspendTerminal 文档](https://github.com/vadimdemedes/ink/blob/26d2c3f83008142061c22267482489588cc3823c/readme.md#L2022-L2066)说明挂起时暂停输入/输出、恢复终端模式，结束后重绘。[实现](https://github.com/vadimdemedes/ink/blob/26d2c3f83008142061c22267482489588cc3823c/src/ink.tsx#L1352-L1382)使用 finally 恢复，并让手动 resume 幂等。[useInput](https://github.com/vadimdemedes/ink/blob/26d2c3f83008142061c22267482489588cc3823c/src/hooks/use-input.ts#L160-L174)通过 isActive 控制 raw mode 订阅。

所以不应以“Ink 不支持交接”为由排除它。选择原生基础的理由是本项目结构与本次迁移成本；Gemini 的定制 Ink 6.6.9 也不能与上游 Ink 8 混用 API 保证。

## 后续用实际场景检验

模型延迟、工具流式输出、忙时编辑、审批、取消和人工 PTY 恢复都需要真实输入测试。另测非 TTY 管道与输出重定向；宽度覆盖中文、emoji、ANSI 和 resize。没有跨终端实验前，不声称全平台视觉一致或某框架性能更高。

当产品需要复杂多面板、滚动 transcript 和可聚焦工具卡片时，用同一事件契约重新评估框架，让 core 生命周期不随渲染库变化。
