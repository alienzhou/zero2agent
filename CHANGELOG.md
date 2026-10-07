# Changelog

> 跟着迭代走，逐步理解 **Agent Harness** 是如何从一个简单循环演化成完整工具体系的。

[首页](./README.md) | [Roadmap](./docs/roadmap/README.md) | [Epic 1](./specs/E01-read-and-search/README.md)

本项目使用**两层版本结构**：`E01-S001`（Epic 阶段 + Story 迭代）。

---

## 如何使用迭代

每个迭代都有对应的 Git Tag，可以随时切换：

```bash
# 查看所有迭代
git tag -l "E*" "S*"

# 切换到某个迭代（示例）
git checkout E01-S001-react-basic
git checkout E01-S002-grep-search
git checkout E01-S003-file-search
git checkout E02-S003-terminal

# 回到最新
git checkout main
```

若本地尚未列出某个 Tag，可用 `main` 最新提交对照下方迭代小节；Tag 与提交历史的整理以仓库实际为准。

### 学习建议

1. **设计文档先行** - 先看 `specs/E0x-epic-slug/S0xx-story-slug/README.md`，再按需进入 `details/`，理解目标
2. **代码对照** - 边看设计边看代码
3. **复盘收尾** - 看 `retros/README.md` 与各 Story 对应的 `E0x-S0xx-<slug>.md`（正文陆续补充）
4. **动手实践** - Fork 后自己改代码

### 每个迭代的完整资料

| 资料 | 路径 | 说明 |
|------|------|------|
| 设计文档 | `specs/E0x-epic-slug/S0xx-story-slug/README.md` + `details/` | Story 入口与技术细节 |
| 代码 | `packages/` | 实际实现 |
| 复盘笔记 | `retros/`（见 `retros/README.md`） | 反思和经验 |
| 讨论记录 | `.discuss/` | 需求讨论过程 |
| VibeCoding | `.vibecoding/E0x/S00x/` | AI 协作对话记录 |

---

## 进度跟踪

### Epic 1: 基础 POC

> 核心目标：跑通模式和流程，建立"调用模型完成任务"的意识。

| 迭代 | 内容 | 状态 |
|------|------|------|
| [E01-S001](./specs/E01-read-and-search/S001-react-basic/README.md) | ReACT 基础版 | Done |
| [E01-S002](./specs/E01-read-and-search/S002-content-search/README.md) | 内容搜索 (grep_search) | Done |
| [E01-S003](./specs/E01-read-and-search/S003-file-search/README.md) | 文件搜索 (find_files) | Done |
| [E01-S004](./specs/E01-read-and-search/S004-prompt-structure/README.md) | Prompt 结构化 (buildSystemPrompt) | Done |

---

### Epic 2: 能动 / 能改 / 能执行

> 核心目标：跨过"只读"边界，让 Agent 具备改动工作区和执行命令的行动力。

| 迭代 | 内容 | 状态 |
|------|------|------|
| [E02-S001](./specs/E02-act-and-execute/S001-write-file/README.md) | 写文件 + 删文件 (write_file / delete) | Done |
| [E02-S002](./specs/E02-act-and-execute/S002-replace-in-file/README.md) | 局部修改已有内容 (replace_in_file) | Done |
| [E02-S003](./specs/E02-act-and-execute/S003-terminal/README.md) | 驱动执行环境 (terminal) | Done |
| [E02-S004](./specs/E02-act-and-execute/S004-interactive-commands/README.md) | 人工接管 bash / PTY | Done，已合入 main |

---

## [Unreleased]

<a id="e03-s005"></a>

### E03-S005-runtime-logging（实现与验收完成，草稿 PR 待人工审阅）

