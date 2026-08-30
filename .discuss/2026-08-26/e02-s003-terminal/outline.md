# E02-S003：让 Agent Harness 能驱动执行环境（terminal）

> 讨论始于 2026-08-26。目标：给 Agent Harness 引入 `terminal` 工具，让它能执行 shell 命令、拿到真实运行结果。
>
> 上游依据：[D04：Epic 2 规划](../../2026-03-14/zero2agent-course-roadmap/decisions/D04-stage2-roadmap.md)——Terminal 只做**正常执行路径**，长时间运行 / 前台阻塞 / 交互式命令归 S004。
>
> 竞品调研：[researches/terminal/](../../../researches/terminal/README.md)（五家实证调研，每条结论带 `文件:行号`）

---

## 🧭 推进方式（2026-08-30 起）

按用户提出的**五个核心议题**逐条推进，每条产出一份 `decisions/Dxx-*.md`
（含竞品实证 + 我们的思考 + 决策 + 待定项）。五条走完，教学内容的骨架即成型。

| # | 议题 | 一句话 | 决策文档 | 状态 |
|---|------|--------|---------|------|
| ① | **工具基本盘**：描述 + 技术实现 + 响应契约 | 起进程只要 20 行，难的是「什么信息进上下文」 | [D01](./decisions/D01-tool-baseline.md) | ✅ 17 项决策，待定全清（含 nonce 标签 + 阈值抖动实测） |
| ② | **超长输出**：落盘 + 渐进式披露 | **不截断**：超 800 行 / 20KB 只给规模 + 路径，模型自己回读 | [D02](./decisions/D02-oversized-output.md) | ✅ 21 项决策，待定全清（含技术架构图 + token 校准） |
| ③ | **长时间命令**：不设上限 + 跳过/取消 + 后台回读 | **不杀死**：Ctrl-X 全程可取消、10 秒后可 Ctrl-S 跳过转后台，输出复用 ② 的落盘 | [D03](./decisions/D03-long-running-skip-and-background.md) | ✅ 17 项决策，待定全清（**§5.5 整体设计定稿**：时间轴 + 状态机 + 五种回执 + 按键） |
| ④ | **生命周期**：Agent 退出后的常驻进程 | **三道防线对应三种死法**；只有 `setsid` 能逃 killpg，且它会同时挂死 loop | [D04](./decisions/D04-process-lifecycle.md) | ✅ 14 项决策，6 个权衡点全部拍板 |
| ⑤ | **执行环境**：与用户终端的一致性 | 能力必须一致（继承），呈现必须不同（覆盖）；`process.env` 靠不住，要起一次 login shell | [D05](./decisions/D05-execution-environment.md) | ✅ 12 项决策，6 个权衡点全部拍板 |
| 🔒 | **钩子：审批与沙箱** | 本章完全不做审批；解析式安全已被三方证伪 | D01 §九 | 📝 留给安全篇 |

### 为什么是这个顺序（叙事链）

```
① 决定「什么信息进上下文」
   ↓ 推论：信息量 > 预算，怎么办
② 建立「落盘 + 渐进式披露」机制         ← 落盘在这里成为基础设施（不截断）
   ↓ 复用：命令太久时，输出同样需要落盘
③ 长命令：不杀死，转后台 + 回读          ← 直接用 ② 的机制，不必重新解释
   ↓ 顺延：既然进程能留在后台，那它什么时候死
④ 常驻服务与孤儿进程                     ← 三道防线；③ 制造的问题在这里收口
   ↓ 收尾：以上都建立在「子进程环境」之上
⑤ 环境一致性                            ← 能力继承 / 呈现覆盖 / 采集的三个坑
```

两个关键衔接点：
- **② → ③**：落盘是一个机制，服务两个触发（输出超预算 / 等待超耐心）。
  ② 先把它立起来，③ 就只讲「什么时候转后台」，不用再讲「输出去哪了」。
- **③ → ④**：③ 让进程可以留在后台活着，④ 紧接着问「那它什么时候、由谁杀掉」。
  ⚠️ **这条衔接后来变成了一条划线判据**：④ 收敛时判定「生命周期」是 ③ 自己制造的问题，
  **不能留给下一章**（D04 §6.6.1）。于是 S003/S004 的线被第二次重画，S004 只剩「交互式」。

⚠️ **⑤ 与前四个不同**：①—④ 的问题都由**命令的行为**触发（输出多 / 跑得久 / 留下进程），
⑤ 的问题在**第一条命令执行之前就已经存在**。→ 放在最后讲，却必须在最前面做（D05 §八）。

---

## 🔵 Current Focus

**五个核心议题已全部收敛，结论已迁入 Confirmed / Rejected，spec 已定稿。**

