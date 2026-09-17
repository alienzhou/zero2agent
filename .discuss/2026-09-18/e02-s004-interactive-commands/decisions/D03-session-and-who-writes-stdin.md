# D03：范式 —— 新工具 + 会话，模型写 stdin；会话表与 S003 后台登记表正好相反

> 议题 ③｜覆盖：工具形状、会话数据结构、stdin 写入路径｜**依赖：D01（模型写）、D02（声明触发）、S003 D01-5/D04-14（单出口 + 只存 pid 的登记表）**
>
> 状态：🟡 初步收敛（待评审 + **待代码核对**）

## 一、问题

D01/D02 定了：交互态由模型声明触发，输入由模型写。剩下三个形状问题：

1. 交互能力是**新工具**，还是给 `terminal` 加参数？
2. 「一个还活着、可以被续写」的进程，用什么**数据结构**持有？
3. 模型的字节从哪条**路径**进到进程的 stdin？

## 二、决策一：新工具 `write_stdin`，不动 `terminal` 的单出口

S003 把 `terminal` 的返回侧守得极死 —— [D01-5 / D01-13 单出口 `Promise<string>` 已经"四次不破"](../../../2026-08-26/e02-s003-terminal/decisions/D01-tool-baseline.md)：不加 metadata、不加流式回调、不扩展 `ToolContext`。

给 `terminal` 加一个 `input` 参数来复用同一工具，会把**两种生命周期**塞进一个契约：

| | 一次性执行（S003） | 交互续写（S004） |
|---|---|---|
| 何时返回 | 命令结束 | 到 yield 点 / 静默阈值，**进程还活着** |
| 返回什么 | 终态回执（exit code + 输出） | **中间态**（部分输出 + 会话 id，无 exit code） |
| 后续 | 无 | 模型可能再写 N 次 |

⚠️ 把这两种硬塞进一个 `terminal`，就是在重演 OpenCode V1 的错误 —— [S003 调研洞察 2](../../../researches/terminal/README.md) 记过：V1 把 exit code 挂 metadata 导致模型看不到，本质是**一个出口承载了两种语义、信息在分叉处丢失**。

**定案（P1）：新增独立工具 `write_stdin`，`terminal` 契约一个字不改（第五次不破）。**

形状借 Codex（[codex.md §G](../../../researches/terminal/codex.md)），裁掉 zero2agent 不需要的部分：

```
terminal({ command, workdir, interactive?: true })
  → 非交互：同 S003，终态回执
  → 交互（模型声明）：进程保留，返回
        Session: <id>
        Output so far: ...
        Use write_stdin with this session id to continue; empty input polls for more output.

write_stdin({ session: <id>, input: string })
  → 把 input 写进该会话的 stdin，等一小段收输出，返回中间态回执（同上形状）
  → input 为空 = 只轮询不写（借 Codex 空 chars 语义，P3）
```

> ⚠️ **`interactive` 参数是否违反 S003「参数只留 command + workdir」（D01-1）？** 需评审。倾向：它是**意图声明**不是行为开关，且只对交互路径生效；但也可考虑用「模型直接调 `write_stdin` 前必须先有一个交互会话」的隐式方式。待 P1 拍板。

## 三、决策二：会话 id 独立发号，不用 pid（P2）

模型要拿一个 id 来续写。**不用 pid**，理由两条：

1. **pid 会复用** —— 进程退出后系统可能把同一个 pid 分给别的进程，模型拿旧 pid 写 stdin 会写错对象。
2. **不想让模型手里有 pid** —— pid 一旦进模型上下文，它就可能 `terminal("kill <pid>")`。而「杀进程」这件事 S003 D04-8 已经定了**只对人开放**。独立发号（如自增整数 / 短 hex）把「续写会话」和「操作系统进程」解耦。

⚠️ 呼应 Codex 的注释细节（[codex.md §G.6](../../../researches/terminal/codex.md)）：它的 `session_id` 也是独立于 pid 的发号，且 `list_processes` 只给 UI 不给模型。**「给模型一个句柄」和「给模型一个 OS 级 pid」是两回事**，前者可控，后者是能力泄漏。

## 四、决策三（本章技术核心）：会话表持有 live handle —— 与 S003 登记表**方向相反**

