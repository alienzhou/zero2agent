# D04：pty —— 为守零依赖基调只做 stdin 管道；isatty 门控与密码提示记为明示缺口

> 议题 ④｜覆盖：要不要 pty、无 pty 的覆盖边界｜**依赖：D03（已开 stdin 管道）、S003 D04-5（零依赖基调）、S003 D05 §3.1（无 pty = 防线 #2）**
>
> 状态：🟡 初步收敛（待评审）

## 一、问题

D03 把 `stdio[0]` 开成了 `'pipe'`，模型可以写 stdin 了。但立刻有个扫兴的事实：

> **很多交互程序会先 check `isatty(0)`，发现不是终端就根本不进「提问」分支。** 那我们开的这条 stdin 管道，实际能喂到几类命令？

这一节要诚实地算这笔账，并决定**要不要为了覆盖更多命令而引入 pty**。

## 二、无 pty 时，交互命令分成两半

`isatty()` 把交互命令切成两类，我们的 stdin 管道只够得着其中一半：

| 类别 | 例子 | 无 pty（仅 stdin 管道）能不能行 |
|---|---|---|
| **读 stdin 那一类** | bash `read`、从管道读的 REPL（`python -c` 喂脚本、`node` 读 stdin）、`grep` 等待输入、许多 `[y/N]` 走 stdin 的确认 | ✅ **能** —— 它们直接 `read(0)`，不关心 isatty |
| **isatty 门控那一类** | `git rebase -i`/`git commit`（要拉起 `$EDITOR`）、`python`/`psql` 的**全交互 REPL**（检测到非 tty 会禁用提示符/行编辑）、`top`/`vim` 等全屏 TUI、走 `/dev/tty` 的密码提示 | ❌ **不能** —— 没 pty，`isatty()` 恒 false，它们要么走非交互分支、要么直接绕开我们的 stdin 去开 `/dev/tty` |

⚠️ **第二类里还藏着一条更硬的**：密码提示（`sudo`、`ssh`）通常**不读 stdin**，而是直接 `open("/dev/tty")` 去要输入 —— 就算我们有 pty，它也绕过管道。S003 的防线③（`GIT_ASKPASS=''` / `DISPLAY=''` 等 env 注入）就是拦这个的，**这条我们保留不动**（D03 决策四）。

→ 所以覆盖边界是：**无 pty 能覆盖「读 stdin」那一类交互；isatty 门控 + /dev/tty 那一类覆盖不了。**

## 三、要全覆盖就得 pty，而 pty = 原生编译依赖

要让 `isatty()` 返回 true、让 `git rebase -i` 肯拉编辑器，就得挂一个伪终端。Node 里做 pty 的标准答案是 **`node-pty`** —— 一个**原生模块**，`npm install` 时要本地编译（或下预编译二进制）。

⚠️ **这正撞上 S003 已经拍过的板**。[S003 D04-5 选项 B](../../../2026-08-26/e02-s003-terminal/decisions/D04-process-lifecycle.md) 在选「怎么防孤儿进程」时，明确否掉了「装 native 依赖」：

> B. 装 native 依赖 → 教学项目引入编译期依赖，`npm install` 可能失败 —— **违背零依赖基调**

当时为了替代 PDEATHSIG，宁可用纯 JS 的 watcher 变通（方案 D）也不引原生依赖。**同一条基调，这里必须一致对待 node-pty。**

## 四、竞品实证：连做 pty 的两家，都把它当「重量级 / 有条件」能力

不是只有教学项目怕 pty。看两家真做了 pty 的（[codex.md §A.1](../../../researches/terminal/codex.md)、[aider.md §B](../../../researches/terminal/aider.md)）：

| 竞品 | pty 的启用条件 | 证据 |
|---|---|---|
| **Codex** | PTY 路径（`exec_command`/unified_exec）**藏在 feature flag 后**，还额外要求 `codex_utils_pty::conpty_supported()`；截至调研 commit **8 个模型全是 `shell_command`（非 pty）** | `tool_config.rs:105-112`、models.json 全部 `shell_type: shell_command` |
| **Aider** | pty 走 `pexpect`（可选依赖），且**三条件全满足才走**：`sys.stdin.isatty()` + `pexpect` 可用 + 非 Windows；否则退回 subprocess | `run_cmd.py:11-23` |

→ **两家都没把 pty 当默认。** Codex 把它 gate 在 flag + 平台探测后，默认仍走非 pty 的 `shell_command`；Aider 把它 gate 在「人真的坐在 TTY 前 + 装了 pexpect + 不是 Windows」后。**这两个"启用条件"本身就是"pty 是重量级能力"的实证** —— 连生产级产品都不敢无条件开它。

⚠️ 而且 Aider 之所以要 pty，理由是**「让人接管终端」**（`child.interact()`）—— 这个理由 D01/D03 已经否掉了（我们是自主 Agent，不交控制权）。**抄 pty 要连它的动机一起抄**：Aider 的 pty 动机对我们不成立，那它这套 pty 我们更没理由抄（同 S003 D05「Gemini 的 `TERM=xterm-256color` 是为驱动 pty 里的 emulator，我们不做 pty 就不该抄那个值」的判据）。

