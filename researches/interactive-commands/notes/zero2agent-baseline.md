# S003 代码基线与 S004 初稿需要修正的前提

[调研总览](../README.md) | [机制实验](../experiments/README.md) | [原讨论 PR #12](https://github.com/alienzhou/zero2agent/pull/12)

## 基线与结论

本地实现基线为 `1b84fa2cbb151af2d3c9b5d4c683e532c976280c`，已完成 E02-S003。S004 讨论来自仍未合并的 PR #12，固定 head 为 `7d64f3fcb9573a56c07e7c8530254ed9fbc800f0`。本轮读取了该版本的 outline 和 D01–D05，不把 PR 初稿当作已实现功能。

需要修正的是论据，不是预先宣布 pipe 方案不可行：

1. S003 没有“10 秒静默检测”或自动 yield，必须新增有限等待后返回模型的路径。
2. `detached`、`unref`、解除快捷键监听都不等于关闭 stdin。
3. `OutputSink` 能持续收集，不等于已经有会话增量消费、背压和最终排空协议。
4. 无 PTY 不是凭据安全边界；模型知道 `y` 也不等于有权确认。
5. EOF、取消、drain timeout、会话 lease 是不同操作，不能统一叫“温和兜底”。

## 当前调用链

```text
ReAct loop 等待 tool.execute()
  → terminal.execute(command, workdir)
  → workdir 校验、shell env、消费完成通知
  → runCommand：bash -c + watcher + stdin ignore
  → 收 stdout/stderr 到 OutputSink
  → 完成 / 人取消 / 人跳过 / exit 后 drain 超时
  → 生成字符串回执
  → loop 才能继续下一次模型请求
```

证据：[loop.ts](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/loop.ts#L65)、[工具入口](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L517-L566)。

仅开放 stdin 不会让模型获得输入机会：如果创建会话的工具还在等进程退出，loop 尚未再次请求模型，模型无从调用续写工具。这是调度死锁，不是需要更聪明的“等待输入检测”。

## B01：10 秒是固定计时，不是静默检测

[terminal.ts#L253-L279](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L253-L279) 从启动时创建 `setTimeout`，期间即使持续输出也不会重置。到点只设 `skipAvailable`、必要时落盘，并在 TTY 下提示按键。

真正提前返回的是 `signalSkip` 或 `signalCancel`；没有“10 秒到了自动发 session id”。[返回触发](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L283-L348)。

PR D02 的“复用已有静默信号”应改为：可以复用部分输出采集与宿主提示，但必须定义新的 yield 时钟。至少分清：

| 时钟 | 计算什么 | 到点的可能行为 |
|---|---|---|
| yield 等待窗口 | 本次工具调用占用时间 | 返回部分输出，不杀进程 |
| 输出静默窗口 | 距上次输出多久 | 提示或用于策略，不等于确诊等输入 |
| 会话 idle/lease | 距指定活动或授权起点多久 | 按已声明契约拒写、过期或回收 |
| 总运行期限 | 从 spawn 到现在 | 若有授权可停止进程 |
| drain 窗口 | exit 后等输出 fd 关闭多久 | 返回不完整标志，防读侧永久等待 |

## B02：三个“脱离”的对象不同

| 代码 | 实际作用 | 不意味着 |
|---|---|---|
| `spawn(..., {detached: true})` | POSIX 下新进程 session/进程组 | stdin/stdout 已断开 |
| `child.unref()` | 不再由 ChildProcess handle 维持父事件循环存活 | ChildProcess 对象失效或不可写 |
| `detachOnce()` | 调用 `detachRaw`，释放宿主终端快捷键绑定 | 关闭子进程 fd 或从进程组分离 |

证据：[spawn](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L241-L246)、[detachOnce](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L301-L307)、[宿主监听清理](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/tui/src/setup-terminal-runtime.ts#L32-L59)、[跳过分支](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L360-L375)。E09 实测了 detached/unref 下仍能写 stdin。

原先登记表确实只有元数据，没有 `ChildProcess`；但“登记表不存句柄”也不代表当前闭包没有引用。跳过后仍保留 data/close listeners、sink 和完成通知逻辑。

因此可以选择另建会话表，但理由应是“输入能力、消费者状态、所有权和清理职责新增”，不能声称“后台与交互的每个字段含义相反，所以不能复用”。

## B03：登记表、会话 ID 和权限

[process-registry.ts](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/process-registry.ts#L5-L42) 维护 pid、command、logPath、startAt、skippedAt 和完成通知队列，没有 stdin、输出读取 cursor、owner 或 lease。

独立 session id 有价值：把应用句柄与 OS pid 解耦、避免复用与陈旧引用。但它本身不是能力沙箱。当前 shell 可以执行任意获准命令，回执本来就显示 pid 并提示 `kill -0`：[terminal.ts#L437-L447](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L437-L447)。

“不给 pid 就堵住模型 kill”不能成立。真正需要的是 session id 的 owner 检查、陈旧 id 拒绝策略、模型可用操作范围与宿主授权。

## B04：OutputSink 可借鉴，但不能原样充当会话输出协议

[OutputSink](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L105-L187) 的职责是收集、按阈值落盘和最终返回：

- `flushForTime` 落盘但保留内存。
- `enterSpillMode` 清空内存并只保留文件写入。
- `getBodyText` 返回当前内存全部内容，不是自上次 poll 以来的 delta。
- `closeStream` 关闭日志写端，不等于结束进程输入。

如果每次续写直接调用 `getBodyText`，会重复把旧输出送给模型；进入 spill 后又可能完全拿不到新的提示。需要明确“完整日志”和“本次读取窗口”分离，而不是简单地复用一个类名。

当前 `append` 未利用日志 write 的返回值进行背压控制，也没有会话总磁盘限额。本轮只记录此边界，不把它扩展为 S003 修复任务。E11 只验证分块 UTF-8 和 cursor 的小型例子，并未完成压力测试。

## B05：drain 防的不是“进程不退”

[exit 监听](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal.ts#L325-L339) 收到直接子进程 `exit` 才启动 2 秒 drain 计时器。其目标是后代还握着 stdout/stderr 时，避免等待 `close` 永远不结束。

PR D05 把它写成“进程不退 → 强行 resolve”，会让读者误以为已有通用等待窗口。交互会话恰恰通常尚未 exit，不能靠这条计时器 yield。E10 提供了二者分离的实际观测。

## B06：非交互 env 是兼容性/防挂提示，不是全局安全策略

[shell-env.ts#L58-L74](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/shell-env.ts#L58-L74) 设置 `TERM=dumb`、pager、`GIT_EDITOR=true`、Git/SSH askpass 和 DISPLAY。这些只影响遵守相应约定的程序。

- 程序仍可以直接读 stdin，E06 已用模拟凭据证明。
- `TERM=dumb` 与 `isatty()` 不是一回事；设置 TERM 不会把 pipe 变成 TTY。
- 控制终端由 session/宿主组织方式决定；E07 没有证明任何 pipe 程序都打不开 `/dev/tty`。
- `GIT_EDITOR=true`、`GIT_SEQUENCE_EDITOR=:` 不是通用的交互等价替代：它们可能跳过用户本想完成的编辑步骤。
- “模型知道应该输入 y”与“用户已授权这次确认”必须分开判断。

S004 可以把审批系统留给 Epic 3，但应明确“未提供凭据隔离与输入授权保证”，而不是把尚未实现的限制写成已经物理生效。

## B07：人类输入不是只多一个 UI 入口

[TerminalRuntimeHooks](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/terminal-runtime.ts#L3-L13) 只有取消/跳过、状态输出和退出询问，没有普通字节输入、接管租约或输入串行化。

如果模型和人同时写同一 stream，即使两个 UI 各自工作正常，也可能把答案拼接进同一条命令。至少需要指定单写者、暂停模型或争用拒绝机制；还要定义人类输入是否回显、是否进入模型 transcript。它不是一个无需协议设计的“可选呈现层”任务。

## B08：返回类型不变，不等于契约不变

[`Tool.execute` 的签名](https://github.com/alienzhou/zero2agent/blob/1b84fa2cbb151af2d3c9b5d4c683e532c976280c/packages/core/src/tools/types.ts#L15-L23) 可以继续是 `Promise<string>`，而回执里包含 running/session id/增量输出/终态等状态。

这仍然是外部契约扩展。PR D03 同时写“terminal 契约一个字不改”与 `interactive?: true`、中间态回执，二者不一致。增加创建标记与独立续写工具也不互斥，应分别讨论创建入口和已创建会话的操作面。

## 对 D01–D05 的处理建议

| 文档 | 保留的议题 | 调研已足以要求修正 | 仍待用户讨论 |
|---|---|---|---|
| D01 | 谁能提供答案、任务是否需要跨轮依赖 | 能答不代表获准；pipe 不等于凭据隔离 | 本章真实用例和人参与范围 |
| D02 | 通用 stdin 阻塞检测不可靠 | S003 无静默检测/自动 yield；“不可观测”不宜绝对化 | 创建时显式声明还是默认会话化 |
| D03 | 会话与输入操作需要明确契约 | detach/unref 论据、增量读取、人输入争用、ID 权限论据 | 单入口/双入口、工具参数与状态形式 |
| D04 | PTY 的依赖成本与覆盖范围 | isatty 不把全部命令简单切两半；PTY 不是只为人接管 | pipe-only、可选 PTY 或默认 PTY |
| D05 | 生命周期必须闭环 | drain 对象、EOF 副作用、引用与连通性混淆 | 会话 lease、上限、拒绝还是淘汰、结束策略 |

本页是评审输入，不回写原 D 文档，不标记任何候选方案“定案”。
