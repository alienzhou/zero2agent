# 终端执行（terminal / shell）—— 五竞品横向对比

> 调研日期：2026-08-26 ｜ 服务对象：zero2agent E02-S003（terminal）
> 上游：本调研聚焦「让 Agent 执行 shell 命令」的机制。全量写/删见 [write-file 调研](../write-file/README.md)，局部改见 [replace-in-file 调研](../replace-in-file/README.md)。
>
> **本轮为实证调研**：五家竞品源码在本地检出，每篇分报告的结论都标注了 `文件:行号`。这是对 [E02-S002 复盘](../../retros/E02-S002-replace-in-file.md)「调研偏推断而非实证」这条教训的直接回应。

## 调研范围

| 竞品 | 调研 Commit | 分报告 |
|------|-------------|--------|
| OpenCode | `743f6410` (2026-07-23) | [opencode.md](./opencode.md) |
| Codex | `ce803c45` (2026-07-23) | [codex.md](./codex.md) |
| pi-mono | `65ff8e7f` (2026-07-23) | [pi-mono.md](./pi-mono.md) |
| Gemini CLI | `d76d2d07` (2026-07-23) | [gemini-cli.md](./gemini-cli.md) |
| Aider | `5dc9490b` (2026-05-22) | [aider.md](./aider.md) |

S003 的边界是**只做正常执行路径**（依据 [D04：Epic 2 规划](../../.discuss/2026-03-14/zero2agent-course-roadmap/decisions/D04-stage2-roadmap.md)）。后台执行 / 长时间运行 / 交互式命令归 S004，本文对这部分只做记录、不做选型。

---

## 一、总览矩阵