- 讨论产物：`decisions/D01–D05`（81 项决策）+ 本文件的 Confirmed / Rejected 表
- Spec 产物：`specs/E02-act-and-execute/S003-terminal/`（README + details/ 五份，任务顺序 = 教学顺序）
- **下一步**：按 [02-task-list](../../../specs/E02-act-and-execute/S003-terminal/details/02-task-list.md) 实现 `packages/core/src/tools/terminal.ts`（从 30 行的 `runCommand()` 开始）

## ⚪ Pending

> **T01–T14 已全部收口**，下表保留原始问题文本作索引，结论见下方 Confirmed / Rejected。

| # | 原始问题 | 去向 |
|---|---|---|
| T01 | 工具名与参数集（竞品共识是三件套） | ✅ 参数砍成 `command` + `workdir`，**不设 timeout**（D01-1） |
| T02 | 要不要 `workdir`（加了就要动 `ToolContext`？） | ✅ 要，但**不动 `ToolContext`**（D01-2/3） |
| T03 | 用哪个 shell | ✅ `bash -c`；原推理被实测推翻后改为启动时采集一次（D05-2/3） |
| T04 | exit code / stdout / stderr 怎么进回执 | ✅ 合流 + exit code 无条件写（D01-6/7） |
| T05 | 输出截断策略 | ✅ **不截断**，改渐进式披露（D02 全篇） |
| T06 | 终端环境规格化 | ✅ `TERM=dumb` + 凭据弹窗禁用；不加 `NO_COLOR`（D05-10/11） |
| T07 | 不做 pty 的边界与代价 | ✅ 定位为防线 #2 而非成本妥协（D05 §3.1） |
| T08 | 交互式命令卡死怎么防 | ✅ 四道防线对应四条输入通道（D01 + D05 §3.1） |
| T09 | 超时机制 | ✅ **不设上限**，改取消/跳过（D03-1/4） |
| T10 | 进程清理：杀 pid 还是进程组 | ✅ 杀进程组；`setsid` 逃逸记明示缺口（D04-1/2） |
| T11 | cwd 硬校验失效怎么办 | ✅ 讲清，不补救 —— 物理边界第一次失效（D01 §2） |
| T12 | 黑白名单 / 沙箱 | ✅ 一行都不写，推给安全专章（D01 §九） |
| T13 | `ToolContext` 是否扩展 | ✅ 第四次不扩展（D01-13 / D05-12） |
| T14 | S004 需求输入 | ✅ S004 只剩「交互式」；后台/登记/通知收回 S003（D04-13） |

## ✅ Confirmed

> 五份决策文档共 **81 项决策**，下表按 T01–T14 归口。逐条依据见对应 D 文档。

### 工具契约

| # | 结论 | 依据 |
|---|---|---|
| T01 | 工具名 `terminal`；参数 **`command`（必填）+ `workdir`（可选）**；⚠️ **不设 `timeout`** | D01-1 |
| T02 | `workdir` 支持，且**明确定位为 `cd` 的替代**（避免模型用 `cd &&` 制造状态错觉）；不复用 `resolveInsideCwd`，不改 `path-guard.ts` | D01-2 / D01-3 |
| T03 | 执行固定 **`bash -c`**，不加 `-l` 不加 `-i`；`-l` 只用在**启动时采集 env 那一次** | D01-4 / D05-3 |

### 返回契约

| # | 结论 | 依据 |
|---|---|---|
| T04 | stdout/stderr **合流成一段文本**；exit code **无条件写入**；非零退出是普通回执不是工具故障；`Wall time` 仅超 3 秒时写 | D01-6 / D01-7 / D01-8 |
| T04b | 只把 `Output:` 段包进不可信标签，标签名带 **每次调用随机的 8 位 hex nonce** | D01-10 / D01-15 |
| T05 | ⚠️ **推翻五家竞品的截断范式** —— 不截断，超 800 行 / 20KB 只给规模 + 路径，模型用既有 `read_file`/`grep_search` 回读 | D02 全篇 |
| T05b | **落盘 / 弃内存 / 回执给不给正文是三个正交开关**，不能绑成一件事 | D03-16 |

### 执行环境

| # | 结论 | 依据 |
|---|---|---|
| T06 | 能力**继承**（启动时 `$SHELL -lc` 采集一次，带分隔符 / `stdin:ignore` / SIGKILL 超时），呈现**覆盖**（`TERM=dumb` + `PAGER`/`GIT_PAGER=cat` + `GIT_EDITOR=true` + 凭据弹窗禁用） | D05-3…D05-10 |
| T07 | 不做 pty，且定位为**防线 #2**（`isatty()` 恒 false）而非成本妥协 | D01 §4 / D05 §3.1 |

