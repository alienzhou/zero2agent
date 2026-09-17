# E02-S004：让 Agent Harness 应对交互式命令（stdin 续写 / pty）

> 讨论始于 2026-09-18。目标：给 `terminal` 补上**交互式命令**这最后一块 —— 让 Agent 面对「会停下来等输入」的命令时，不再只能挂死或 EOF 失败。
>
> 上游依据：
> - [D04：Epic 2 规划](../../2026-03-14/zero2agent-course-roadmap/decisions/D04-stage2-roadmap.md) —— S004 原定「长时间 / 前台阻塞 / 交互式」三件。
> - [S003 D03 §五](../../2026-08-26/e02-s003-terminal/decisions/D03-long-running-skip-and-background.md) 与 [S003 D04 §6.6](../../2026-08-26/e02-s003-terminal/decisions/D04-process-lifecycle.md)：**两次重画 S003/S004 的线，方向相同** —— 长命令、进程生命周期先后被拉回 S003。**S004 至此只剩「交互式」**，判据从「久不久」（无客观界线）收敛为「**要不要人输入**」（有客观界线）。
>
> 竞品实证：[researches/terminal/](../../../researches/terminal/README.md)，本章重点看 [codex.md §G](../../../researches/terminal/codex.md)（`exec_command` + `write_stdin` 会话范式）与 [aider.md §B/§G](../../../researches/terminal/aider.md)（pty `child.interact()` 把终端交给人）。

---

## 🧭 推进方式

延续 S003 的做法：按**五个核心议题**逐条推进，每条产出一份 `decisions/Dxx-*.md`（竞品实证 + 我们的思考 + 决策 + 待定项）。五条走完，教学骨架成型，再进入 spec。

| # | 议题 | 一句话 | 决策文档 | 状态 |
|---|------|--------|---------|------|
| ① | **问题定义**：交互式到底是什么 | 四道防线是为了「不盲等」不是「永不输入」；「要不要人输入」往下还要拆「**谁持有答案**」 | [D01](./decisions/D01-what-is-interactive.md) | 🟡 初步收敛 |
| ② | **检测**：怎么知道命令在等输入 | 系统层没有「blocked on read」的信号；不猜，改成「**发起方声明** + 静默兜底」 | [D02](./decisions/D02-detecting-waiting-for-input.md) | 🟡 初步收敛 |
| ③ | **范式**：会话 + 谁写 stdin | 保留一次性 `terminal` 单出口；交互走**新会话通道 + 模型写 stdin**（不是人接管） | [D03](./decisions/D03-session-and-who-writes-stdin.md) | 🟡 初步收敛 |
| ④ | **pty**：要不要开伪终端 | 为守零依赖基调，本章**只做 stdin 管道（无 pty）**；isatty 门控与 /dev/tty 密码提示记为**明示缺口** | [D04](./decisions/D04-pty-and-native-dep.md) | 🟡 初步收敛 |
| ⑤ | **生命周期与安全边界** | 交互会话复用 S003 三道防线 + 新增空闲兜底；「只有人能答」的输入（密码/确认）划给**审批专章** | [D05](./decisions/D05-lifecycle-and-security-boundary.md) | 🟡 初步收敛 |

### 为什么是这个顺序（叙事链）

```
① 先厘清「交互式」是什么          ← 把"要不要人输入"拆成"谁持有答案"
   ↓ 既然要收回一部分输入能力，第一个问题是：怎么知道它在等
② 检测："等输入"无法被观测        ← 不猜，改"声明 + 兜底"
   ↓ 知道它在等之后，用什么形状把输入喂进去
③ 范式：会话 + 模型写 stdin       ← 新通道，不破 terminal 单出口
   ↓ 要能写 stdin，就得改 stdio[0]='ignore'（防线①），代价是什么
④ pty：无 pty 能覆盖到哪          ← 只覆盖"读 stdin"那类，isatty 门控的记缺口
   ↓ 会话是"活着且我们持有 stdin"的进程，比后台进程更需要收尾
⑤ 生命周期 + 安全                 ← 复用三道防线 + 新增空闲兜底；密码类推给审批层
```

三个关键衔接点：

- **① → ②**：①把「交互」定义成「一次可回答的请求」，②紧接着问「那我们怎么知道请求发生了」——答案是**观测不到，只能声明**。
- **③ → ④**：③要让模型写 stdin，就必须把 S003 的 `stdio[0]='ignore'`（防线①）改成 `'pipe'`；④紧接着算这笔账——**只改 stdin 管道、不上 pty，到底能覆盖多少交互命令**。
- **④ → ⑤**：④决定「密码这类走 /dev/tty 的命令我们够不着」，⑤把它接住——**那正是「只有人能答」的一半，本就该推给审批层**。