| 维度 | OpenCode | Codex | pi-mono | Gemini CLI | Aider |
|------|----------|-------|---------|-----------|-------|
| 架构 | tool call | tool call（两套并存） | tool call | tool call | **非 tool call**：模型建议 + 人确认 |
| 工具名 | `bash`（源码叫 shell） | `shell_command` / `exec_command` | `bash` | `run_shell_command` | `/run`、`/test`、` ```bash ` 块 |
| 参数 | `command` / `timeout` / `workdir` | `command` / `workdir` / `timeout_ms` | `command` / `timeout` | `command` / `description` / `dir_path` / `is_background` / `delay_ms` | 无 schema（文本解析） |
| 走 shell | ✅ 用户默认 shell | ✅ | ✅ bash `-c` | ✅ 平台分支 | ✅ `shell=True` |
| stdout/stderr | **合流** | 分段呈现 | **合流** | **合流** | **合流** |
| exit code 给模型 | ❌ 仅 metadata | ✅ `Exit code:` 前缀 | ✅ 拼进错误消息 | ✅ `Exit Code:` 字段 | ❌ 不含退出码 |
| 非零退出 | 普通回执 | 失败通道（仍回模型） | **throw**（带输出） | 普通回执 | 触发反射循环 |
| 默认超时 | 2 分钟 | **10 秒** | **无超时** | 5 分钟（**无输出**超时） | **无超时** |
| 模型可指定超时 | ✅ | ✅ | ✅ | ❌ | —— |
| 截断 | 截尾 + 落盘 | **掐中间留头尾** | 截尾 + 落盘 | 有 | **无截断** |
| 截断阈值 | 2000 行 / 50KB | 按 token 预算 | 2000 行 / 50KB | —— | —— |
| 告知模型被截断 | ✅ | ✅（含原始 token 数） | ✅（含行范围 + 文件路径） | ✅ | —— |
| 杀进程方式 | 进程组 SIGTERM→SIGKILL | 进程组 + I/O 排空 | 进程组 SIGKILL | 进程组 | —— |
| 命令黑白名单 | ❌ 无 | ✅ Starlark DSL 策略 | ❌ 无 | ✅ tree-sitter 白黑名单 | ❌ 无 |
| 沙箱 | ❌ 无 | ✅ seatbelt/seccomp | ❌ 无 | 可选 | ❌ 无 |
| 逐条命令确认 | ✅ 默认 ask | ✅ 沙箱拒绝后升级 | ❌ 无 | ✅ 默认 ask | ✅ 且不可 auto-yes |
| cwd 逃逸防护 | 升级为额外询问 | —— | ❌ 无 | ✅ 硬校验（仅管 cwd 参数） | ❌ 无 |
| 模型能写 stdin | ❌ `ignore` | ✅ `write_stdin`（新工具） | ❌ `ignore` | ❌ | pty 交给**人**敲 |
| 执行相关代码量 | ~950 行（V1） | 数千行 | **~40 行核心逻辑** | ~4000 行 | ~130 行 |

---

## 二、跨竞品关键洞察

### 🔑 洞察 1：「正常执行路径」本身只有几十行，重量全在安全与特殊命令上

这是本轮最重要的发现，且有交叉证据：

- pi-mono 剥掉流式节流、跨平台 shell 解析和 TUI 渲染后，**核心逻辑约 40 行**：spawn 进程组 → 合并两条流 → 等退出 → 截尾 → 非零则带输出抛错。
- Gemini CLI 的 shell 相关代码约 4000 行，但分报告明确指出「**纯执行逻辑不到 100 行**」，一半篇幅在 sandbox 权限协商与执行后的 denial 启发式。
- OpenCode 的近 300 行安全代码全是 tree-sitter 解析命令抽路径，与「执行」无关。

→ S003 可以在**很小的代码量**内交付一个真正可用的 `terminal`。教学叙事的重点不该是「怎么起进程」（太简单），而是「起进程之后，你被迫面对哪些新问题」。

### 🔑 洞察 2：exit code 是最容易漏掉、且真的会漏的一环

OpenCode V1 把 `exit` 挂在 `metadata` 上（`shell.ts:585-593`），而序列化给模型时只取 `state.output`（`message-v2.ts:292-295`）——**模型看不到退出码**，命令失败且无输出时只能看到字面 `(no output)`。

这不是我们的推测：同一个 commit 里 OpenCode 的 V2 实现（`core/src/tool/bash.ts:118-121`）显式追加了 `Command exited with code N.`，等于官方承认了这是要修的问题。Aider 也有同类信息损失——`prompts.run_output` 不含退出码，接到的 `exit_status` 从未使用。

→ 这是 S003 一个现成的教学锚点：**结构化返回值里，哪些字段真的到了模型手里？** 一个竞品的前后版本对比，比讲道理有说服力。回执必须显式包含 exit code。

### 🔑 洞察 3：非零退出「算不算错误」，四家给了三种答案

- **普通回执**：OpenCode、Gemini CLI —— 退出码只是回执里的一个字段
- **失败通道但仍回模型**：Codex —— 包装成 `RespondToModel`
- **throw**：pi-mono —— 但**把已捕获的输出拼进错误消息**（`bash.ts:451-453`）

pi-mono 那个细节值得单独拎出来：抛错时不丢输出。因为「命令失败」时 stderr 恰恰是模型最需要的信息，如果 throw 掉输出只留一句「exit 1」，模型就瞎了。

→ zero2agent 现有 7 个工具的约定是「错误以 `Error: ...` 字符串返回，不抛异常」。`terminal` 天然契合：非零退出是**命令的正常结果**，不是工具故障。工具故障（spawn 失败）才该走错误路径。

### 🔑 洞察 4：超时的分歧最大，而「无超时」只在有人兜着时才成立

默认值从 10 秒（Codex）到 2 分钟（OpenCode）到 5 分钟（Gemini）到无超时（pi-mono、Aider），跨度极大。但真正的关键不是数值，而是**「无超时」的前提条件**：

- pi-mono 敢不设默认超时，因为它有流式输出 + 取消键——人能看见卡住并中断
- Aider 敢不设超时，因为它走 pty 且**人就在终端里**（`child.interact()`，用户可以直接 Ctrl-C）

zero2agent 的 `terminal` 是全自动 Agent 调用的，既无流式输出也无取消键。**照抄「无超时」会让 `sleep 999` 直接挂死整个 ReAct 循环。**

另外 Gemini 的超时语义是「**无输出超时**」而非总时长——每个输出事件重置计时器（`shell.ts:582-605`）。这个设计对「跑得久但一直有输出」的构建命令更友好。

→ S003 必须有默认超时，且这是一个**有意偏离**竞品最轻实现的决定，理由充分（无人在环）。是否采用「无输出超时」语义值得讨论。

### 🔑 洞察 5：截断方向普遍是「保尾」，因为错误在结尾

OpenCode 和 pi-mono 都对 shell 输出**截尾保留末尾**，pi-mono 源码注释直接写明理由（`truncate.ts:162-167`：错误通常在结尾）。OpenCode 更明显——同一个 `Truncate` 服务，通用输出默认截头（`truncate.ts:89`），shell 专门走自己的 `tail()`。

Codex 是唯一的例外：**掐中间、留头尾**，且按 token 预算而非字节。

两家还都做了「落盘 + 把路径告诉模型」，让模型能自己 grep 回被丢掉的部分——截断不等于信息永久丢失。

→ S003 应该截尾。落盘可留 backlog，但**告知模型「被截断了」是必须的**，否则模型会把残缺输出当完整结果。

### 🔑 洞察 6：`terminal` 是第一个 cwd 硬校验管不住的工具

前 7 个工具靠 `resolveInsideCwd` 就能守住物理边界，因为它们的操作对象是**路径参数**。`terminal` 的参数是一段**任意命令文本**，`resolveInsideCwd` 无从下手：`cd / && rm -rf` 里没有任何路径参数可校验。

五家的应对分三档：

1. **不管**（pi-mono、Aider）——命令原样交给 shell，`cd /` 允许
2. **解析命令抽路径**（OpenCode 近 300 行 tree-sitter，Gemini 手写引号状态机 + 根命令提取）
3. **沙箱 + 策略引擎**（Codex 四层：Starlark DSL → 安全启发式 → 平台沙箱 → 审批升级）

值得注意 Gemini 的一处硬拦截：检测到命令替换（`$(`、反引号）**直接拒绝，连 spawn 都不发起**（`shell.ts:468-478`）。也值得注意 OpenCode 那 300 行的实际效果——遇到 `$(...)` 动态展开时只是**放弃路径解析，命令照跑**。

→ 这是 S003 最有价值的教学点：**物理边界第一次失效**。诚实地讲清「cwd 校验为什么管不住 terminal」，比假装能管住更有教育意义。至于怎么补，选项是「层层加码解析」还是「换一层边界（人工确认，Epic 3）」——这是个设计讨论，不是实现细节。

### 🔑 洞察 7：几件零成本、高收益的小事，四家有共识

不涉及架构，但直接影响可用性：

| 做法 | 出处 | 价值 |
|------|------|------|
| **把返回契约写进工具描述** | Gemini `dynamic-declaration-helpers.ts:48-56` | 逐条声明哪些字段何时出现，模型不用猜 |
| **把默认超时/截断阈值写进描述** | OpenCode `prompt.ts:97-98` | 模型知道自己有多少预算 |
| **注入禁止凭据弹窗的 env** | Gemini `shellExecutionService.ts:505-521` | `GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS=''`、`DISPLAY=''` 等，几行常量消灭「命令挂住不返回」这类最难排查的问题 |
| **降噪规则写进描述** | Gemini | `--no-pager` / `PAGER=cat`，避免分页器把命令挂住 |
| **`workdir` 参数替代 `cd`** | OpenCode `prompt.ts:19-21` | 描述里直接写 `Use this instead of 'cd' commands.` |
| **杀进程组而非单 pid** | pi-mono `utils/shell.ts:203-216` | `detached: true` + `process.kill(-pid)`，三行解决孤儿孙进程 |

→ 这些是 S003 该抄的，成本几乎为零。

### 🔑 洞察 8：Aider 的「非 tool call」路线，反证了 tool 契约的价值

Aider 不用工具调用：模型在回复里写 ` ```bash ` 块，被 editblock 解析器当成「文件名为 None 的 edit」抽出（`editblock_coder.py:33, 452-485`），再弹确认框执行。命令输出回上下文时，因为**没有 `tool_result` 槽位**，只能伪造一对 user/assistant 消息塞进去（`commands.py:1026-1044`）。

同时 Aider 有一处安全表态值得记下：`explicit_yes_required=True` 使得**即使用户全局开了 `--yes`，模型建议的 shell 命令依然被拒**（`io.py:866-867`）。Aider 明确把「执行模型建议的命令」划为不可 auto-approve。

→ 对 S003 的意义：tool-calling 架构下 `terminal` 的回执天然有位置放，这是我们已有的优势。而 Aider 那条「shell 不可自动批准」的判断，可以直接作为 Epic 3 approval 分级的输入。

---

## 三、对 S003 讨论议题的初步映射

> 以下是**基于调研的倾向**，不是结论。正式决策待 `.discuss/` 讨论收敛。

| 议题 | 竞品证据 | 倾向 |
|------|---------|------|
| 工具名与参数 | OpenCode / Codex 都是 `command` + `timeout` + `workdir` 三件套 | `command` 必填 + `timeout` 选填；`workdir` 待议（当前 `ctx` 只有 cwd） |
| 走不走 shell | 五家全走 shell | **走 shell**，否则 `\|`、`&&`、重定向全废 |
| 用哪个 shell | OpenCode 用用户默认 shell，pi-mono / Gemini 用 bash | 待议：教学项目宜简（固定 `bash -c`），但要说清取舍 |
| stdout/stderr | 4/5 家合流 | **合流**，实现简单且模型只关心「输出」 |
| exit code | OpenCode V1 漏了并在 V2 修补；Aider 也漏 | **必须显式进回执**，这是教学锚点 |
| 非零退出语义 | 三种答案；pi-mono throw 但带输出 | **普通回执**（符合现有「Error 字符串」约定）；命令失败 ≠ 工具故障 |
| 超时 | 10 秒 ~ 无超时，跨度极大 | **必须有默认超时**（无人在环）；数值与「无输出超时」语义待议 |
| 截断 | 普遍截尾；阈值 2000 行 / 50KB | **截尾 + 告知模型**；落盘留 backlog |
| 进程清理 | 三家杀进程组 | **杀进程组**（`detached` + `kill(-pid)`），三行成本 |
| 安全边界 | 从「不管」到「四层沙箱」跨度极大 | cwd 校验失效需**诚实讲清**；黑白名单/沙箱不做（记 backlog），确认机制归 Epic 3 |
| env 注入 | Gemini 一整套禁弹窗常量 | **抄**，成本几行 |
| 工具描述 | Gemini 把返回契约写进描述 | **抄**，含超时/截断阈值告知 |
| `ToolContext` 是否扩展 | S001 D07 / S002 D07 都决定不扩展 | 待议：`terminal` 可能需要超时配置或流式回调，这次也许扛不住 |
| stdin / 后台 / 交互式 | 归 S004 | **不做**。Codex 的 `exec_command` + `write_stdin`、Gemini 的后台三件套、OpenCode V2 的 TODO 清单可作 S004 需求输入 |
