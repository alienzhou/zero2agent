# 交互式命令调研：会话、输入与终端控制

> 源码取证：2026-09-28；实验复测与汇总：2026-09-29 凌晨（Asia/Shanghai）。服务 E02-S004，只做调研，不把候选方案升级为已确认决策。

[S003 调研](../terminal/README.md) | [Epic 2](../../specs/E02-act-and-execute/README.md) | [S004 讨论 PR #12](https://github.com/alienzhou/zero2agent/pull/12)

## 结论先行

S004 值得继续，但不能沿用“只把 stdin 从 ignore 改成 pipe，再复用已有兜底”的论证。新增能力的中心是：**后续输入取决于运行中输出时，如何把控制权交回模型，再安全地操作同一个进程。**

本轮完成 7 个核心产品的源码深挖、10 个补充样本的分层广筛，以及 12 项机制实验和 4 组真实 REPL 对照。核心报告每篇记录完整 SHA、注册与默认配置、调用链、生命周期、安全边界和未验证项。没有安装并运行这些 Agent 产品；产品能力均为源码或官方文档证据，不冒充端到端实测。

最重要的发现：

1. **Codex 的“默认关闭交互”是旧推断错误，不只是版本过时。** 旧快照在非 Windows 已默认开启 unified_exec；当前相关 feature 默认开启，但 `tty=false` 仍关闭普通 stdin。会话可续接和输入可写是两个开关。
2. **DeepSeek Harness 确有模型多轮交互 PTY，但它是可选六工具组合。** 普通默认 bash、minimal 持久 bash、模型终端工具、人工 Web 终端是四条不同链；插件架构本身不证明任何一条默认可用。
3. **Grok Build 没有因出现终端/PTY API 就让模型获得 stdin。** 本地模型命令关闭输入，后台 task 可读/等/停；客户端 PTY 是另一套接口。Grok 包含 Codex/OpenCode 移植部分，不能按品牌数重复计为独立共识。
4. **“大家都不检测输入等待”也不成立。** DeepSeek 在 Linux 上检查系统调用、前台进程组和终端设备；其他平台及探测不可用时走提示协议、静默和绝对时限。可移植性不足不等于绝对不可观察。
5. **pipe 可满足一部分真实多轮场景，但需要正确启动方式。** Python `-i -q`、Node `--interactive` 在 pipe 下均完成两轮往返，补强实验还检查变量保留和 EOF 后直接子进程正常退出。默认模式在 200ms 窗口无结果，关闭输入后才观察到结果；不单凭静默确定内部原因。PTY 改变的还有提示缓冲、控制终端、回显和信号语义，不只是行编辑。
6. **输入、EOF、取消、回收不能共用一个含糊语义。** Ctrl-C/Ctrl-D 在 pipe 中是字节，raw PTY 中也未必产信号；EOF 可以触发处理积累输入。无 PTY 与 no-echo 都不构成秘密保护。

## 阅读导航

| 要回答的问题 | 文档 |
|---|---|
| 从哪里开始继续讨论？ | [先读核心原理，再讨论五问](../../.discuss/2026-09-29/e02-s004-interactive-commands/outline.md) |
| 当前七家到底怎么做？ | 下方能力矩阵及各产品报告 |
| 还有哪些新方案或反例？ | [补充样本广筛](./landscape.md) |
| 初稿哪些前提已被本项目代码反驳？ | [S003 基线核对](./notes/zero2agent-baseline.md) |
| 哪些结论实际跑过？ | [实验说明、失败记录与复测](./experiments/README.md) |
| 下一轮 D01–D05 应该讨论什么？ | [选项、验收与决策输入](./notes/decision-inputs.md) |
| 版本与引用如何复核？ | [源码版本清单](./sources.json)、[验证记录](./notes/verification.md) |

## 范围、证据和方法

沿用项目 `repo-research` 格式：产品身份和版本 → 工具契约 → 注册与默认配置 → 执行调用链 → 生命周期与安全 → 测试证据 → 对课程的启发。

本轮分三层：刷新 OpenCode、Codex、pi-mono、Gemini CLI、Aider；补充 DeepSeek Harness、Grok Build；广筛 Cline、Goose、Kimi Code、OpenHands SDK、Roo Code、mini-swe-agent、Qwen Code，以及 Claude Code、Cursor、VS Code/Copilot 的官方契约。其中 Roo 是历史对照，旧 Kimi 仓只作迁移证据，不计为另一份当前实现。

“全面”指本章决策维度覆盖完整，不意味着穷尽市场、每个 fork/MCP 插件、每套发行配置或所有操作系统。范围不包含模型榜单、价格评测和产品营销对比；这些不能直接回答 S004 的机制选择。

证据分级：

- **S**：固定 commit 的源码、配置或测试文本已阅读；测试存在不等于本轮执行过。
- **D**：官方文档或发布说明；只能证明公开契约，不能证明内部实现。
- **E**：本轮实际执行的受控实验，注明平台、命令、观察和边界。
- **U**：未核实或条件不足，保留为缺口，不用推断补齐。

每项能力分别检查「源码存在、工具注册、配置可用、默认启用、实际运行」。工具支持 PTY 不等于允许模型续写；人类接管也不等于秘密不会进入日志。

检索通过社区搜索发现线索，关键事实回到官方仓库或官方文档。第三方文章不作为默认值、支持状态或版本变化的最终证据。五个旧样本均追到旧 SHA；区分“文件真的变了”“旧报告遗漏分支”“只有新观察、不能推断新增”。

## 七个核心样本与固定版本

| 样本 | 本轮 SHA（短写，完整见分报告） | 分支／版本 | 重点 |
|---|---|---|---|
| [Codex](./codex.md) | `69f714055918` | main；浅克隆无可达 tag | 模型 PTY、默认注册、续写审批、跨 turn 存活 |
| [OpenCode](./opencode.md) | `ad6c72c70688` | dev；浅克隆无可达 tag | 模型 bash 与独立 UI PTY 分离 |
| [pi-mono](./pi-mono.md) | `11894012dd46` | main；v0.87.1 | 最小执行器与显式人工交互扩展 |
| [Gemini CLI](./gemini-cli.md) | `2fe7c2d3f065` | main；浅克隆无可达 tag | 人参与 PTY、后台观察、平台清理 |
| [Aider](./aider.md) | `5dc9490bb35f` | main；v0.86.3.dev | pexpect 人接管与确认分支；HEAD 与旧快照相同 |
| [DeepSeek Harness](./deepseek-harness.md) | `4878cdabd87d` | master；dsh-v0.2.0-rc.1 | 可组合的六工具 PTY、就绪判断、资源所有权 |
| [Grok Build](./grok-build.md) | `f0e3be1100ef` | main；浅克隆无可达 tag | 后台任务、客户端 PTY、移植血缘 |

Grok 的 `SOURCE_REV=036a5d8348cd744767cd0b08518ab17bf608fa7f` 是内部来源标识，不是公开 HEAD。版本观测不保证发布二进制与仓库完全一致；没有可达 tag 也不表示产品从未发布。

## 核心能力矩阵

下表为 S 级源码结论，“默认”只适用于分报告注明的入口和配置前提。

| 维度 | Codex | OpenCode | pi-mono | Gemini CLI | Aider | DeepSeek Harness | Grok Build |
|---|---|---|---|---|---|---|---|
| 模型启动命令 | exec_command | bash，V1/V2 | bash | run_shell_command | 回复代码块，非此类 tool schema | 默认 bash；可选 terminal_* | run_terminal_command |
| 模型向存活进程续写 | 有，显式 tty | bash 无 | 默认 bash 无 | 无内置续写 schema | 无 | 可选 terminal_send | 默认本地模型链无 |
| 普通执行 stdin | 关闭 | ignore | ignore；旧 WSL 写命令后 end | pipe fallback 为 ignore | subprocess 继承父 stdin | 默认普通 bash 为 ignore | null |
| PTY 与人输入 | 模型可写；人接管完整链 U | 独立 UI 终端，不是 bash 会话 | 示例扩展继承宿主终端 | 人向运行中 PTY 输入 | child.interact | 可选模型 PTY；另有人用终端 | 独立客户端 PTY API |
| 自动早返回 | yield + session_id | bash 无会话 yield | 默认 bash 无 | 后台化返回 | 无，同步人操作 | 普通 bash/job；terminal send/wait reason | 自动／显式后台 task |
| 模型后续观察 | 空 write_stdin 消费 pending | bash 完成后返回 | bash 完成后返回 | list/read 后台日志 | 完成后确认分享 | terminal_read 与 job_output | output/wait 工具 |
| 模型显式关闭输入 | 无独立 schema | 无 | 无 | 无 | 无 | 无 PTY half-close schema | 无 |
| 生存所有者 | Codex session service | bash scope；PTY Location | 当前执行；扩展同步 | execution/session 历史 | 当前同步调用 | exact Agent／人工 Session 分开 | actor task owner／独立 PTY registry |
| 真正产品 E2E | 未运行 | 未运行 | 未运行 | 未运行 | 未运行 | 未运行 | 未运行 |

“无模型 stdin 工具”只描述当前内置链，不代表模型永远不能通过自行构造其他命令、安装插件或外部服务实现类似能力；本轮不把这些旁路混入产品原生契约。

## 跨样本发现

### 1. “交互式”至少有五个独立维度

| 维度 | 必须问清的问题 | 混淆后的常见误判 |
|---|---|---|
| 输入来源 | 模型、人、一次性脚本，还是程序间协议？ | 有人工终端就算模型可续写 |
| 传输方式 | closed stdin、pipe、PTY、继承终端？ | 看到 pipe/PTY 依赖就算工具可用 |
| 执行会话 | 每次新进程、保留 cwd、还是保留同一活进程？ | 持久 shell 状态等于原始 stdin 续写 |
| 控制权 | 工具完成、yield、交还人，还是只推 UI 事件？ | 流式 UI 等于模型已能作出下一步输入 |
| 所有权 | 对话、Agent、工作区、IDE、整个服务？ | 知道 ID 就有权读写和清理 |

DeepSeek 的四入口、Grok/Kimi 的双执行平面、pi 的 user_bash 扩展，都是这些轴不重合的具体证据。

### 2. 没有一种“行业默认”可以直接照抄

Codex 当前可续接工具默认开启，创建时却默认不分配 PTY；Gemini CLI 的交互设置默认 true，但 core 缺省 false，最终还看宿主；Grok 库 auto-background 默认 false，产品合并后默认 true；DeepSeek 通过 profile 组合区分能力。

因此调研默认值必须看完整组装链。不要数七家里几个 true；它们问的可能根本不是同一个问题。

### 3. yield 不需要证明正在等输入

Codex 到等待窗口就返回；DeepSeek 增加受控 prompt、Linux 检查和静默推断；Roo 将 agent 等待期限与用户执行期限分开。共同的可借鉴点是**返回控制权不等于宣称进程已完成**，不是“所有人都采用某一种检测”。

本项目 S003 没有自动 yield。若只开放 pipe，模型仍卡在等待工具完成，无法进入下一次输入。详见 [基线核对 B01](./notes/zero2agent-baseline.md)。

### 4. 读侧复杂性不比写侧少

Codex 分 pending 与 transcript；OpenCode 的 UI PTY 有 replay→activate 顺序；DeepSeek 区分 operation delta 与终端历史，且底层支持 pause/resume 背压；Gemini 的 PTY UI 快照不是模型文本 delta。

S004 不能把当前 OutputSink 原样重复返回当作增量协议。至少要说明已消费范围、退出后的尾部、截断/缺口、UTF-8 分块，以及输出文件与内存/磁盘限额。

### 5. 清理要指定对象和触发事件

取消一次等待、给前台进程 SIGINT、销毁终端、停止模型 turn、关闭 UI、退出宿主是不同事件。Codex 的 turn 中断可保留终端；DeepSeek 的 send 取消可能保留 shell；Grok 的前台停止与后台停止可以分开；人工终端断连也未必销毁。

保留会话增加跨轮价值，也增加权限快照、owner、陈旧句柄、清理和输出保留负担。选择“本章取消即关闭”可以更简单，但必须明确这是课程选择，而不是操作系统必然行为。

### 6. 安全不能用“不给 PTY”替代

pipe 可以接收凭据；no-echo 不删除模型 tool args；独立随机 ID 不替代 owner 验证；只限制工作区写入也不代表秘密文件不可读。人接管若没有排他写权与日志规则，同样可能混写或泄密。

本章可以不实现凭据流程，但不能宣称机制已经保证“模型写不进去”。通道、授权、秘密隔离是三个不同层面。

### 7. 新样本改变了问题，而不是给出唯一答案

DeepSeek 提供了真正不同的六工具及就绪/资源协议；Grok 主要补强后台任务与客户端分层；新 Kimi 再次证明产品 PTY 与模型 Bash 可以无关；OpenHands 暴露了输入 schema 与默认 tmux pool 重置之间的张力。

OpenHands 的冲突目前是源码推导，不是已复现 bug，必须保留运行缺口。新项目值得加入，但“新”本身不等于更适合课程。

## 旧结论的修正与真实变化

| 项目 | 本轮认定 | 类型 |
|---|---|---|
| Codex 旧模型表全是 shell_command，因此默认关 unified_exec | 旧 feature 在非 Windows 默认已开 | 旧推断错误 |
| Codex LRU 不会杀活进程 | 旧/新均可回退淘汰活 LRU，正被操作者受保护 | 旧总结过强 |
| OpenCode 默认命令必 ask | 默认 agent 的 allow 与引擎兜底 ask 不同 | 旧默认链遗漏 |
| pi 没有人工交互路径 | 同一示例扩展在旧 SHA 就存在 | 旧范围遗漏 |
| Aider 非 TTY 不会等输入；必须手打 yes | 继承 stdin；空回车/EOF 的默认 Yes 分支需计入 | 旧分支遗漏，HEAD 未变 |
| Gemini 完成后台/人输入是新加入 | 本轮核心工具及前台输入代码与旧 SHA 无 diff | 不可称为新增 |
| Gemini scrollback、平台退出/FD 修复 | 旧/新源码 diff 可见 | 真变化，未反推出发行时间 |
| pi 信号退出/null 归一化、动态 cwd | 旧/新源码可对照 | 真变化 |
| Codex 当前注册、managed feature 与 Windows 默认 | 与旧 SHA 有可核实区别 | 真变化；不是产品全平台实测 |

原 [S003 调研](../terminal/README.md) 保留为历史推理轨迹；S004 引用相关事实时应连同本轮修正阅读，不直接复制旧汇总表。

## 实验和进入讨论的条件

[机制与真实 REPL 实验](./experiments/README.md) 已验证跨轮 pipe 输入、缓冲、Ctrl-C/EOF、原始 PTY、控制终端、静默不可区分、detached/unref、exit/close、UTF-8/cursor、EOF 的副作用。失败与修正过程一并保存。

这足以修正技术前提并进入 D01–D05 评审，**不足以直接宣布 pipe 或 PTY 是最终选型**。下一步要由真实用例决定兼容范围，再确认工具面、生命周期和验收。完整选项表见 [决策输入](./notes/decision-inputs.md)。

尚未覆盖：Agent 产品 E2E、真实模型任务成功率、Linux/Windows 运行矩阵、秘密全链路审计、海量输出压力、恶意进程逃逸、人机接管恢复。未验证项已逐篇列出，不用“源码有测试”补成绿灯。

## 工作边界

本调研从本地 `main` 的 `1b84fa2` 创建独立分支，不合并仍开放的 PR #12，不改 S003 历史结论，不实现 S004。PR #12 的 D01–D05 仅作为待验证假设。

本次新增调研、实验和协作记录；不改业务代码、不创建 S004 spec、不确认 D01–D05、不推送远端或创建 PR。原有 `.discuss/.snapshot.yaml` 改动不属于本次提交。
