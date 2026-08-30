# E02-S003：让 Agent Harness 能驱动执行环境（terminal）

> 讨论始于 2026-08-26。目标：给 Agent Harness 引入 `terminal` 工具，让它能执行 shell 命令、拿到真实运行结果。
>
> 上游依据：[D04：Epic 2 规划](../../2026-03-14/zero2agent-course-roadmap/decisions/D04-stage2-roadmap.md)——Terminal 只做**正常执行路径**，长时间运行 / 前台阻塞 / 交互式命令归 S004。
>
> 竞品调研：[researches/terminal/](../../../researches/terminal/README.md)（五家实证调研，每条结论带 `文件:行号`）

---

## 🔵 Current Focus

**「非交互执行环境」三题联审：T06（env 规格化）+ T07（不做 pty）+ T08（防卡死）**

三题同源：它们讲的是同一件事——Agent 拿到的不是「一个终端」，而是一个**刻意非交互的执行环境**。已提出的分析框架（待用户确认）：

- **一致性要拆成两类**：
  - 「环境能力」必须一致 —— `PATH`、语言运行时版本、locale、用户 rc 里的 nvm/pyenv 结果 → 做法是**继承 `process.env`**
  - 「呈现与交互」必须刻意不一致 —— 颜色、分页器、凭据弹窗 → 做法是**定向覆盖少数几个变量**
- **防卡死是四道分层防线**（对应四个不同的输入通道）：
  1. `stdin: "ignore"` → 从 stdin 读的程序立刻拿到 EOF，走非交互分支
  2. 不给 pty → `isatty() === false`，程序普遍自动降级（不分页、不问、不 spinner）
  3. env 注入 → 拦住绕过 stdin 直接开 `/dev/tty` 的（git/ssh/gpg credential）
  4. 超时兜底 → 前三道都漏掉的最终保险
- **反直觉结论**：T07「不做 pty」不是为简化付出的代价，它本身就是防卡死的第 2 道防线。Aider 之所以要 pty，恰恰因为它要**人**来交互（`child.interact()`）。

待确认分歧点见「Open Questions」。

## ⚪ Pending

### 工具契约

- **T01** 工具名与参数集：`command` 必填 + 哪些选填？（竞品共识是 `command` / `timeout` / `workdir` 三件套）
- **T02** 要不要 `workdir` 参数：加了就要动 `ToolContext`（当前只有 `cwd`）
- **T03** 用哪个 shell：固定 `bash -c`（教学宜简）还是用户默认 shell（OpenCode 做法）
  - 关联 T06：`bash -c` 是 non-login non-interactive，**不读 `.bashrc` / `.zshrc`**。但 Agent 进程通常由用户终端启动，`process.env` 已含 rc 处理后的 `PATH`，所以继承 env 即可，无需加载 rc —— 需要在 spec 里讲清这条推理，否则读者会以为要 `-lic`

### 返回契约

- **T04** exit code / stdout / stderr 怎么进回执：stdout 与 stderr 合流还是分段？非零退出算普通回执还是错误？
- **T05** 输出截断策略：截尾还是掐中间？阈值多少？**是否落盘临时文件 + 让模型渐进式读取**（用户提出）

### 执行环境（🔵 本轮联审中）

- **T06** 终端环境规格化：`TERM` / `PAGER` / `NO_COLOR` / 凭据弹窗禁用等 env 注入（用户提出）
- **T07** 简化终端的边界：不做 pty、不做终端 UI，代价是什么、哪些命令会失效（用户提出）

### 卡死与超时

- **T08** 交互式命令卡死怎么防：等 `y` 输入类命令的处理（用户提出）🔵 本轮联审中
- **T09** 超时机制：默认多少？模型可否指定？总时长超时还是「无输出超时」（Gemini 语义）？
- **T10** 进程清理：杀单 pid 还是杀进程组？

### 安全边界

- **T11** cwd 硬校验失效怎么办：`terminal` 是第一个物理边界管不住的工具，讲清还是补救？
- **T12** 黑白名单 / 沙箱：做不做（竞品从「完全不管」到「四层沙箱」跨度极大）

### 架构

- **T13** `ToolContext` 是否终于要扩展：S001 D07 / S002 D07 都决定不扩展，`terminal` 可能扛不住
- **T14** S004 需求输入：本轮明确不做但需记录的（后台执行、stdin 续写、pty）

## ✅ Confirmed

（暂无）

## ❌ Rejected

（暂无）

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