这是本议题最需要看代码的一处。**S004 要持有的东西，恰好是 S003 故意丢掉的东西。**

看 S003 的现状（`packages/core/src/tools/terminal.ts` + `process-registry.ts`）：

- **spawn 时 stdin 是 `'ignore'`**（防线①）：
  ```
  stdio: ['ignore', 'pipe', 'pipe']   // terminal.ts，无 stdin 可写
  ```
- **被 Ctrl-S 跳过后，进程被 detach 掉**：`child.unref()`，然后只往 `process-registry` 里塞一条**纯数据**：
  ```
  BackgroundProcessEntry = { pid, command, logPath, startAt, skippedAt }   // process-registry.ts
  ```
  → **登记表里没有 `ChildProcess` 句柄，也没有可写的 stdin。** 这是**有意的**：S003 D04 的后台进程语义是「让它自己去跑，我们不再管它」，所以 detach + unref + 只留 pid 用于「退出时询问是否 killpg」。

对照 S004 需要的：

| | S003 后台登记表（`process-registry`） | S004 会话表（新增） |
|---|---|---|
| stdin | `'ignore'`（关的） | **`'pipe'`（开的，要写）** |
| 是否持有 `ChildProcess` | ❌ 只存 pid | ✅ **必须持有 live handle** |
| detach / unref | ✅ 已 detach | ❌ **不能 detach**，要一直连着 |
| 生命周期 | 「放它走，退出时问一句」 | 「攥在手里，反复读写，直到结束 / 空闲超时」 |
| 谁触发进入 | 用户 Ctrl-S | 模型声明 interactive |

→ **两张表是两种相反的持有方式，不能合并、不能复用同一个 `BackgroundProcessEntry`。**

⚠️ **这是本章的第一个"血的教训预警"**：直觉会想「S003 不是已经有后台进程登记表了吗，复用一下」。但 S003 那张表的每一个设计（detach、unref、只存 pid）**都是为了"不再持有"**，而 S004 要的是**"持续持有 + 可写"**。**照搬会得到一个既 detach 了又想往它 stdin 写的自相矛盾的东西。**

→ **定案（C5）**：新增独立的会话表，`Map<sessionId, { child: ChildProcess, stdin: Writable, sink: OutputSink, ... }>`，与 `process-registry` 并存、互不复用。`OutputSink`（S003 的输出状态机）可以复用（它本就是「边跑边收」的，见 `terminal.ts` 的 `OutputSink`），但持有方式必须是「连着」而非「detach」。

## 五、决策四：`stdio[0]` 由 `'ignore'` 改 `'pipe'` —— 有节制地打开防线①

要写 stdin，就必须把防线①开一条缝。这是 S004 唯一真正「拆」的东西，所以要框得很紧：

- **只对模型声明 interactive 的调用**把 `stdio[0]` 设为 `'pipe'`；其余一切照旧 `'ignore'`。
- 打开 `'pipe'` 会**重新引入挂死风险**（命令读 stdin，而模型迟迟不写）→ 由 D02 的静默兜底 + D05 的会话空闲超时接住。
- 其余三道防线（②无 pty、③env 注入、④超时）**全部不动**。特别是③要保留：即使开了 stdin，也不希望命令绕过 stdin 去弹凭据框（那是 B 类，D01 已划走）。

⚠️ Codex 的一个细节印证了「开 stdin 也要留后门管控」（[codex.md §G.5](../../../researches/terminal/codex.md)）：它在**非 pty 模式下 stdin 仍然是关的**，唯一接受的输入是 `\u0003`（Ctrl-C）转成 `interrupt()`，其他输入直接 `StdinClosed` 报错。我们比它更进一步开了 pipe（因为我们要真的写内容），但**这提示：开 stdin 不等于放任 stdin**，Ctrl-C（写 `\u0003`）这类要有明确语义（P4，见 D05）。

## 六、谁写 stdin：模型为主，人可选（呈现层）

D01-5 已定「模型写，否决 Aider 的人接管」。但**不排斥人介入**：

- **模型写**（主）：`write_stdin` 工具，走 tool-calling 闭环。
- **人写**（可选，呈现层）：TUI 可以让用户也往当前会话敲字，走 [S003 D03-5 的 `LoopEventHandlers` 事件通道](../../../2026-08-26/e02-s003-terminal/decisions/D03-long-running-skip-and-background.md)（就像 Ctrl-X/Ctrl-S 按键那样）。

