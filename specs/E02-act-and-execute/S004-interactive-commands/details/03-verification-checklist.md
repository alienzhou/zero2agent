# E02-S004：验收检查清单

> 当前实现：`b200c9fc9390be59ec52f2e48fa8e8bf9fa7c770`，脱敏发布分支 `release/e02-s004-human-terminal`。本机工程复验、源码专项复核已完成；用户已明确授权提交推送并合入 main，PR #13 已完成合并；未打 Tag。下面区分自动测试、工具驱动操作、用户反馈和未验证范围。

2026-10-05 在 E03 功能分支补验：真实 MiniMax-M2.7 请求人工接管、确认后执行、虚构私密输入写盘、终端正文不进入模型请求及下一轮回执均通过；新增跨课 CLI/SDK/PTY 契约 5 项通过。两课真实模型套件共 3/3 通过，完整离线回归 389 通过、28 live 跳过。E02 生产代码未修改；E03 摘要兼容缺陷已修复。详见[真实 E2E 验收](../../../../.vibecoding/2026-10-05/e02-e03-real-e2e/acceptance.md)。

发布时复验：完整离线回归 249 通过（cdp-debug 1、core 199、E2E 49），25 项真实模型用例跳过；人工终端 31 项含 TERM trap 返回 0 时宿主取消仍返回非零的回归。此前候选的两轮结果保留在下表，不能混为最新测试轮次。详见[脱敏发布复验](../../../../.vibecoding/2026-09-30/e02-s004-acceptance/acceptance.md)。

[Story](../README.md) | [总览](./00-overview.md)

## 功能验收

| 检查项 | 优先级 | 证据要求 | 状态 |
|---|---|---|---|
| interactive 进宿主，缺省/false 走旧路径 | P0 | core 契约单测 + 两项真实命令回归 | 通过 |
| 无 LLM key 可用 --terminal，空命令进 bash | P0 | 独立 CLI/PTY；空命令工具驱动演示 | 通过，非用户人工验收 |
| /terminal 返回后 Agent 可收完整新输入 | P0 | 真实 CLI REPL 连续两次接管后 exit；readline fixture 接收 AFTER | 通过 |
| y/yes+Enter 批准，空/n/其他/Ctrl-D 拒绝且不执行 | P0 | 检查活动提示与工作区无副作用文件 | 通过；Ctrl-D 是控制键，不冒充物理 EOF |
| read 多轮输入、bash 持续接受命令 | P0 | 两轮 read、isatty、/dev/tty；交互 bash 后退出 | 通过 |
| Ctrl-C/Ctrl-D 到程序，Ctrl-] 中止会话 | P0 | SIGINT trap、信号退出、read EOF、忽略 SIGINT 的进程树 | 通过 |
| 正常结束、spawn 失败后恢复终端 | P0 | 两次接管前后 stty、raw、paused、data/keypress 监听身份比较；故障恢复后新输入 | 通过；不声称穷尽所有异常组合 |
| 虚构输入/输出不进模型回执、OutputSink、输出日志 | P0 | core 白名单回执与不走普通执行断言；真实 read -s、history、文件检查 | 通过，限 Zero2Agent 交互路径 |
| status/exitCode/signal 区分完成、非零、取消 | P0 | core 元信息断言；真实退出 23、信号退出 130，不能附带 Exit code: 0 | 通过 |
| 退出接管后受管进程不存活 | P0 | 普通后台后代、扫描间创建的 HUP-ignoring 后代、取消与物理断连 | 通过，限原组和已观察后代 |
| resize 后 stty size 与尺寸一致 | P1 | 从 24×80 改为 37×101 | 通过 |
| 行编辑、中文、批量输入 | P1 | 方向键/删除键得到 AB，中文原样返回；确认同批尾部被丢弃 | 已测场景通过；未穷尽 IME/粘贴协议 |

## 边界场景