⚠️ **本章与 S003 的关系是"拆防线"**：S003 用四道防线（`stdio[0]='ignore'` / 无 pty / env 注入 / 超时兜底）**主动关掉**了交互性；S004 是**有节制地、只对显式会话**重新打开其中一道（防线①），并为此新建一套兜底。所以本章通篇要回答的核心问题是：

> **怎么把一道防线打开一条缝，而不把它当初挡住的挂死问题放回来。**

---

## 🔵 Current Focus

**五个议题已产出初稿（D01–D05），处于「初步收敛、待评审 + 待代码核对」阶段。**

- 讨论产物：`decisions/D01–D05`（本轮初稿）+ 本文件的 Confirmed / Rejected / Pending 表
- **下一步**：
  1. 对 D03/D04 的实现张力做一次**代码核对**（`terminal.ts` 的 `stdio`、`OutputSink`、`process-registry.ts` 只存 pid 不存 handle 这几处），确认「会话表 ≠ 后台登记表」这条判据落得下去。
  2. 评审收敛后进入 spec：`specs/E02-act-and-execute/S004-interactive-commands/`（README + details/ 五份）。
  3. 实现 + 复盘 + CHANGELOG + Tag `E02-S004-*`。

> ⚠️ 与 S003 outline 的自我提醒一致（D03-8）：**写决策前先看代码**。本轮 D03/D04 涉及对 `terminal.ts` 现状的判断，spec 阶段前必须逐条核对，避免凭对 S003 的记忆推断现状。

## ⚪ Pending（待评审时拍板）

| # | 待定 | 现倾向 | 见 |
|---|---|---|---|
| P1 | 交互能力是新工具 `write_stdin`，还是给 `terminal` 加 `input` 参数 | **新工具**（不破 `terminal` 单出口 / 单参数集） | D03 |
| P2 | 会话 id 用 pid 还是独立发号 | 独立发号（pid 会复用，且不想让模型拿 pid 直接 `kill`） | D03 |
| P3 | 空 input 是否等于「只轮询不写」 | 借 Codex，**是** | D03 |
| P4 | Ctrl-C 送进会话是写 `\u0003` 还是走取消 | 借 Codex 写 `\u0003`；「取消整个会话」复用 S003 的 Ctrl-X 语义 | D03 / D05 |
| P5 | 交互会话空闲超时取值 | 待实测（S003 是 10 秒耐心线，交互场景可能更长） | D02 / D05 |
| P6 | 会话数上限取值 | 教学项目取小值（如 8），远小于 Codex 的 64 | D05 |
| P7 | pty 是否留一个「将来可插拔」的接口位 | 倾向留 runtime hook 形状，但本章不实现 | D04 |

## ✅ Confirmed（初步）

| # | 结论 | 依据 |
|---|---|---|
| C1 | 「要不要人输入」再拆一层「**谁持有答案**」：模型能答的（REPL 表达式 / `y/N` / bash `read`）是 S004 主战场；只有人能答的（密码 / 2FA / 真·危险确认）划给审批层 | D01 |
| C2 | **不检测「正在等输入」**（系统层无此信号），改为「模型显式声明交互」+ 复用 S003 静默/超时兜底 | D02 |
| C3 | 保留一次性 `terminal` 的 `Promise<string>` 单出口（**第五次不破**）；交互走**新工具 + 会话** | D03 |
| C4 | 交互态把 `stdio[0]` 从 `'ignore'` 改为 `'pipe'`——**这是有节制地打开防线①**，只对显式会话 | D03 |
| C5 | **会话表 ≠ S003 后台登记表**：前者持有 live handle + 可写 stdin，后者只存 pid 且已 detach/unref。两种相反的持有方式 | D03 |
| C6 | 谁写 stdin：**模型**（`write_stdin`），不是人接管终端（否决 Aider 的 `child.interact()`）；TUI 可选让人也往会话里敲，属呈现层，复用既有事件通道 | D03 |
| C7 | 本章**不引入 pty**（node-pty 是原生编译依赖，撞 S003 D04-5「零依赖基调」）；覆盖「读 stdin」那类交互 | D04 |
| C8 | isatty 门控程序（`git rebase -i` 编辑器 / 全屏 TUI）、/dev/tty 密码提示 → **明示缺口** + 工具描述引导非交互替代 | D04 |
| C9 | 交互会话复用 S003 三道防线（Ctrl-X 取消 / drain 超时 / watcher / 退出询问），**新增「会话空闲超时」**防新的挂死 | D05 |
| C10 | S004 只做「输入通道」，**不做「该不该输入」的策略**（同 S003 把命令解析推给安全专章） | D05 |