### 卡死与生命周期

| # | 结论 | 依据 |
|---|---|---|
| T08 | 四道防线：`stdin:'ignore'` / 无 pty / env 注入 / 超时兜底 —— **对应四条独立的输入通道** | D01 + D05 §3.1 |
| T09 | ⚠️ **不设执行上限**，用「Ctrl-X 取消（全程）+ Ctrl-S 跳过（10 秒后转后台）」替代「超时杀死」；非 TTY 下两者同时失效，如实写明 CI 无兜底 | D03-1/4/6/12 |
| T10 | `detached` + `killpg`；实测 `nohup`/`disown` **都杀得掉**，只有 `setsid` 能逃 —— 记为明示缺口 | D04-1 / D04-2 |
| T10b | **三道防线对应三种死法**：退出钩子（正常退出）/ watcher 轮询（被 SIGKILL）/ 读取侧 2 秒超时（进程不退） | D04-3/5/10 |

### 安全与架构

| # | 结论 | 依据 |
|---|---|---|
| T11 | cwd 硬校验只管参数不管命令文本；**如实承认这是物理边界第一次失效** | D01 §2 |
| T12 | **S003 一行命令解析都不写**，推给安全专章 —— 解析式安全已被三方证伪 | D01 §九 |
| T13 | `ToolContext` **第四次不扩展**；返回侧 `Promise<string>` 单出口坚决不破（不加 metadata / 不加流式回调） | D01-5 / D01-13 / D05-12 |
| T14 | ⚠️ S004 **只剩「交互式」**（stdin 续写 + pty）；后台执行 / 进程登记 / 完成通知全部收回 S003 | D04-13 |

## ❌ Rejected

| 被否掉的 | 理由 | 依据 |
|---|---|---|
| **截断输出** | 五家竞品共识，但它把「上下文预算」问题当成「输出长度」问题解 | D02 |
| **默认超时 120s + 到点杀死** | 杀死是不可逆动作，而「该不该继续等」只有人能判断 | D03-1/4 |
| **1 小时兜底上限** | 防不住它看似在防的任何一件事，只给人假安全感 | D03-4 |
| **复用 Ctrl-C 做「取消命令」** | 人眼前看到的是 Agent 不是命令，赌输的代价是整个会话 | D03-12 |
| **裸 ESC / 裸字母做快捷键** | ESC 被 ANSI 转义序列吞掉；字母键要留给用户输入 | D03-13 |
| **给模型 `list_processes` / `kill` 工具** | list 的唯一增量信息是「别人起的进程」，恰是模型不该碰的 | D04-8 |
| **Agent 退出时一律杀掉后台进程** | 违背「跳过」的初衷（用户就是要它继续跑） | D04-10 |
| **落盘文件设大小上限 / 退出时清理** | 与「不截断」立论冲突；且跳过的命令可能还在写 | D04-11 / D03-10 |
| **`process.env` 直接继承** | 前提「Agent 由用户终端启动」在桌面 App / 服务 / CI / cron 下全不成立 | D05-2 |
| **`TERM=xterm-256color`（跟 Gemini）** | 它的理由是驱动 pty 里的 headless emulator，我们不做 pty | D05-10 |
| **不设 `TERM`** | 最差选项：`tput` / `clear` **直接报错** | D05-10 |
| **`NO_COLOR=1`** | 既非必要（非 TTY 已覆盖）又不充分（拦不住 `color.ui=always`） | D05-11 |
| **扩展 `ToolContext`** | 单一消费者 + 生命周期同进程，模块级缓存才是正确位置（第四次） | D05-12 |

## 🗒️ 讨论笔记索引

