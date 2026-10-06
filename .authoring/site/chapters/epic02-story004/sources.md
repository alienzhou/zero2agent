# E02-S004 事实与来源

核验时间：2026-09-30。当前实现固定为 `b200c9fc9390be59ec52f2e48fa8e8bf9fa7c770`，发布分支 `release/e02-s004-human-terminal`。用户明确授权后，两个仓库的主 PR 均已合入 main；未打 Tag 或发布社交平台内容。此前 19:36 的功能反馈仍只代表两项试用。

最新[工程复验记录](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/.vibecoding/2026-09-30/e02-s004-acceptance/acceptance.md)：core 199、E2E 49、cdp-debug 1，共 249 通过、25 项 E2E 跳过；人工终端含 31 项，新增 TERM trap 返回 0 时 CLI 仍报告取消的契约。早期候选两轮 248 通过和工具驱动操作保留为历史证据，不混为本次全量。没有付费模型或 Linux 实测。

## 来源索引

跨仓来源固定到已公开的文档提交 `bd05019edefbbab454d05f5a65a7684aa9efac98`，其包含跟练、验收及完整源码；代码实现仍以 b200c9f 为准。已通过 GitHub 文件树核对来源路径，并单独确认跟练文档可获取。独立 ZIP 中也可使用这些公开链接，不要求本机有同级 zero2agent 目录。

- [Story 概述](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/README.md)
- [技术设计](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md)
- [当前验收清单](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/03-verification-checklist.md)
- [固定版本跟练](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/follow-along.md)
- [工具注册](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/core/src/tools/index.ts)
- [终端分流与摘要](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/core/src/tools/terminal.ts)
- [宿主交互契约](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/core/src/tools/terminal-runtime.ts)
- [CLI 与 REPL 入口](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/cli.ts)
- [运行时绑定](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/setup-terminal-runtime.ts)
- [确认、PTY 桥接及恢复](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts)
- [进程清理](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal-process.ts)
- [真实 PTY 测试源码](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/e2e/src/human-terminal-contract.test.ts)

## 逐项核验