⚠️ **这与 Aider 的「人接管」有本质区别**：Aider 是 `child.interact()` **把整个终端控制权交出去**，模型出局；我们是**模型仍是主输入者，人只是多一条并行的输入通道**。控制权没有转移，只是呈现层多开了一个口子。→ 复用 S003 已画对的那条边界（[D03-5 教学点 14](../../../2026-08-26/e02-s003-terminal/decisions/D03-long-running-skip-and-background.md)）：**模型拿结果 = 单出口（工具）；人看/写 = 事件通道**。S004 让「人写」也走事件通道，边界一致。

## 七、本议题的决策清单

| # | 决策 | 类型 |
|---|---|---|
| D03-1 | 新增独立工具 `write_stdin`，**`terminal` 单出口第五次不破**（P1） | 架构 |
| D03-2 | 会话 id **独立发号**，不用 pid（pid 会复用 + 不想让模型拿 pid 去 kill）（P2） | 技术 |
| D03-3 | 新增**会话表持有 live `ChildProcess` + 可写 stdin**；与 S003 只存 pid、已 detach 的后台登记表**并存不复用** | 架构（核心） |
| D03-4 | 交互态把 `stdio[0]` 由 `'ignore'` 改 `'pipe'`，**只对声明 interactive 的调用**；其余三道防线不动 | 技术 |
| D03-5 | 空 `input` = 只轮询不写（借 Codex，P3） | 技术 |
| D03-6 | `OutputSink` 复用（边跑边收），但持有方式为「连着」非「detach」 | 技术 |
| D03-7 | 谁写：模型为主（`write_stdin`）；人可选，走既有事件通道（呈现层），**非 Aider 式接管** | 架构 |

## 八、待代码核对项（进 spec 前必做）

> ⚠️ 遵循 [S003 D03-8](../../../2026-08-26/e02-s003-terminal/decisions/D03-long-running-skip-and-background.md)「写决策前先看代码」。以下三处是 spec 落地的地基，必须逐条确认：

1. `terminal.ts` 的 `stdio` 目前确为 `['ignore','pipe','pipe']`，改 `'pipe'` 后 `child.stdin` 是否可写、`OutputSink` 的 `append` 逻辑是否要动。
2. `process-registry.ts` 的 `BackgroundProcessEntry` 确实**不含** `ChildProcess`（只 pid），确认会话表必须新建。
3. Ctrl-S 跳过路径里的 `child.unref()` + `detachOnce()`（`terminal-runtime` 的 `attachInterrupts`）与「保持会话连着」是否冲突，交互会话不能走这条 detach 分支。

## 九、教学价值

1. **新能力优先新通道，不破坏旧契约** —— `terminal` 的单出口守到第五次。**一个好契约的价值，正体现在"下一个功能来了也不用改它"。**（S003 D01 §4.2 那一刀在这里第五次收到回报。）
2. **两种相反的生命周期不能共用一个数据结构** —— S003 的登记表为「不再持有」而生（detach + 只存 pid），S004 的会话表为「持续持有」而生。**直觉会想复用，但它们的每一个字段都是相反意图的产物。**
3. **给模型「句柄」而不是「pid」** —— 独立发号把「续写会话」和「OS 进程」解耦，顺手堵住「模型拿 pid 去 kill」这条能力泄漏。**句柄的抽象层级，本身就是一道边界。**
4. **「打开一道防线」要框到最小** —— 只对声明 interactive 的调用开 `'pipe'`，只开防线①，其余三道全留。**拆防线不是推翻，是精确地开一条可控的缝，并立刻为这条缝配好兜底。**
5. **「人能介入」不等于「人接管」** —— 让人也能往会话写字（事件通道），和把整个终端交给人（`child.interact()`），是控制权归属完全不同的两件事。**复用 S003 已画对的「工具 vs 事件通道」边界，就不会滑向 Aider 的产品形态。**

## 十、向议题 ④ 的顺延

开了 `stdin` 管道之后，一个尴尬的事实会浮现：

> **很多交互程序 check `isatty()`，没有 pty 时它们根本不会走到「读 stdin」这一步。** 那我们开的这条 stdin 管道，到底能覆盖多少交互命令？

见 D04。
