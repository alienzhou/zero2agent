# 笔记：Agent 拿到的不是「终端」，而是非交互执行环境

> 为 T06 / T07 / T08 三题联审准备的分析材料。证据来自 [researches/terminal/](../../../../researches/terminal/README.md)。

## 一、程序判断「能不能问用户」的四个通道

一个 CLI 程序决定要不要停下来等人，靠的不是一个开关，而是四条独立线索。防卡死之所以要分层，就是因为要各堵一条：

| # | 通道 | 程序的判断动作 | 我们的应对 | 竞品证据 |
|---|------|---------------|-----------|---------|
| 1 | stdin | 从 stdin 读一行 | `stdio[0] = "ignore"` → 立刻 EOF | OpenCode `shell.ts:298,307`；pi-mono `stdio[0]="ignore"`；Gemini 非 PTY 路径同 |
| 2 | tty | `isatty(stdout/stdin)` | 不给 pty → 恒 false | 反例：Aider 走 pty，因为它要**人**来交互（`child.interact()`） |
| 3 | `/dev/tty` | 绕过 stdin 直接开控制终端问密码 | env 注入禁用 credential helper / askpass | Gemini `shellExecutionService.ts:512-521` |
| 4 | 都没堵住 | —— | 超时 + 杀进程组 | pi-mono `utils/shell.ts:203-216` |

第 3 条是最容易漏的：`git push` 要凭据时不读 stdin，它开 `/dev/tty`。所以 `stdin: ignore` 对它无效，只有 env 能拦。这也是 Gemini 那一串常量存在的原因。

## 二、「一致性」必须拆成两类，否则会自相矛盾

用户提的关注点是「否则执行效果与用户自己在终端跑不一致」。但这个诉求不能整体成立——有一部分不一致是我们**主动要的**：

| 类别 | 要求 | 做法 | 举例 |
|------|------|------|------|
| 环境能力 | **必须一致** | 继承 `process.env` | `PATH`（nvm/pyenv 注入的 node/python 版本）、`HOME`、locale、代理变量 |
| 呈现与交互 | **必须刻意不一致** | 定向覆盖少数变量 | 颜色转义、分页器、凭据弹窗、进度条 |

即：**继承为默认，覆盖为例外**。Gemini 就是这个形状——它不构造干净 env，而是在继承基础上打补丁（`shellExecutionService.ts:490-492` 覆盖 `TERM` / `PAGER` / `GIT_PAGER`，`512-521` 覆盖凭据相关）。

反过来说，如果我们构造一个「干净」的最小 env，会立刻踩坑：用户 `.zshrc` 里 nvm 设置的 node 路径没了，`npm test` 直接 command not found。

## 三、`bash -c` 不读 rc 文件，但这不构成问题

`bash -c "cmd"` 是 non-login + non-interactive，**既不读 `.bash_profile` 也不读 `.bashrc`**。直觉上会担心「那 nvm 的 PATH 怎么办」。

推理链：Agent 进程本身是用户从自己的终端里启动的 → 用户 shell 已经跑过 rc → `process.env.PATH` 里已经含 rc 的成果 → 子进程继承即可。

所以**不需要** `bash -lic`。而且用 `-i`（interactive）反而有害：会激活交互特性（job control、提示符、部分程序据此改行为），与「非交互执行环境」的目标相反。

⚠️ 该推理的前提是「Agent 由用户终端启动」。若 Agent 跑在 launchd / systemd / CI 下，`process.env` 可能是精简的。S003 教学场景下前提成立，但值得在 spec 里点一句边界。

## 四、T07「不做 pty」的重新定位

调研初稿把「不做 pty」当成为简化付出的**代价**。联审后倾向认为这个定位是错的：

- 不给 pty ⇒ `isatty()` 为 false ⇒ 绝大多数良好实现的 CLI 自动降级：不分页、不问、不画进度条、不上色
- 也就是说，**不做 pty 本身就是防卡死的一道防线**，而不是留下的窟窿

真正的代价是另外三类，需要在 spec 里如实列出：

1. 依赖 tty 才能跑的程序会拒绝工作或行为退化（`top`、`vim`、`less` 交互态、部分 `docker run -it`）
2. 极少数程序不看 isatty、硬开 `/dev/tty`（靠第 3 道 env 防线兜）
3. 拿不到「像终端一样的实时渲染」，所以也就没有流式 UI —— 但 S003 本来不做流式

## 五、对 S004 的输入

- pty 与 stdin 续写是 S004 的核心（Codex `exec_command` + `write_stdin` 是现成参考）
- 「简化终端不做 VSCode 式交互 UI」这条判断应写进 S004 的非目标，避免下一轮重新讨论