| 笔记 | 覆盖议题 | 一句话 |
|------|---------|--------|
| [D01：工具基本盘](./decisions/D01-tool-baseline.md) | ① T01/T03/T04/T13 + 描述 | 起进程只要 20 行；主命题是「什么信息进上下文」；单出口不可破；**不可信标签必须带随机 nonce**（固定标签名可被输出伪造闭合串越狱）；`Wall time` 3 秒（与 D03 的 10 秒有意不等） |
| [D02：超长输出](./decisions/D02-oversized-output.md) | ② T05 | **推翻五家竞品的截断范式**，改渐进式披露；零新工具（读宽写严的复利）；**越界即弃内存的流式落盘**（§4.2 三张架构图）；阈值经 token 校准降到 800 行 / 20KB |
| [D03：长命令与跳过](./decisions/D03-long-running-skip-and-background.md) | ③ T09 / T14 | 不设执行上限，用「跳过/取消 + 后台回读」替代「超时杀死」；阈值 **10 秒**（与 Codex 数值相同、语义相反）；零新工具；**Ctrl-X 取消 / Ctrl-S 跳过，不复用 Ctrl-C**（人眼前看到的是 Agent 不是命令）；**落盘/弃内存/给不给正文是三个正交开关**（修订 D02-19）；跳过与取消**同为 TTY 专属**（CI 下明示无兜底） |
| [D04：进程生命周期](./decisions/D04-process-lifecycle.md) | ④ T10 / T14 | **三道防线**（退出钩子 / watcher 轮询 / 读取侧超时）对应三种死法；实测 `nohup`、`disown` 都杀得掉，**只有 `setsid` 能逃**且会攥着 fd 挂死 loop；Node 无 PDEATHSIG 故用 watcher 包装（⚠️ 它必须重定向，否则自己成故障源）；退出时**询问不默认杀**；完成通知搭 `terminal` 回执便车 |
| [D05：执行环境](./decisions/D05-execution-environment.md) | ⑤ T06 / T07 / T03 | **「一致」必须拆成能力（继承）与呈现（覆盖）两个相反方向**；⚠️ **推翻 T03 原推理** —— `process.env` 在桌面 App / 服务 / CI / cron 下拿不到用户 PATH，要起一次 `$SHELL -lc` 采集；采集三坑（欢迎语污染 / rc 里的 `read` 挂死 / 需 SIGKILL 超时）；**`.zshrc` 是 zsh 唯一 login+非 login 都读不到的文件**；`TERM=dumb`（「不设」最差）；**第三类变量「宿主污染」判据是"谁塞的"** |
| [non-interactive-execution-env.md](./notes/non-interactive-execution-env.md) | T06 / T07 / T08 | 非交互执行的四通道防线；「一致性」必须拆成能力与呈现两类 |
| [production-agent-lessons.md](./notes/production-agent-lessons.md) | 全局（第六样本） | 一个生产级桌面 Agent 产品的踩坑归因：哪些是分发环境特有、哪些 zero2agent 必然触发 |
| [t01-t14-verdicts.md](./notes/t01-t14-verdicts.md) | T01–T14 | ⚠️ **已过时**：早期裁决建议，其中 5 条被 D01–D05 推翻（T03/T05/T06/T09/T14），保留作推理轨迹；以本文件 Confirmed/Rejected 为准 |
| [article-topics.md](./notes/article-topics.md) | — | 本章可独立成文的选题池（A/B/C 分级 + 写作顺序） |

## 📚 调研要点速查

供讨论时引用，完整内容见 [researches/terminal/](../../../researches/terminal/README.md)：

| 发现 | 证据 |
|------|------|
| 「正常执行路径」核心仅几十行，重量全在安全与特殊命令 | pi-mono ~40 行；Gemini 4000 行里「纯执行不到 100 行」 |
| exit code 真的会漏 | OpenCode V1 挂 metadata 模型看不到（`shell.ts:585-593` + `message-v2.ts:292-295`），V2 补上 `Command exited with code N.`（`core/src/tool/bash.ts:118-121`） |
| 「无超时」只在有人兜着时成立 | pi-mono 有流式+取消键；Aider 走 pty 人能 Ctrl-C |
| 截断普遍保尾，因错误在结尾 | pi-mono `truncate.ts:162-167` 注释明写；OpenCode shell 专用 `tail()` |
| 截断后落盘并告知路径 | OpenCode `shell.ts:578-580`；pi-mono 尾注含行范围 + 文件路径 |
| stdin 一律 `ignore` | OpenCode `shell.ts:298,307`；pi-mono `stdio[0]="ignore"`；Gemini 非 PTY 路径同 |
| 禁凭据弹窗的 env 注入 | Gemini `shellExecutionService.ts:512-521`（`GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS=''`、`SSH_ASKPASS=''`、`GH_PROMPT_DISABLED=1`、`GCM_INTERACTIVE=never`、`DISPLAY=''`、`DBUS_SESSION_BUS_ADDRESS=''`，另用 `GIT_CONFIG_KEY_N=credential.helper` + 空值覆盖 credential helper） |
| 终端规格化 env | Gemini `shellExecutionService.ts:490-492`：`TERM=xterm-256color`、`PAGER=cat`、`GIT_PAGER=cat` |
| 命令替换硬拦截 | Gemini `shell.ts:468-478`，检测到 `$(` / 反引号直接拒绝，不 spawn |
| shell 不可自动批准 | Aider `io.py:866-867` `explicit_yes_required`，全局 `--yes` 也拒 |
| 杀进程组三行成本 | pi-mono `utils/shell.ts:203-216`：`detached:true` + `kill(-pid)`，失败退化单 pid |