| 检查项 | 优先级 | 说明 | 状态 |
|---|---|---|---|
| 非 TTY 入口 | P0 | 真实 pipe CLI 拒绝且不执行；源码分别检查 stdin/stdout | 通过；未单独穷举仅一端重定向组合 |
| Windows、宿主缺失、PTY 启动失败 | P0 | 平台 guard 模拟、core 缺失钩子测试、native spawn 故障注入 | 通过；不是 Windows 或 native 安装矩阵实测 |
| 无效/越界 workdir | P0 | core 拒绝且宿主钩子未调用 | 通过 |
| 确认与命令输入同批到达 | P0 | yes 后尾部不送子进程；后续独立 token 才被读取 | 通过 |
| 反复接管 | P0 | 两次接管无监听累积或 stty 漂移 | 通过；退出事件的所有排列未穷举 |
| 清理期间私人输入 | P0 | 在 teardown 窗口送入假 token，恢复后只接收新输入 | 通过 |
| 外部终止与实际断连 | P0 | 活端 SIGINT/TERM/HUP 检查 130/143/129、完整 termios、RESET、两个有效 fixture PID 消失；物理关闭外层 PTY 检查 129 | 通过；断连时退出，不声称恢复消失的设备 |
| ps 扫描失败 | P0 | 真实 spawn 后注入扫描故障，原组仍清理，结果报告失败 | 通过 |
| 高速输出尾部 | P1 | 4000 行与末尾 marker 全部出现 | 通过；不证明所有队列内存有界 |
| 慢 stdout、UTF-8 任意分段、极限粘贴 | P1 | 专门的压力和分段测试 | 未完成，保留缺口 |
| pager 或全屏程序退出 | P1 | 真实 less 退出与最终输出；readline 恢复另测 | 已测场景通过；未做跨终端画面/鼠标协议验收 |

## 环境与证据记录

环境：macOS 14.7.8 arm64、Node.js 22.15.1、pnpm 9.15.9、`@lydell/node-pty@1.2.0-beta.15`。PTY 测试依赖 Python 3、bash、ps、stty 与 less。

| 命令 | 结果 |
|---|---|
| `pnpm build` | 通过 |
| `E2E_LIVE=0 pnpm -r --workspace-concurrency=1 run test --no-file-parallelism` | 最终代码连续两轮：cdp-debug 1、core 199、E2E 48 通过；每轮 E2E 25 跳过 |
| 人工终端契约套件（包含在 E2E 中） | 30 项通过，包含新增活端信号与物理断连退出码断言 |
| drain 定向参数化回归 | 普通/固定慢环境 2 项通过；先预热真实环境缓存，原 ≥1800ms / <3500ms 阈值不变 |
| `pnpm lint` | 0 errors、15 warnings；并非零告警 |
| 本轮变更 TS/MJS 的定向 Prettier 检查 | 通过 |
| `pnpm format:check` | 未通过：27 个本轮未改动文件存在历史格式问题，未进行无关格式重写 |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过；只证明锁与依赖解析，不代替 native 运行验证 |

测试入口：[人工终端契约](../../../../e2e/src/human-terminal-contract.test.ts)、[core 交互隔离](../../../../packages/core/src/tools/__tests__/terminal-interactive.test.ts)、[默认路由回归](../../../../packages/core/src/tools/__tests__/terminal-routing.test.ts)。S003 取消、跳过和输出契约包含在 core 回归中。此次未运行付费模型或原有 live suites；实际 REPL 测试仅运行本地斜杠命令，无模型请求。

独立入口另由工具驱动真实 PTY 演示：不带 API key 启动 `node packages/tui/dist/cli.js --terminal`，确认后输入 `printf 'manual-ok\n'; exit`，输出 marker 并以 0 退出。这不是用户在常用终端里的人工签收。

9 月 30 日另完成姓名输入、同一 bash 状态 42→84、第二次接管 read -rs 只显示虚构 token 长度 15、返回 Agent 后 exit，以及 Ctrl-] 中止 sleep 的实际操作。独立源码复核发现并关闭了「活终端外部 SIGHUP 漏显示恢复」；新用例先复现失败，再验证修复。详细红绿证据、命令与范围见[本轮复验记录](../../../../.vibecoding/2026-09-30/e02-s004-acceptance/acceptance.md)。

此前一次全量 Core 曾因冷环境加载混入 drain 计时而失败，不能删去该历史后只报告重跑成功。受控慢 shell 复现与修复已经入库。固定版本及可直接操作的用户签收步骤见[跟练与人工验收](../follow-along.md)。

用户试用结果：在收到 Node REPL 与 less 两项说明后，用户于 2026-09-30 19:36 回复「正常」，记为两项试用通过；[反馈记录](../../../../.vibecoding/2026-09-30/e02-s004-acceptance/user-feedback.md)保留原文与范围。没有另行提供逐项日志、终端版本或代码审查结论。Linux、Windows、真实认证流程及其他终端应用矩阵未实测。

## 已知限制

只支持 POSIX 真实 TTY；不保证复杂守护化逃逸、宿主 SIGKILL 或断电后的清理。控制字节语义由程序模式决定。不采集正文不等于外部程序不记录；command 仍可能在上下文中。控制终端读探测遇到资源耗尽等错误会保守跳过恢复，不是所有 stdin/stdout 状态的健康证明；两项用户试用通过不扩展为完整终端兼容矩阵通过。

## 优先级定义

- P0：发布门槛，未通过不能宣称完整交付。
- P1：应检查的兼容性与体验，缺口须说明。
- P2：扩展压力验证，不据此扩张支持范围。