## 五、决策：本章不做 pty，覆盖「读 stdin」那类；其余记明示缺口

**定案（C7/C8）：**

1. **不引入 node-pty**，守 S003 的零依赖基调。
2. 交互支持覆盖**「读 stdin」那一类**（bash `read`、从管道读的 REPL、走 stdin 的 `y/N`）—— 这已经是 D01 定义的「A 类：模型能答」里最常见的场景。
3. **明示缺口**，写进工具描述 + spec：
   - **isatty 门控的全交互程序**（`git rebase -i`、全屏 TUI）→ 引导非交互替代：`GIT_SEQUENCE_EDITOR=:`/`GIT_EDITOR=true`、`--no-edit`、`git rebase --onto` 之类脚本化写法。
   - **/dev/tty 密码提示**（`sudo`/`ssh`）→ 本就是 D01 的「B 类：只有人能答」，引导 `--password-stdin`、token / 环境变量 / SSH key 等非交互认证，或走审批层（Epic 3）。

### 5.1 一个反直觉的收获：「无 pty」同时是一道安全防线

D01 把「密码/2FA」划成「只有人能答」的 B 类，说模型不该写。**无 pty 恰好从物理上帮我们守住了这条**：

- 没有 pty，`isatty()` 恒 false → 大量密码提示走 `/dev/tty`，我们的 stdin 管道够不着 → **模型想写也写不进去**。
- 这跟 S003 D05 §3.1 那句「不做 pty 不是省功能的妥协，而是**主动关掉防线 #2**」是同一个视角 —— [article-topics A1](../../../2026-08-26/e02-s003-terminal/notes/article-topics.md) 已把它列为 A 级选题。

→ **「无 pty」既是能力缺失（够不着 isatty 门控程序），又是安全防线（够不着密码提示）。同一个"不做"，一面是遗憾，一面是护栏。** 这个双重性正是本章的教学钩子。

### 5.2 留一个「将来可插拔」的形状（P7，本章不实现）

虽然本章不做 pty，但 spec 阶段倾向把「起子进程的方式」抽成一个可替换点（就像 `terminal-runtime` 已经把 TTY 交互抽成 hook 那样），让将来若要接 pty（作为可选 peerDependency，用户自己决定装不装），能插进来而不改核心。**本章只留形状，不写实现，也不引依赖。**

## 六、本议题的决策清单

| # | 决策 | 类型 |
|---|---|---|
| D04-1 | **不引入 node-pty**，守 S003 D04-5 的零依赖基调 | 架构 |
| D04-2 | 交互覆盖范围 = **「读 stdin」那一类**；isatty 门控 / 全屏 TUI / /dev/tty 密码 → **明示缺口** | 产品（诚实度） |
| D04-3 | 缺口在工具描述里给**非交互替代**：`GIT_EDITOR=true`/`--no-edit`/`--password-stdin`/token/env | 产品 |
| D04-4 | 承认「无 pty」既是能力缺失也是一道安全防线（顺带堵死模型写密码） | 教学 / 安全 |
| D04-5 | spec 阶段留「起进程方式可插拔」的形状（P7），**本章不实现 pty、不引依赖** | 架构（预留） |

## 七、教学价值

1. **`isatty()` 把交互命令切成两半，stdin 管道只够得着一半** —— 「读 stdin」的够得着，「检测到终端才提问」的够不着。**"支持交互"不是一个布尔值，它有明确的覆盖边界，要说清而不是含糊带过。**
2. **抄竞品的能力，要连它的启用条件和动机一起抄** —— Codex 把 pty gate 在 flag + `conpty_supported()` 后、Aider gate 在「人在 TTY 前」后，这两个条件本身证明「pty 是重量级能力」；而 Aider 做 pty 的动机（人接管）对自主 Agent 不成立。**照抄形状不看前提，会抄到一个不属于自己的架构。**
3. **明示缺口 + 给替代，好过假装全覆盖** —— 承认够不着 `git rebase -i`，同时告诉模型用 `GIT_SEQUENCE_EDITOR=:`，比硬上 pty 假装什么都行更有教学价值（同 S003 D04-2 `setsid` 逃逸、D04-11 磁盘撑爆的处理）。
4. **同一个「不做」可以既是遗憾又是护栏** —— 无 pty 够不着 isatty 门控程序（遗憾），也顺手够不着密码提示（护栏，把 D01 的 B 类从物理上堵住）。**决定"不做某件事"时，先看看它是不是正好帮你挡住了另一件你本来就不想做的事。**
5. **一条基调要跨 Story 一致执行** —— S003 为它拒了 native 依赖（PDEATHSIG 用 JS watcher 变通），S004 为同一条基调拒了 node-pty。**基调的价值在于它被一致地执行，而不是每次重新讨论。**

## 八、向议题 ⑤ 的顺延

无 pty 的账算清了。剩下最后一块：一个交互会话是「活着、我们攥着 stdin、还在反复读写」的进程，它比 S003 的后台进程更「黏」。

> **它什么时候结束？空闲了怎么办？Agent 退出时怎么收？以及——那些我们决定"不让模型写"的密码类输入，到底归谁？**

见 D05。