## ❌ Rejected（初步）

| 被否掉的 | 理由 | 依据 |
|---|---|---|
| **Aider 式「人接管终端」（`child.interact()`）** | zero2agent 是自主 Agent，不是「人在环内的结对工具」；交出控制权破坏 Agent 闭环，且只在 TTY 成立 | D01 / D03 |
| **检测「进程 blocked on stdin」** | 系统层没有可靠信号；`EPERM`/静默都无法与「就是没输出」区分 | D02 |
| **给 `terminal` 加 `input` 参数复用同一工具** | 会把「一次性执行」和「会话续写」两种生命周期塞进一个契约，重演 OpenCode V1 的信息分叉 | D03 |
| **本章引入 node-pty** | 原生编译依赖，`npm install` 可能失败；连 Codex 都把 PTY 放 feature flag + `conpty_supported()` 后 | D04 |
| **让模型写密码 / 2FA** | 「只有人能答」的输入，模型写等于把凭据吐进上下文；这是能力边界问题，不是行为问题 | D01 / D05 |

## 🗒️ 讨论笔记索引

| 笔记 | 覆盖 | 一句话 |
|------|------|--------|
| [D01：交互式是什么](./decisions/D01-what-is-interactive.md) | ① | 四道防线防的是「盲等」不是「输入」；判据再拆「谁持有答案」，分出模型能答 / 只有人能答两半 |
| [D02：怎么知道在等输入](./decisions/D02-detecting-waiting-for-input.md) | ② | 「正在等输入」无法被观测；不猜，改「声明 + 静默兜底」；复用 S003 的 10 秒静默信号 |
| [D03：会话与谁写 stdin](./decisions/D03-session-and-who-writes-stdin.md) | ③ | 新工具 `write_stdin` + 会话；`stdio[0]` 由 `ignore` 改 `pipe`；会话表持有 live handle，与 S003 只存 pid 的登记表相反 |
| [D04：pty 与原生依赖](./decisions/D04-pty-and-native-dep.md) | ④ | 无 pty 只覆盖「读 stdin」那类；isatty 门控 / 密码提示记缺口；「无 pty」既是能力缺失也是一道安全防线 |
| [D05：生命周期与安全边界](./decisions/D05-lifecycle-and-security-boundary.md) | ⑤ | 会话复用三道防线 + 空闲兜底 + 软上限；密码类「只有人能答」的推给审批专章 |

## 📚 调研要点速查（服务本章）

供讨论引用，完整见 [researches/terminal/](../../../researches/terminal/README.md)：

| 发现 | 证据 |
|------|------|
| stdin 不给，交互命令会永久挂 | Codex `spawn.rs:107-116`（ripgrep 读 stdin 的注释）；S003 D01 据此定 `stdio[0]='ignore'` |
| 交互有两条相反路线：模型写 vs 人接管 | Codex `write_stdin`（`shell_spec.rs:113-155`）；Aider `child.interact()`（`run_cmd.py:120`） |
| 「yield 而非等待」把长任务 / 交互 / 后台一套机制解决 | Codex `shell_spec.rs:99-100`、`process_manager.rs:1246-1263` |
| 空 `chars` = 只轮询不写 | Codex `shell_spec.rs:121-126` |
| 非 tty 下 stdin 关闭，只留 `\u0003`（Ctrl-C）后门 | Codex `process_manager.rs:700-712` |
| pty 是重量级 / 有条件能力 | Codex unified_exec 在 feature flag + `conpty_supported()` 后；Aider pexpect 可选且 Windows 不支持（`run_cmd.py:11-23`） |
| pty 存在的唯一理由是「让人接管」 | Aider `child.interact()`（`run_cmd.py:120`），shell 以 `-i` 启动 |
| 「模型建议的 shell 命令」不可 auto-yes | Aider `io.py:866-867`（`explicit_yes_required` 压制 `--yes`） |
| 会话池软上限 + LRU，正被写的不淘汰 | Codex `process_manager.rs:1346-1385`，上限 64（`mod.rs:73`） |
| 后台/会话列表给 UI 不给模型 | Codex `process_manager.rs:1437-1454` → 只到 app-server |