| claim_id | 事实 | 本地相对代码／文档来源 | 类型 | 核验时间 | 已验证限制 | 对应页码 |
|---|---|---|---|---|---|---|
| C01 | 工具总数仍为 8；terminal 的 interactive: true 走人工分支，缺省保持普通执行。 | [index.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/core/src/tools/index.ts)、[terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/core/src/tools/terminal.ts) | 源码核对 | 2026-09-30 | 核对 allTools 与 execute 分支，不据此声称本轮默认路由回归通过。 | 01、06、13 |
| C02 | 人工模式在启动前显式选择，不能自动接管已运行的普通命令。 | [Story](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/README.md)、[terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/core/src/tools/terminal.ts) | 源码核对 | 2026-09-30 | 没有重连或自动检测协议；普通执行仍属旧路径。 | 02 |
| C03 | 人操作键盘，宿主经 PTY 连到 bash/子程序；模型发起时等待工具结果，没有模型续写输入工具。 | [human-terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts)、[技术设计](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md) | 源码核对 | 2026-09-30 | 图示省略操作系统细节，不意味着宿主实现终端模拟器。 | 01、02、03、06、13 |
| C04 | PTY 提供终端语义；宿主转发按键、画面与窗口尺寸。 | [human-terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts)、[技术设计](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md) | 源码核对 | 2026-09-30 | pipe 也能传输入；控制字符效果取决于程序模式，不保证所有界面协议。 | 03、04、06 |
| C05 | 入口要求 POSIX 且 stdin/stdout 均为 TTY；不满足时失败，不降级。 | [human-terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts)、[setup-terminal-runtime.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/setup-terminal-runtime.ts) | 源码核对 | 2026-09-30 | POSIX 是实现范围，实际环境证据只有 macOS；不是 Linux 兼容性验证。 | 04、11 |
| C06 | 命令与目录先展示，仅 y/yes+Enter 批准，默认拒绝；确认后才创建 PTY，同批确认尾部不转发。 | [human-terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts) confirm、runHumanTerminal | 源码核对 | 2026-09-30 | 接受大小写及首尾空格规范化；不保证跨数据块粘贴隔离。确认不是后续每条命令的审批或安全审查。 | 05 |
| C07 | 工具、--terminal、/terminal 共用人工路径；独立 CLI 不需 LLM key；REPL 仍需配置模型。 | [cli.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/cli.ts)、[setup-terminal-runtime.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/setup-terminal-runtime.ts) | 源码核对 | 2026-09-30 | 只有 CLI/REPL 省略命令时映射到 bash；工具调用的 command 不能空。 | 02、06、12 |
| C08 | 模型调用 terminal 时，仅结束元信息进入工具回执；直接 CLI/REPL 入口只在本地显示结果。输入与 PTY 正文均不进 OutputSink。 | [terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/core/src/tools/terminal.ts)、[human-terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts)、[terminal-runtime.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/core/src/tools/terminal-runtime.ts) | 源码核对 | 2026-09-30 | completed 只表示进程结束，不证明业务成功；PTY 合流不能称独立 stderr。 | 07、13 |
| C09 | 正文隔离不等于无痕或沙箱；command 可已入上下文，外部日志仍可能存在。 | [技术设计](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md)、[human-terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts) | 源码核对 | 2026-09-30 | 本层 HISTFILE 指向 /dev/null 不约束嵌套程序、写文件、滚屏或录屏。 | 07 |
| C10 | Ctrl-C/D 转交程序，Ctrl-] 由宿主拦截并中止整场接管。 | [human-terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts)、[技术设计](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md) | 源码核对 | 2026-09-30 | 键盘 Ctrl-C 不等于宿主收到外部 SIGINT；Ctrl-D 不保证关闭会话。 | 08 |
| C11 | 保存并恢复设备状态与监听；清理期输入丢弃；真实断连清理后退出。 | [human-terminal.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal.ts) acquireInput、finally、disconnect | 源码核对 | 2026-09-30 | 只恢复仍可用终端；不声称穷尽所有退出事件排列。 | 09、13 |
| C12 | 清理原进程组及已观察后代，不承诺提前脱组重挂父的进程。 | [human-terminal-process.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/human-terminal-process.ts)、[技术设计](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md) | 源码核对 | 2026-09-30 | 非沙箱；复杂守护化、宿主 SIGKILL、断电等不在保证内。 | 10 |
| C13 | 本轮 macOS PTY 复验覆盖多轮输入、按键、resize、恢复与进程清理，新增活端三信号和断连退出码。 | [当前验收清单](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/03-verification-checklist.md)、[PTY 测试源码](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/e2e/src/human-terminal-contract.test.ts) | 真实PTY测试 | 2026-09-30 | 主代理完成本轮全量与工具驱动操作，限 macOS；不当作用户签收。 | 11 |
| C14 | Linux 未实测、Windows 不支持，慢输出、极限粘贴与跨终端矩阵仍有缺口。 | [当前验收清单](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/details/03-verification-checklist.md) | 验收记录核对 | 2026-09-30 | 这行描述未验证范围，不是这些平台或场景的测试结果。 | 11 |
| C15 | 第 12 页从独立 --terminal 进入 bash，再分步启动 Node 与 less，退出程序后仍需 exit 离开 bash。 | [固定版本跟练](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/follow-along.md)、[cli.ts](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/packages/tui/src/cli.ts)、[第12页实际步骤](./12-practice.html)、[两项试用](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/try-two-features.md) | 既有真实PTY操作／源码核对 | 2026-09-30 | 42 独立标为预期输出；代码框只列要输入的内容，不是完整终端转录。main 已含本课；固定版本用于复现。 | 12 |
| C16 | 第 3 页解释输入链，13 页自解释图文；本地成稿不做已发布 CTA。 | [系列规则](../SERIES-RULES.md)、[S003 规划](../epic02-story003/CONTENT-PLAN.md)、[本课简报](./brief.md) | 编辑决策／成图核对 | 2026-09-30 | 实际 13 页，maxImages=18 为创作预算；本地制作完成不等于公开发布。 | 13 |
| C17 | 人工接管有成熟先例，但本课统一再次确认、正文不分享和退出才归还输入是自选取舍。 | [人工交互复核](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/researches/interactive-commands/notes/human-ux-verification-2026-09-30.md) | 官方文档／固定源码／局部执行实验 | 2026-09-30 | Aider 原始执行模块实跑不等于完整产品 E2E；pi 是非默认示例扩展，Gemini 为焦点切换；不混同 Codex 模型续写。 | 05、07 |
| C18 | 用户可用 Node REPL 和 less 试持续输入、中文分页搜索及退出恢复。 | [两项试用](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/try-two-features.md)、[实验记录](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/researches/interactive-commands/experiments/human-ux-smoke-2026-09-30.md) | 真实PTY操作 | 2026-09-30 | Node 得到 6，less 显式 UTF-8 后搜索/翻页正常；禁用程序历史，不代表用户本人签收。 | 01、02、08、12 |
| C19 | 用户在收到 Node REPL/less 试用说明后回复「正常」，两项功能试用通过。 | [用户反馈原文与范围](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/.vibecoding/2026-09-30/e02-s004-acceptance/user-feedback.md) | 用户反馈 | 2026-09-30 19:36 | 未补充实际终端版本、构建哈希或逐项日志；不扩展为源码审查、重复确认策略变更或发布授权。 | 11 |

| C20 | 本轮 Node n=21→42、PTY isTTY=true/pipe=false、半行输入 Ctrl-C 清空后仍在 Node、less 中文搜索/翻页/退出已操作核对。 | [本轮转录与范围](./experiments-v2.md) | 本机真实PTY/管道操作 | 2026-09-30 | 离线REPL，不调用模型；未重跑resize、信号或全部压力场景。 | 01、02、03、04、07、08、11、12 |

## 图像性质与可追踪性

13 页均由本目录 HTML/CSS 排版生成；链路、按键、时间线及进程范围是教学示意，无外部摄影、AI 生图或真实产品截图。涉及终端的页面使用转录示意、检测命令或操作步骤；第 9、10 页明确为情景/关系示例，不能作为实机测试截图引用。每页事实 ID、标题和文件名以 pages.json 为准；图内完整文字在 page-copy.md 归档。

第 7 页只保留本课回执边界；Aider 输出分享作为背景资料留在此前已核验的[官方命令文档](https://aider.chat/docs/usage/commands.html)与[固定源码](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/commands.py#L1012-L1053)。本轮删去图内竞品旁支以集中教学主线，未重新实测完整 Aider 产品。

本次发布准备重跑了上方工程全量；experiments-v2.md 保留此前示例操作证据，没有把新构建或扫描写成新的人手试用。构建、PNG 检查与 ZIP 校验见 review.md。

## 发布范围

逐提交脱敏历史、公开 npm 锁文件、HTML 语义修复与固定版本获取方式随发布分支交付。工程来源已改为固定公开链接；远端主干和文档获取已核验；zero2agent PR #13、content-generator PR #10 均已合入，不代表课程 Tag 或社交平台发布，未扩张平台与压力验证范围。