[PR #21](https://github.com/alienzhou/zero2agent/pull/21) 草稿；固定跟练 Tag `E03-S005-runtime-logging`。尚未合并或部署。

所属 Epic：[Epic 3](./specs/E03-product-foundations/README.md) | [Story 与跟练](./specs/E03-product-foundations/S005-runtime-logging/README.md)

- Core 以 operation / request / tool 身份关联真实模型、摘要、计数、权限与原生工具结果；后台完成保留启动时的身份，诊断 observer 故障不改变执行结果。
- 宿主默认按工作区隔离写独占 JSONL，只存元信息；有界队列、文件限额、正常结算刷新与可见降级，强制终止后的前缀明确标为未闭环。
- 增加 `/logs`、可滚动与返回的 TUI 独立查看器、无密钥 `--logs` / `--log`、操作过滤与 `--no-log`；与快照保存分开配置，保留原交互。
- 真实服务追查发现旧 Prompt 把一次拒绝的范围描述得不够明确，补充“先发起调用进入宿主审批”和不同目标新请求的边界；权限判断保持原样。
- 增加 SDK/HTTP、文件效果、真实 PTY、日志故障和真实服务关联验证；结果与范围见[验收页](./specs/E03-product-foundations/S005-runtime-logging/details/03-verification-checklist.md)，原失败证据保留。
- 提供 20 页原创图解、五篇 Spec、离线演示、两篇延伸阅读、固定版本调研与[复盘](./retros/E03-S005-runtime-logging.md)；AGENTS.md 补充元信息白名单、后台归属和未闭环的长期约束。

### E03-S004-session-persistence（已合入 main）

[PR #20](https://github.com/alienzhou/zero2agent/pull/20) 已按用户指示合入 main（bf89513）；固定跟练 Tag `E03-S004-session-persistence` 保持原候选，课程网站尚未部署。

所属 Epic：[Epic 3](./specs/E03-product-foundations/README.md) | [Story 与跟练](./specs/E03-product-foundations/S004-session-persistence/README.md)

- 保存版本化完整消息与已采用摘要；按真实工作目录隔离，独占发布不可变 revision，显式报告损坏与冲突。
- 运行前 pending、结算后保存；中断恢复只还原上次结算历史，不重放旧工具、旧审批或旧进程。
- TUI 会话列表、历史工具投影与保存状态；/resume、/session、/save、--resume、--continue、--list-sessions 和 --no-save，plain/单次/管道共用控制器。
- 保留旧交互并增加跨进程、真实 PTY SIGKILL 与真实服务回忆验证，结果与平台见[验收](./specs/E03-product-foundations/S004-session-persistence/details/03-verification-checklist.md)。
- 20 页图文课程、五篇 Spec、离线演示、延伸阅读与 [复盘](./retros/E03-S004-session-persistence.md)；AGENTS.md 补充持久化的长期规则。

### E03-S003-runtime-tui（Done，已合入 main）

[PR #19](https://github.com/alienzhou/zero2agent/pull/19)；固定跟练 Tag：`E03-S003-runtime-tui`。已合入 main，站点未部署本章。

所属 Epic：[Epic 3](./specs/E03-product-foundations/README.md) | [Story 与跟练](./specs/E03-product-foundations/S003-runtime-tui/README.md)

- RuntimeEvent 为每轮分配 turnId 与递增 seq，工具状态关联调用 ID；模型文本、Harness 通知和压缩状态分开，观察者不能影响执行。
- cancelTurn 中断模型、审批、压缩与前台终端，停止后续调度，等待已启动工具收尾；已发生副作用与配对结果保留。
- TTY 默认使用交互界面：多行草稿、粘贴、编辑历史、slash 补全、工具详情、完整审批参数、滚动、尺寸变化和人工 PTY 交接；保留 --plain、单次及管道行为。
- 保留旧命令、权限、会话、压缩、前后台终端与退出清理；补齐常用编辑键，超长粘贴整段拒绝并保留草稿。AGENTS.md 固化兼容、输入所有权与证据要求。
- 最终 509 项离线及本课 3 项真实模型复验通过，27 项 TUI 测试包含在离线总数中；18 页在线图解与 PC/H5 阅读检查完成。
- 四竞品官方/源码调研及 Codex/OpenCode 的隔离 PTY 观察；本地 SSE、真实生产 CLI/PTY、真实模型三层验证。具体数字和当前源版本见[验收](./specs/E03-product-foundations/S003-runtime-tui/details/03-verification-checklist.md)。
- [五篇 Spec](./specs/E03-product-foundations/S003-runtime-tui/details/00-overview.md)、读者跟练、延伸阅读、在线图解与[复盘](./retros/E03-S003-runtime-tui.md)在本仓库维护。下一课 S004 负责会话落盘与恢复。

### E03-S002-permissions-approval（已合入 main）

2026-10-06 已通过 [PR #17](https://github.com/alienzhou/zero2agent/pull/17) 合入 main（`caa47ea`）。以下保留开发与验收历史；其中当时的“待合并”状态不再代表当前主干。

所属 Epic：[Epic 3](./specs/E03-product-foundations/README.md) | [Story 与跟练](./specs/E03-product-foundations/S002-permissions/README.md)

- 2026-10-05 用户追问后补齐本机实际 CLI/PTY 与真实模型：权限 22 项、旧功能 28 项，共 50 项通过；50 份记录、124 次 HTTP 200。默认离线 463 通过、50 live 跳过；137 项 E2E 最终覆盖通过，记录器修复后的 3 项为独立补跑。[补验报告](./researches/permissions/acceptance/runtime-audit/README.md)保留原失败与通过证据，固定补验 Tag `E03-S002-permissions-approval-verified`。以下 2 项/30 跳过为首轮历史数据，不能代表全套真机已完成。

- 统一执行前权限：default/read-only/accept-edits/bypass、deny > ask > allow，工具元信息与精确标量规则由宿主管理。
- 一次审批绑定调用和参数快照，默认最多等待 120 秒；无宿主、异常、非法/晚到回答、超时或取消均拒绝。整批调用先快照，拒绝仍返回配对的错误结果。
- 工作区写、只读外部读、软链接与已有祖先在执行前重查，直接写工具保留边界；路径校验与用户批准不提供操作系统沙箱。
- CLI 使用 TTY y/N 与完整 JSON 参数；管道回答不批准，人工 PTY 保留独立交接确认和正文边界。
- 固定生产与测试候选 `73ecdbc`：54 项权限单元和 20 项 CLI 契约包含在全量 463 通过、30 live 默认跳过中；另行 2 项 MiniMax-M2.7 真实验收通过。build、e2e 类型、改动格式通过，lint 0 错误、15 条既有告警。[证据](./researches/permissions/acceptance/README.md) / [源码复核](./.vibecoding/2026-10-05/e03-s002-permissions/review.md)。
- 四竞品研究、五篇 Spec、跟练、Deep Dive、讨论与[复盘](./retros/E03-S002-permissions-approval.md)已补齐；16 页图文主图和手机图逐页复核，双 ZIP 与 10 项包检查通过。固定版本 Tag `E03-S002-permissions-approval`；候选待人工审阅和合并，图文未对外发布。
- 下一课 E03-S003 为运行状态与 TUI，将已有审批与状态接入终端界面。

### E03-S001-multi-turn（已合入 main，未对外发布）

所属 Epic：[Epic 3](./specs/E03-product-foundations/README.md) | [Story 与跟练](./specs/E03-product-foundations/S001-multi-turn/README.md)

- Session 持有进程内历史；同一 Agent 跨轮延续，静态 Agent.run 与未传 session 的 runLoop 保持一次性。
- 最终回答、完整工具调用与结果进入历史；支持 reset / `/new`、深拷贝快照及运行互斥，固定 Agent 创建时 cwd。
- 流式失败保留已完成工具证据，截断调用不执行且补错误回执；不可打印的工具异常也不会打断整批结果。展示回调与执行数据隔离。
- 旧多轮范围记录（`b615f01`）：33 项 Core 单测与 6 项本地 SSE + 真实 CLI 契约测试，涵盖跨轮、新对话、连续失败、半截 SSE、非空快照与配置保留。
- 旧完整复核修复输入管道保持打开时 `exit` 不退出，以及空响应不向用户提示的问题；当时全仓 288 通过、25 跳过，仅用于历史追溯。
- 旧多轮版本 `a5f72f7` 已推送。随后同一期合并基础预算、工具正文缩短、自动后台／前台压缩和手动 `/compact`，不再将压缩排除在本课之外。
- 功能分支 `feat/e03-s001-multi-turn` 已推送至 `50d1c1a`。生产代码基线 `ea498a3` 未变，最终验收测试 `3829868` 已随分支推送。全量自动测试 Core 316、E2E 62、cdp-debug 1，共 379 通过；25 项真实模型测试因缺 API 配置跳过。build、E2E tsc、lint 通过，lint 为 0 errors / 15 既有 warnings。
- 预算／摘要／管理器／compact-loop 专项分别 29/20/22/12 项通过，Session 34 项，均已包含在上述总数；compact-loop strict 类型检查通过。两项强化测试验证连续两次实际恢复后第三次拒绝停止且副作用一次，以及混合成功／失败工具批次、后台 pending、新工具对、模型失败与前台接管的证据保留。完整证据见[验收记录](./specs/E03-product-foundations/S001-multi-turn/details/03-verification-checklist.md)。
- 18 页主图与18页手机图已逐张审阅，修正 P15 事实措辞和 P16 手机换行，render 零溢出／孤字。本地成稿与交付包验证完成：图片包21项、源包36项，10项保护测试、5个视口与41个链接通过；源包使用公开npm源空缓存独立安装、重建与测试通过，38张PNG哈希一致。未发布。
- 摘要 token 与字节紧凑目标分离，采用时重新计数完整请求；计数可取消，立即取消不再发起后续计数。自动前台失败若请求仍在硬预算内可继续，硬超限必须拒绝。
- 大工具结果原文保留，长单行增加 Unicode 字符切片 JSONL，可用 read_file 按行读到末尾；静态 Agent.run 与默认 runLoop 在结束时取消无主后台摘要。
- SDK 增加 compact/getContext/getHistory/cancelCompaction；CLI 精确 `/compact` 前台执行，提供四个上下文环境变量。压缩不改原史、不重跑工具，不承诺无损摘要或任意供应商永久不超限。
- 已通过 PR #15 合入 `main`（`f883252`），并创建 Story Tag `E03-S001-multi-turn`。无持久化与全局取消 UI；原验收未进行真实模型试用，真实试用是可选付费体验。
- 2026-10-05 补验修复 MiniMax-M2.7 摘要包含 thinking 时被拒绝的问题，仅采用完成的 text，仍拒绝工具块、截断和超限。真实模型 + CLI + PTY 3/3 通过，完整离线回归 389 通过、28 live 跳过；覆盖人工接管隐私、多轮纠正、手动/自动压缩与 `/new`，见[补验记录](./.vibecoding/2026-10-05/e02-e03-real-e2e/acceptance.md)。

学习重点是消息所有权、预算与副作用证据，而非把字符串拼成聊天记录。课程按场景、原理、自动层级／并发、手动跟练展开，见[技术设计](./specs/E03-product-foundations/S001-multi-turn/details/01-technical-design.md)和[复盘](./retros/E03-S001-multi-turn.md)。

### 2026-10-01：确认 Epic 3 课程计划

- 新增 [Epic 3 阶段入口](./specs/E03-product-foundations/README.md)，确认六节课：多轮会话、权限与 Approval、基础 TUI、会话恢复、运行日志、文件 Checkpoint。
- 同步首页、Roadmap 和 Specs 导航；E02 内容已完成并合入 main，S004 尚未打课程 Tag。
- 本次仅更新规划文档，不代表 E03 功能已实现；顺序与边界见[课程决策](./.discuss/2026-10-01/e03-course-plan/decisions/D01-course-sequence.md)。

### E02-S004-human-terminal (Done, merged into main; untagged)

所属 Epic：[Epic 2：能动 / 能改 / 能执行](./specs/E02-act-and-execute/README.md) | Story 详情：[S004](./specs/E02-act-and-execute/S004-interactive-commands/README.md)

2026-09-29：在 `feat/e02-s004-human-terminal` 实现并完成本机自动验证，待人工审查、验收与合入；未发布或打 Tag。

2026-09-30 复验：修正 drain 测试的冷环境计时干扰、补慢环境反回归；修复活终端收到外部 SIGHUP 时漏显示恢复。最终代码连续两轮均为 248 项通过、25 跳过。已补[固定候选与跟练](./specs/E02-act-and-execute/S004-interactive-commands/follow-along.md)，用户签收与发布仍未代办。

2026-09-30 19:36：用户对 Node REPL 与 less 两项试用回复「正常」，已登记[功能试用通过](./.vibecoding/2026-09-30/e02-s004-acceptance/user-feedback.md)。未据此修改确认策略，也未推送、合入、打 Tag 或发布。

**能力**：`terminal` 增加 `interactive: true`；人工确认后接管真实 PTY，模型等待结束。独立 `--terminal [command]` 不要求 API key，REPL 支持 `/terminal [command]`。默认非交互路径和八工具集合不变。

**你会学到**：

- PTY 的 master/slave 如何把人的按键与 bash 连接起来。
- 为什么暂停界面不等于转移输入权，以及如何防止收尾输入进入 Agent 历史。
- 程序控制字符、宿主中止、进程组清理与物理终端断连为什么需要不同处理。
- 正文不入模的隐私边界，以及退出摘要不能替代业务成功判断。

**实现与验证**：

- 默认 No 确认；Ctrl-C/Ctrl-D 给程序，Ctrl-] 结束整个接管。
- 保存并恢复输入监听、raw mode、完整 stty 属性，转发 resize。
- 清理原进程组及已观察后代，物理断连同步清理并退出。
- 正文与按键不进 OutputSink、应用输出日志或模型回执；不保证外部程序无记录。
- 最新脱敏发布复验：固定实现 `b200c9f`，构建和 E2E 类型检查通过；core 199、E2E 49、cdp-debug 1，共 249 项通过，25 项 E2E 跳过。人工终端契约占 31 项。
- 修复 CLI 宿主取消被子程序 exit 0 掩盖的问题；Node 测试改用 process.execPath，受控无 Node PATH 环境下先红后绿。
- `release/e02-s004-human-terminal` 保留逐提交脱敏历史，补齐架构与上手文档。用户随后明确授权合入，已通过 [PR #13](https://github.com/alienzhou/zero2agent/pull/13) 合入 main（060c644）；没有打课程 Tag。
- lint 为 0 errors / 15 warnings；变更文件格式检查通过，全仓仍有 27 个未改动文件的格式问题。
- 仅 macOS arm64 实测；Windows 不支持，Linux、慢终端压力与真实模型流程未实测。

先读[技术设计](./specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md)与[验收证据](./specs/E02-act-and-execute/S004-interactive-commands/details/03-verification-checklist.md)，过程见[复盘](./retros/E02-S004-human-terminal.md)与[协作记录](./.vibecoding/2026-09-29/e02-s004-human-terminal/dialogue.md)。

### E02-S001-write-file (Done)

所属 Epic：[Epic 2：能动 / 能改 / 能执行](./specs/E02-act-and-execute/README.md) | Story 详情：[S001](./specs/E02-act-and-execute/S001-write-file/README.md)

**目标**：给 Agent 装上第一批写工具 `write_file` 和 `delete`，让它跨过"只读"边界，第一次能改动工作区

**你会学到**：
- 为什么工具接口的设计比工具实现更重要（粒度 / 参数格式 / 能力边界 / 回执）
- 单一职责：全量写与局部改为什么拆成两个工具（write_file vs 后续 replace_in_file）
- 物理边界 vs 意图边界：cwd 硬校验为什么放在工具层，破坏性确认为什么留到 Epic 3
- 批量操作的部分失败语义：delete 为什么选"尽力删 + 逐条汇总"
- 回执如何充当模型观测世界状态变化的唯一窗口

**关键文件**：
- `specs/E02-act-and-execute/S001-write-file/` - 设计文档与 deep-dive
- `packages/core/src/tools/write-file.ts` - write_file 工具实现
- `packages/core/src/tools/delete.ts` - delete 工具实现
- `packages/core/src/tools/path-guard.ts` - cwd 边界校验
- `packages/core/src/tools/index.ts` - 工具注册入口
- `packages/core/src/prompt/system.ts` - System Prompt 从只读扩展为读写

**学习要点**：
1. 工具接口就是 Agent 的行动语言：给什么工具、什么参数格式，决定模型能表达什么
2. 独立 delete 是教学向选择（竞品都没做），换来工具层的可控与结构化回执
3. write_file 用回执区分新建 / 覆盖，delete 逐条汇总——都是零成本却对模型有用的观测信息
4. 接口是当前模型阶段的快照，会随模型能力演进而调整

**变更内容**：
- [x] `write_file` 工具：2 参数（path / content），不存在建 / 存在覆盖，自动建父目录
- [x] `delete` 工具：接收路径数组，批量删除，部分失败尽力删 + 逐条汇总
- [x] `path-guard.ts`：cwd 边界硬校验，越界（`..` 逃逸 / 绝对路径逃逸）一律拒绝
- [x] 工具注册到 `packages/core/src/tools/index.ts`
- [x] System Prompt 从 read-only 扩展为 read-write（role / scope / toolPolicy）
- [x] TUI `cli.ts` 更新工具摘要与提示文案
- [x] 25 个测试用例（write-file 10 / delete 10 / path-guard 5，全部通过）
- [x] deep-dive：[工具接口就是 Agent 的行动语言](./specs/E02-act-and-execute/S001-write-file/deep-dive/01-agent-computer-interface.md)

---

### E02-S002-replace-in-file (Done)

所属 Epic：[Epic 2：能动 / 能改 / 能执行](./specs/E02-act-and-execute/README.md) | Story 详情：[S002](./specs/E02-act-and-execute/S002-replace-in-file/README.md)

**目标**：给 Agent 装上局部修改工具 `replace_in_file`，让它在「整篇重写」之外能对已有文件做外科手术式的精确替换

**你会学到**：
- 为什么「整篇重写」在真实编码里 token 昂贵、易出错、易污染格式
- 唯一性约束如何倒逼模型提供足够上下文、从根上防止改错位置
- `replace_all` 开关如何平衡「安全默认」与「批量重命名的效率」
- 字符串精确替换为何是局部改的主流范式（对比补丁 / 块语法）

**关键文件**：
- `specs/E02-act-and-execute/S002-replace-in-file/` - 设计文档
- `packages/core/src/tools/replace-in-file.ts` - replace_in_file 工具实现
- `packages/core/src/tools/path-guard.ts` - 复用的 cwd 边界校验
- `packages/core/src/tools/index.ts` - 工具注册入口
- `packages/core/src/prompt/system.ts` - System Prompt 工具策略增加 replace_in_file

**学习要点**：
1. 局部修改的本质是「定位 + 替换」，唯一性约束解决的是「定位」，比「替换」本身更关键
2. 唯一性约束是行业共识：OpenCode / pi-mono / Gemini 的 edit 都要求 old_string 唯一
3. replace_all 是低成本、高价值的偏离——五家竞品都没有，却覆盖了「批量重命名」的真实场景
4. 用 split/join 而非 String.replace，规避 `$` 等替换占位符的隐蔽陷阱
5. 吸取 S001 复盘教训：回执统一英文，doc 与 code 不再漂移

**变更内容**：
- [x] `replace_in_file` 工具：4 参数（path / old_string / new_string / replace_all），精确匹配 + 唯一约束
- [x] `replace_all` 开关：默认 false 要求唯一，true 替换全部并报告处数
- [x] 复用 `path-guard.ts`：cwd 边界硬校验，越界拒绝
- [x] 工具注册到 `packages/core/src/tools/index.ts`
- [x] System Prompt 增加 replace_in_file 能力与工具策略
- [x] TUI `cli.ts` 更新工具摘要分支
- [x] 14 个测试用例（唯一替换 / replace_all / 未找到 / 不唯一 / 越界 / 特殊字符 / 删片段，全部通过）

---

### E02-S003-terminal (Done)

所属 Epic：[Epic 2：能动 / 能改 / 能执行](./specs/E02-act-and-execute/README.md) | Story 详情：[S003](./specs/E02-act-and-execute/S003-terminal/README.md)

**目标**：给 Agent 装上执行工具 `terminal`，让它能跑 shell 命令并拿到真实结果；真正的交付物是围绕「一个我们不控制的程序」的五套机制

**你会学到**：
- 起进程只要 20 行，重量全在「什么信息进上下文」以及进程活过回执之后怎么办
- 为什么「截断输出」是在解错误的问题，渐进式披露（落盘 + 回读）怎么做
- 为什么「超时杀死」应该换成「取消 / 跳过」——不可逆动作只能交给人
- 三种 Agent 死法为什么需要三道不同的防线，以及「进程杀了 ≠ 管道关了」
- 「和用户终端保持一致」为什么必须拆成能力继承与呈现覆盖两个相反方向

**关键文件**：
- `specs/E02-act-and-execute/S003-terminal/` - 设计文档
- `packages/core/src/tools/terminal.ts` - terminal 工具与回执 / 落盘 / 取消跳过
- `packages/core/src/tools/terminal-runtime.ts` - TTY 按键与运行时钩子
- `packages/core/src/tools/process-registry.ts` - 被跳过后台进程登记
- `packages/core/src/tools/shell-env.ts` - login shell 环境采集与呈现覆盖
- `packages/tui/src/setup-terminal-runtime.ts` - CLI 绑定 Ctrl-X / Ctrl-S
- `packages/core/src/tools/index.ts` - 工具注册入口
- `packages/core/src/prompt/system.ts` - System Prompt 增加执行能力与非交互策略

**学习要点**：
1. `terminal` 是第一个会在自己返回之后仍留下活物的工具；教学重心不是 spawn，而是边界
2. 不截断、不默认杀死，是对五家竞品共识的有意偏离，前提是「无人在环不能照抄有人兜底的设计」
3. S003/S004 的线按耦合度重画：自己制造的长命令 / 生命周期问题不能留给下一章
4. 回执结构本身可被命令输出伪造，隔离标签必须带随机 nonce
5. `ToolContext` 第四次不扩展；workdir / 超时 / 流式都不进公共上下文对象

**变更内容**：
- [x] `terminal` 工具：`command` 必填、`workdir` 可选，走 `bash -c`，stdout/stderr 合流，exit code 无条件进回执
- [x] 超长输出越 800 行 / 20KB 落盘，回执只给规模和路径，模型用既有读工具回读
- [x] 不设执行上限：Ctrl-X 全程取消，10 秒后 Ctrl-S 跳过转后台；非 TTY 跑到底
- [x] 三道防线：退出询问、watcher 收孤儿、读取侧 2s drain 超时
- [x] 启动时采集 login shell env，覆盖 `TERM=dumb` / 分页器 / 凭据弹窗，不加 `NO_COLOR`
- [x] System Prompt 写明非交互、用 `workdir` 不用 `cd`、超长输出可回读
- [x] 单测 + P0 evidence + D01–D05 live E2E（含 PTY 真按键）

---

### E01-S004-prompt-structure (Done)

所属 Epic：[Epic 1：能看 / 能查](./specs/E01-read-and-search/README.md) | Story 详情：[S004](./specs/E01-read-and-search/S004-prompt-structure/README.md)

**目标**：把内联在 `cli.ts` 里的 System Prompt 重构成可维护、可扩展的 Prompt Builder

**你会学到**：
- 为什么 System Prompt 需要结构化，而不能只是一段字符串
- 5 段式 System Prompt 的组织方式（Role / Scope / Tool Policy / Workflow / Output）
- Tool Schema 和 System Prompt 的职责分工，消除双写问题
- Runtime Context（cwd、date）为什么应该放在 UserTaskContext 而不是 System Prompt

**关键文件**：
- `specs/E01-read-and-search/S004-prompt-structure/` - 设计文档
- `packages/core/src/prompt/system.ts` - System Prompt Builder
- `packages/core/src/prompt/user-task.ts` - UserTask Builder
- `packages/core/src/prompt/types.ts` - 类型定义
- `packages/tui/src/cli.ts` - TUI 集成入口

**学习要点**：
1. Prompt 结构化的核心动机：当前能用，但不可扩展
2. 5 段式分工：身份 → 能力边界 → 工具策略 → 工作流 → 输出约束
3. Tool Schema 写"工具能做什么"，System Prompt 写"什么时候用工具"
4. Dynamic Runtime Context 与 Static System Prompt 分离，为未来 prompt cache 铺路

**变更内容**：
- [x] `packages/core/src/prompt/` 模块（`system.ts` / `user-task.ts` / `types.ts` / `index.ts`）
- [x] `buildSystemPrompt()` 函数：组装 5 段式 Default System
- [x] `buildUserTaskMessage()` 函数：将用户输入包装为 UserTaskContext + UserTask
- [x] Core `index.ts` 导出新的 prompt 模块
- [x] TUI `cli.ts` 移除内联 SYSTEM_PROMPT，改用 `buildSystemPrompt()`
- [x] 9 个测试用例（System Prompt / UserTask Builder 各段内容 + 格式验证）

---

### E01-S003-file-search (Done)

所属 Epic：[Epic 1：能看 / 能查](./specs/E01-read-and-search/README.md) | Story 详情：[S003](./specs/E01-read-and-search/S003-file-search/README.md)

**目标**：给 Agent 加上文件搜索能力，同时补上工具体系的工作目录基础设施

**你会学到**：
- 如何设计 ToolContext 统一工具的运行环境
- 从隐式依赖（process.cwd）到显式注入的重构思路
- ripgrep `--files` 模式与 `--json` 模式的差异
- find_files 与 grep_search / list_directory 的分工

**关键文件**：
- `specs/E01-read-and-search/S003-file-search/` - 设计文档
- `packages/core/src/tools/types.ts` - ToolContext 定义
- `packages/core/src/tools/find-files.ts` - find_files 工具实现
- `packages/core/src/loop.ts` - 上下文传递

**学习要点**：
1. 第三个工具到来时，前两个 Story 的隐式假设被暴露
2. ToolContext 是扩展点——后续加字段不需要改签名
3. 相对路径输出：省 token + 工具链衔接 + 一致性

**变更内容**：
- [x] `ToolContext` 基础设施（`types.ts`、`loop.ts`、`agent.ts`）
- [x] 三个现有工具适配（`read-file.ts`、`list-directory.ts`、`grep-search.ts`）
- [x] `find_files` 工具：3 参数（pattern/path/exclude）
- [x] ripgrep `--files` 模式集成
- [x] 结果处理：mtime 降序排序、100 条截断、相对路径输出
- [x] 11 个测试用例（基本搜索/参数/排序/格式/.gitignore/错误处理）
- [x] TUI 更新：system prompt 增加 find_files 说明

---

### E01-S002-grep-search (Done)

所属 Epic：[Epic 1：能看 / 能查](./specs/E01-read-and-search/README.md) | Story 详情：[S002](./specs/E01-read-and-search/S002-content-search/README.md)

**目标**：给 Agent 加上内容搜索能力，学习如何从零设计 Agent 工具

**你会学到**：
- 如何用四个核心问题框架设计 Agent 工具
- ripgrep 集成的实践方式
- 工具输出格式对 Agent 行为的影响
- grep_search → read_file 的工具链协作模式

**关键文件**：
- `specs/E01-read-and-search/S002-content-search/` - 设计文档
- `packages/core/src/tools/grep-search.ts` - grep_search 工具实现
- `.discuss/2026-03-16/e01-s002-content-search/` - 讨论记录与决策

**学习要点**：
1. 工具设计核心原则：对人好用 = 对 AI 好用
2. 设计工具前回答四个问题：解决什么问题 → 控制什么/自动化什么 → 输出契约 → 边界兜底
3. 类比 VS Code 全局搜索推导参数设计

**变更内容**：
- [x] `grep_search` 工具：5 参数（pattern/path/include/exclude/context）
- [x] ripgrep 集成（`@vscode/ripgrep`，`--json` 模式解析）
- [x] 结果处理：修改时间排序、100 条截断、Gemini CLI 风格输出
- [x] 16 个测试用例（基本搜索/参数/排序/格式/正则/错误处理）
- [x] 流式输出：`client.messages.create()` → `client.messages.stream()`
- [x] 事件回调：`LoopEventHandlers`（onText/onToolStart/onToolEnd/onToolError）
- [x] TUI 工具展示优化（流式打印 + 工具调用摘要）

---

### E01-S001-react-basic (Done)

所属 Epic：[Epic 1：能看 / 能查](./specs/E01-read-and-search/README.md) | Story 详情：[S001](./specs/E01-read-and-search/S001-react-basic/README.md)

**目标**：实现最基础的 ReACT Agent Harness 循环 + 工具调用

**你会学到**：
- 什么是 ReACT 模式（Reasoning + Acting）
- Agent Loop 的基本结构
- 如何使用 Anthropic SDK 调用 LLM
- 如何实现 Tool Use（工具调用）

**关键文件**：
- `specs/E01-read-and-search/S001-react-basic/` - 设计文档
- `packages/core/src/` - 核心实现
- `retros/` - 复盘笔记（规划路径见 `retros/README.md`，正文陆续补充）

**学习要点**：
1. Agent 不是一次性调用 LLM，而是循环
2. 每次循环：思考 → 工具调用 → 执行工具 → 继续或结束
3. 使用 Anthropic Tool Use 机制实现工具调用

**变更内容**：
- [x] 项目基础设施（post-commit hook、版本编号规范）
- [x] 设计文档完成（specs/E01-read-and-search/S001-react-basic/）
- [x] VibeCoding 对话记录（.vibecoding/E01/S001/）
- [x] Anthropic SDK 集成
- [x] read_file / list_directory 工具实现
- [x] ReACT 循环实现
- [x] 端到端测试验证

---

## S000 - Repository Initialization (2026-03-10)

**目标**：搭建项目基础结构

**变更内容**：
- Monorepo structure with pnpm workspaces
- Three packages: `@zero2agent/core`, `@zero2agent/tui`, `@zero2agent/shared`
- Project documentation and directory structure
