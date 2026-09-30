# pi-mono：默认 bash 与用户交互终端是两套能力

## 基本信息

| 项目 | 值 |
|---|---|
| 仓库 | [badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| 调研 HEAD | `11894012dd461232eb075bc890538b6866860a10` |
| Commit 日期 | 2026-09-28 17:21:20 +0200（北京时间 23:21:20） |
| 分支 | main；origin/main、origin/HEAD 指向同一 SHA |
| 最近可达 Tag | v0.87.1（本次 depth=100 浅克隆可见范围） |
| 观测时间 | 2026-09-28 23:53:29 +08:00 |
| 旧 snapshot | `65ff8e7f6db447dcddb1a9c8fd05f081c5cda76a` |
| 证据等级 | S：源码确认；未端到端运行，测试仅阅读 |
| 时间异常 | 未发现晚于用户 2026-09-28 的 commit；不据此保证远端历史完整 |

## 调研目标

服务 E02-S004：确认模型能否对运行中命令继续输入，是否存在 PTY、yield、session、EOF 和信号控制。
重点区分默认 bash、用户手输命令和示例扩展，避免把“能在终端开 vim”当成“模型能操作 vim”。

## 调研结论

1. 默认 bash 已注册，但模型参数只有 command、timeout；没有 stdin、session_id、yield 或 resize。
2. 默认执行是一次性 shell + stdout/stderr pipe。普通路径 stdin ignore；旧 WSL 路径虽用 pipe，却立即 end(command)，不是续写通道。
3. interactive-shell 是显式加载的示例扩展，只监听 user_bash，不注册模型工具。它停止 TUI，spawnSync + stdio inherit 借用宿主终端，供人操作。
4. 扩展不捕获终端正文，只回传成功/失败摘要；默认会话仍记录命令和摘要，!! 只影响模型上下文，不等于不留本地记录。
5. 基础 bash 有超时/取消杀进程组、尾部截断和输出落盘，但没有可恢复进程 session。onUpdate 是输出展示，不是让模型提前拿到句柄。
6. 与旧报告对比：交互扩展早已存在且文件完全相同；“全仓无交互能力”的说法是范围错误。信号退出码、动态 cwd 则有真实实现变化。

## 能力与默认状态

| 能力 | 源码存在 | 模型注册 | 配置/默认 | 本轮运行 |
|---|---|---|---|---|
| 一次性 bash | 是 | 是 | read/bash/edit/write 默认激活，可覆写 | 未运行 |
| 模型向既有进程写入 | 所查默认链路没有 | 没有参数或工具 | 不可由默认设置开启 | 未运行 |
| 普通 bash stdin | ignore | 不可传输入 | 默认 | 未运行 |
| legacy WSL stdin | pipe + end(command) | 仍只有 command | 特定 shell 路径触发 | 未运行 |
| 人工交互终端 | 示例扩展 | 否，只拦截用户 ! | 必须加载扩展，非默认 | 未运行 |
| PTY 创建 | 上述两链没有 | 否 | 扩展继承已有终端 | 未运行 |
| 中间输出 | bash onUpdate | 非独立工具结果 | 100ms 节流 | 未运行 |
| yield / resume | 所查链路没有 | 否 | 无可配置 session 协议 | 未运行 |
| 终止运行中默认 bash | AbortSignal / timeout | timeout 可传 | 无默认 timeout | 未运行 |
| 交互扩展 RPC/headless | 显式拒绝 | 不适用 | ctx.mode 非 tui 返回错误 | 未运行 |

## 详细分析

### 1. 工具注册与模型契约

[默认工具选择](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/sdk.ts#L258-L265)依次处理 options.tools、noTools、defaultTools、excludeTools。
“仓库里导出了 bash”不是默认性的证据；这里的默认数组才是。
[工具工厂](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/index.ts#L118-L139)将 bash 映射到 createBashToolDefinition。
SDK 创建 Agent，AgentSession 构建工具注册表，再筛选 active tools。
[AgentSession 默认集合](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/agent-session.ts#L3281-L3288)也明确四个默认工具。

[模型 schema](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/bash.ts#L38-L46)只有：

```ts
{ command: string, timeout?: number }
```

没有 stdin 字段，不接受会话句柄，也没有“关闭输入”“仅轮询”“后台运行”参数。
timeout 单位秒；undefined 不设置 timer。
[超时校验](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/bash.ts#L25-L35)拒绝非有限值、非正数和超过 Node timer 范围的值。
模型当然能把管道、here-doc、重定向写入 command，但这属于一次性脚本文本，不是观察提示后再续写。

### 2. 关键调用链

```text
SDK 默认/显式工具选择
 → AgentSession 工具注册表
 → Agent loop 校验工具参数
 → createBashToolDefinition / createShellToolDefinition.execute
 → ops.exec（默认 createLocalBashOperations）
 → createLocalShellOperations → spawn(shell, args)
 → stdout/stderr data → OutputAccumulator → onUpdate
 → waitForChildProcess → 最终 content 或错误结果
```

[Agent loop 实际调用](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/agent/src/agent-loop.ts#L773-L813)把 signal 和 partial callback 传给工具。
callback 发出 tool_execution_update；最终 await execute 完成后才产生完成结果。
因此不能把流式 UI 事件理解为模型已重新获得执行权。
多工具调度有 parallel/sequential 分支，某工具声明 sequential 时整个批次走顺序路径。
[调度分支](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/agent/src/agent-loop.ts#L505-L520)没有为 bash 提供独立 stdin 仲裁器。

### 3. stdin、pipe 与 EOF

[实际 spawn](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/bash.ts#L95-L107)是本报告最关键证据：

```ts
stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"]
// legacy command transport only
child.stdin?.end(command)
```

普通 Unix bash 用 -c，将 command 作为 argv；stdin 不继承人的终端，也不开放给模型。
旧 WSL bash.exe 用 -s，把 command 写进 stdin 后关闭。
[WSL 路径识别](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/utils/shell.ts#L15-L22)只负责命令传输兼容。
“发现 pipe”不足以证明可交互：写端没有被保存、没有会话索引、也没有后续 write API。
关闭输入是 transport 的立即动作，不是暴露给模型的 EOF 操作。
没有把 Ctrl-D、Ctrl-C 编码为工具参数的实现。

### 4. 输出、缓冲与退出边界

两个输出流调用同一个 onData，失去 stdout/stderr 的来源区分。
[OutputAccumulator](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/output-accumulator.ts#L57-L89)使用 TextDecoder stream，避免 chunk 中间切断 UTF-8。
滚动尾部上限为 maxBytes 的两倍；默认模型输出限制是 2000 行或 50KiB。
超过阈值转写临时文件，最终文本附 full output 路径。
[尾部裁剪和落盘](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/output-accumulator.ts#L179-L221)保留 UTF-8 边界。
注意：write 返回值没有在 append 中等待 drain；尾部有界不代表磁盘写队列、事件队列在极端慢盘下有严格总内存上界。
本轮不把“不会 OOM”当成已验证结论，也未找到该链路的日志大小配额或自动删除策略。

[输出节流与快照](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/bash.ts#L259-L318)合并 UI 更新。
这是累计尾部快照，不是带 cursor 的持久增量读取协议。
输出结束时 finish、flush pending update、等待临时文件关闭；不是只在命令完成后才截断。

[waitForChildProcess](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/utils/child-process.ts#L38-L96)区分 exit 和 stdio end/close。
shell 退出后，若后代仍占用输出管道，会等待 100ms 静默窗口，每来一段输出重置 timer。
静默到期会销毁读流并完成，不无限等待继承的句柄关闭。
代价是静默窗口之后才输出的后代内容不受保证；持续写入又可能延长等待。
这不是后台作业保存机制，不能把返回时刻当成“所有后代均退出”。

### 5. 默认 bash 的取消、信号与生命周期

[取消与 timeout](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/bash.ts#L107-L147)调用 killProcessTree。
Unix detached=true，使用负 PID 发 SIGKILL；失败后退到单进程 SIGKILL。
[跨平台清理](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/utils/shell.ts#L195-L247)在 Windows 用可信 System32 taskkill.exe /F /T。
这是操作系统信号/进程树终止，不是向 stdin 写入 U+0003。
没有先 SIGTERM 再宽限期的升级策略。
信号退出被转换成 128 + signal number；custom operations 返回 null 也明确报错。
[最终错误回执](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/tools/bash.ts#L343-L374)保留超时/取消前输出。

进程 PID 记录在模块级 Set，finally 移除；它是退出清理表，不是用户可操作的 session registry。
没有 owner/session-id 校验、闲置淘汰、session 最大数或进程恢复。
进程自然完成后不能跨 turn 续写；正常工具调用 await 完成，不主动在 turn 结束时留下可复用句柄。
[print 模式 SIGTERM/SIGHUP](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/modes/print-mode.ts#L42-L64)先清理被追踪子进程再 dispose runtime。
TUI 的 emergencyTerminalExit、uncaughtCrash 也调用同一清理函数。
只保证这些已接线路径；宿主被 SIGKILL、已脱离追踪的后代、强制断电等不能由源码承诺清理。

### 6. interactive-shell 示例扩展：人接管，而不是模型续写

[扩展入口与说明](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/examples/extensions/interactive-shell.ts#L1-L24)明确写：
只拦截用户 ! 命令，不处理 agent bash。
示例用 -e 加载；不是默认工具开关，也不调用 registerTool。
[资源加载合并](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/resource-loader.ts#L503-L513)显示 CLI/已启用扩展路径进入加载集合；示例文件本身不能证明已加载。

自动识别编辑器、pager、数据库客户端等命令；环境变量可增删名单。
[检测规则](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/examples/extensions/interactive-shell.ts#L100-L143)只是字符串前缀和最后一根管道后的匹配，不是 shell AST。
!i 强制交互；sudo vim、复杂条件链等不能靠这套字符串规则保证识别。
名单是体验启发式，不是安全 allowlist。

```text
用户 ! / !i
 → InteractiveMode.handleBashCommand
 → ExtensionRunner.emitUserBash
 → interactive-shell handler
 → ctx.mode == tui ?
 → ctx.ui.custom → tui.stop
 → spawnSync(SHELL || /bin/sh, ["-c", command], stdio: inherit)
 → tui.start → done(status)
 → recordBashResult（命令 + 完成摘要）
```

[真实终端接管代码](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/examples/extensions/interactive-shell.ts#L148-L194)没有创建 PTY：
它继承当前 stdin/stdout/stderr；交互依赖宿主已经有可用终端。
非 tui 模式返回 exitCode=1，不自动降级执行。
spawnSync 阻塞 Node 事件循环，没有模型侧并发 read/write、yield 或 session 句柄。
它没有传 event.cwd，而是继承宿主进程 cwd；不要把主工具的 ctx.cwd 行为套在扩展上。

[TUI terminal.stop](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/tui/src/terminal.ts#L429-L474)移除输入监听、暂停 stdin、恢复之前 raw 状态。
恢复完成后，控制字符由终端和子程序处理；扩展没有提供独立 signal API。
扩展没有 timeout、AbortSignal、进程组追踪、try/finally 恢复块。
未实际验证 spawnSync 异常、Ctrl-C、窗口 resize、终端断开后 TUI 是否总能恢复。
Windows 没有专门分支，SHELL 或 /bin/sh 路径也不提供默认 bash 那套 Windows shell 查找；不能宣称跨平台等价。

### 7. 输出进入模型与秘密边界

扩展 stdio inherit 不捕获交互正文，只返回 completed / exited with code 摘要。
[用户命令分支记录结果](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L6742-L6787)把该摘要交给 recordBashResult。
[持久记录](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/agent-session.ts#L3496-L3516)包含 command、output、exitCode、excludeFromContext。
[模型消息转换](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/src/core/messages.ts#L148-L161)只在 excludeFromContext 时跳过。
因此 ! 交互的正文通常不会自动送模型，但命令原文和完成摘要会；!! 可排除模型上下文，仍不等于不记录。
密码若写在命令参数里仍可留存；终端 scrollback、程序自己的日志、环境变量泄露不由此扩展防护。
默认 bash 的完整输出落盘和模型输出也没有秘密识别/脱敏层。

### 8. 同仓 harness 实现不能与 CLI 混成一条调用链

仓库还存在 packages/agent/src/harness/tools/bash.ts。
[其 schema 与 env.exec](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/agent/src/harness/tools/bash.ts#L53-L85)仍没有模型 stdin/session 参数。
该实现使用 capture limits/spill，并带输出 checkpoint；不是 interactive-shell 的后端。
本报告主链通过 SDK → AgentSession → coding-agent tools 明确定位到 CLI 实现。
复用 harness 的自定义宿主可能更换 ExecutionEnv，不能从 CLI 默认行为推断所有嵌入宿主。

## 与旧 snapshot 的对比

| 旧说法/观察 | 本轮核实 | 性质 |
|---|---|---|
| 无任何交互能力、未找到 PTY 即无用户交互 | interactive-shell 在旧 SHA 已存在；两个 SHA 此文件 diff 为空 | 旧范围遗漏，不是新增交互功能 |
| stdin 固定 ignore | 旧 SHA 已有 legacy WSL pipe + end(command) | 旧概括错误；不影响无续写结论 |
| 信号导致 null 可走成功结果 | 新代码归一化信号并拒绝 null；旧 SHA 确有 !=0 && !=null | 真实代码变化 |
| cwd 仅固定创建参数 | 新 execute 优先 ctx.cwd，测试覆盖；旧代码用闭包 cwd | 真实代码变化 |
| 内存有界所以不会 OOM | rolling tail 有界，但 stream.write 背压未处理 | 旧推断过强 |

旧 SHA 已额外 fetch 并通过 git show、定向 git diff 实际比较。
未定位引入每次变化的单独 commit，不伪造发布日期或变更 PR。
历史报告保持不改；修正在本报告记录。

## 测试证据与未验证列表

只阅读测试，没有安装依赖、没有执行外部仓库代码。

- [信号/null 测试](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/test/tools.test.ts#L514-L543)：Unix SIGKILL/TERM 保留输出，null 拒绝。
- [stdin transport 测试](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/test/tools.test.ts#L629-L650)：mock shell 配置后读取到 EOF；不是可续写 session 测试。
- [chatty output 测试](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/test/tools.test.ts#L704-L721)：5000 段合并为少量更新；不测慢盘背压。
- [动态 cwd 测试](https://github.com/badlogic/pi-mono/blob/11894012dd461232eb075bc890538b6866860a10/packages/coding-agent/test/tools.test.ts#L1046-L1056)：ctx.cwd 覆盖工具创建目录。
- 在 coding-agent/test 搜索 interactive-shell 未发现该示例的专门测试。
- U：真实 vim/ssh/password 提示、人工 Ctrl-D/Ctrl-C、resize、宿主终止、Windows/Git Bash/WSL。
- U：进程组逃逸、慢盘无限输出、stdout 继承后代的边界行为、扩展异常后的终端恢复。
- U：自定义 operations、其他 extension、嵌入宿主是否另行实现交互 session。

## 对 S004 的选择启发

1. 拆开“模型可续写”和“用户终端接管”两条需求；后者不是前者的简化实现。
2. 若采用 pipe 会话，必须明确保存写端、返回 session id、支持 poll/write/close，而不是只把 ignore 改成 pipe。
3. onUpdate 不能代替 yield：模型需先收到未完成状态才有机会发下一次输入。
4. 输出 EOF、进程 exit、session 可回收应是不同状态；pi 的静默窗口能说明为何不能只等 close。
5. 信号不能伪装成字符；close stdin、写 Ctrl-D、发送 SIGINT 应分别设计与验证。
6. 继承终端的轻量方案可作为后续人工接管模式，但必须处理 cwd、恢复 finally、headless 错误和秘密日志政策。
7. 基于 pid 的宿主退出清理值得借鉴，session owner/配额/跨 turn 生命周期仍需 S004 自行建立。
8. 不照搬无默认 timeout；交互等待可单独定义 idle/总时长预算，并区分用户操作与模型运行。
9. 以“小而清楚的状态机”优先于把所有竞品字段塞进 terminal；以上均是候选建议，不是 S004 已定设计。

## 复现取证与参考资料

```sh
git clone --depth 100 https://github.com/badlogic/pi-mono.git <checkout>
git -C <checkout> show 11894012dd461232eb075bc890538b6866860a10:packages/coding-agent/examples/extensions/interactive-shell.ts
git -C <checkout> fetch --depth 1 origin 65ff8e7f6db447dcddb1a9c8fd05f081c5cda76a
git -C <checkout> diff 65ff8e7f6db447dcddb1a9c8fd05f081c5cda76a 11894012dd461232eb075bc890538b6866860a10 -- packages/coding-agent/examples/extensions/interactive-shell.ts
```

- [调研方法](README.md)
- [S003 旧报告](../terminal/pi-mono.md)
- 关键源码引用已按各节附固定 SHA permalink；不将当前 main 链接作为历史实现证据。

