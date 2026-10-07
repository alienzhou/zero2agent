# E03-S003：交叉审查与复验记录

2026-10-07。本审阅者编写了本课 Core 实现，随后独立审查另一位协作者编写的 TUI、课程文档和验收脚本。Core 的独立交叉审查另见 [core-review.md](./core-review.md)。这两份都是 AI 审查记录，不是人工签收。

## 范围与结论

已对照 S003 的 README、五篇 details、follow-along、deep-dive、D01/D02、研究资料、18 页课程生成源及生产 Core/TUI、单元测试、真实 SDK/PTY 测试。另审查 runtime-demo、acceptance-report、tui-capture、terminal-restore 四个脚本，核对证据实际能证明的范围。

以下已复现的实现问题均已修复，并按表中方式复验。课程关于事件与控制分离、完整 Turn 取消、工具结果配对、输入所有权、保留忙碌草稿、审批超时和私密终端的描述与实现一致。文档没有承诺取消能够回滚文件，也没有把有限 TUI 历史当作持久化日志。

全量离线回归已通过；真实模型首轮验收存在一次未实际调用工具的失败，下文单独记录。整课最终门禁、Tag、PR 与视觉验收由各自证据决定，本记录不替代这些交付检查。

## 已核实的问题及修复

| 问题与复现 | 修复 | 复验与状态 |
| --- | --- | --- |
| Reducer 收到 A 开始、B 开始、迟到的 A 开始，会把当前界面切回 A；结束后的同轮事件也可继续修改界面。 | `44b0f55` 记录退役 Turn，拒绝已结束 Turn 的后续事件。 | 独立执行 reducer 断言，确认旧开始和结束后的文字均不改变状态；对应回归已纳入测试。已修。 |
| UI 的选中和展开状态仅用 toolCallId；不同 Turn 复用 ID 会关联到多个卡片。 | `b4eec82` 改用 turnId + toolCallId，并补齐渲染缓存签名。 | 核对 reducer 与 UI 使用同一复合身份，回归覆盖跨轮复用 ID。已修。 |
| 真实 PTY 中，运行时开始 bracketed paste，紧接人工终端交接，paste 结束符被交接确认消费；返回后普通 Enter 仍被当作粘贴内容，草稿无法发送。 | `44b0f55` 在 suspend 时清理 paste 模式，同时保留草稿及光标。 | 独立复现过失败；修复后重跑真实跨阶段 PTY 回归，返回后能够编辑并发送。已修。 |
| tool-state.reason 可以保留百万字符，既不截短也不计入界面总预算。 | `e783533` 对 reason 应用条目限制并计入预算；名称和 ID 计入预算、展示时限长。 | 独立用百万字符 reason 验证限制生效；同时核对流式截短提示不会反复累积。已修。 |
| 原“晚回答”测试没有真正发送晚到回答；D02 要求的同会话两次人工 PTY 及后续 API 隐私审计缺少直接证据。 | `0dcf911` 增加真实 500ms 审批超时、晚到 y、下一次独立审批；增加连续两次人工 PTY 与全部请求正文检查。 | 独立读取断言并重跑超时、两次 PTY、跨 paste 交接三项测试，3 项通过。晚 y 留在草稿，两次文件写入均未获误批准；两次私密输入和输出不在任何 API 请求中。已补齐。 |
| demo 父进程收到 SIGTERM 时退出，临时目录仍存在，与“退出自动删除”不符。 | `47dcefb` 转发 SIGINT/SIGTERM/SIGHUP 给子进程，等待退出后执行清理。 | 独立真实 PTY 复验三种信号：退出码分别为 0/143/129，三次临时目录均已删除。已修。plain 模式键盘 Ctrl-C 原先就能清理，未将它误列为缺陷。 |
| 验收报告只记录开始时源码，没有结束核对；中断前可能留下上次通过状态；异步等待缺少期限。 | `dd01b60` 启动即写 passed=false，结束比较源码哈希，为命令及 demo 等待加入期限。 | 审查写入顺序与通过条件；实际报告保留失败状态，源码稳定性单列。超时强杀分支本轮未作故障注入，不声称已实测。已修报告真实性问题。 |
| capture 曾把观察到恢复转义码直接记为 restored=true；成功或异常退出时也未等待 demo 清理。 | `8872f53` 等待 demo 退出、检查目录消失，异常路径先 SIGTERM 再有界等待；记录 head/时间，字段改为 restorationEscapesObserved。 | 核对脚本与实际 capture.json：demoWorkspaceRemoved=true。另由下述真实 stty 验证补足模式恢复证据。已修。 |
| 原始 ANSI 和屏幕尾部填充空格触发 whitespace gate；简单清洗会破坏原始证据。 | `02f7332` 以 gzip 无损保存原始 PTY 字节，派生纯文本帧去掉行末空格并说明用途；研究帧同步处理。 | 独立解压 raw-pty.ansi.gz 计算 SHA-256，与 capture.json 的 rawSha256 完全一致。随后 whitespace gate 通过。已修。 |
| P15“完整参数和结果”夸大有限工具详情；P16“两层确认”易被理解为每次必有两次弹窗。 | `889ed9b` 将 P15 改为展开保留的内容并说明截短；P16 明确模型发起先权限判断再人工交接，权限可自动允许，直接 /terminal 只有交接确认。 | 对照 runtime-state 的条目限制、权限规则和人工终端入口，核对编辑源及生成页。已修。 |

## 已执行或读取的验证

- 本审阅者独立执行 `vitest run src/runtime-tui.test.ts -t 'expires approval|two human PTYs|interrupted paste'`：3 项通过。另直接执行 reducer 的旧 Turn、结束后事件和超长 reason 断言，均通过。
- 独立执行 `node scripts/e03-s003-terminal-restore.mjs`：正常 exit、SIGTERM、SIGHUP 三条路径均通过。脚本在真实外层 PTY 中运行生产 TUI，逐次比较 `/bin/stty -g`，退出前后完全相同；随后由父进程 readline 成功接收 `canonical-input`。生产 TUI 退出码为 0/143/129。
- 审查当时已读取离线日志 [offline.txt](../../../researches/runtime-tui/acceptance/failed-live-attempt/offline.txt)：shared 1 项、Core 28 文件/394 项、E2E 9 文件/105 项通过；53 项 live 测试按默认规则跳过。此项为读取主代理的完整运行证据，不冒充本审阅者重新运行全量。
- [summary.json](../../../researches/runtime-tui/acceptance/summary.json) 记录构建、离线回归、E2E 类型、lint、变更 TS 格式、runtime-demo、site build/check、whitespace 的结果。`sourceStable` 只比较 Core、TUI、E2E 三个源码目录的前后哈希，不代表全部课程素材或脚本已冻结。
- 已读取实际 TUI [capture.json](../../../researches/runtime-tui/acceptance/screens/capture.json)，查看审批和窄屏 PNG，并核对录屏脚本通过生产 CLI、真实 PTY、确定性本地 SSE 获取输出，再交给 xterm.js 渲染。截图并非真实模型生成证据；原始字节与派生屏幕各自保留。

真实模型首轮三个场景中，读文件/新会话、拒绝后批准通过，取消前台终端场景失败，保留在 [failed-live-attempt](../../../researches/runtime-tui/acceptance/failed-live-attempt/)。已解压请求与屏幕证据：模型返回了“已执行、ready.txt 已写入”的文字，实际文件不存在，只有一次请求，没有形成真实工具结果链。测试在等待真实文件时失败，正确拒绝了把模型文字当执行证明。该次失败不能证明宿主取消有缺陷，也不能算作真实模型取消验收通过；最终重验结果以验收目录记录为准。

## 文档及交付核对

已核对研究资料区分四竞品文档、三个可审阅的固定源码版本，以及两款本地二进制的输入交互观察。Codex/OpenCode 的实机观察不包含真实模型工具审批，固定源码也未冒充所运行二进制的精确构建；Claude Code 未被声称完成源码审查。

读者正文、跟练、延伸阅读、五篇技术文档、复盘、协作记录和课程来源计划均已存在并交叉链接。中英文 README、Epic、Roadmap、CHANGELOG 与前后课导航已更新。18 页课程的语义核对包含上述两处修正；完整 PC/H5 逐页视觉检查由课程审阅资料记录，不能仅用文件存在或 site:check 代替。

## 剩余边界

1. 当前实测环境为 macOS/POSIX。没有据此推断 Linux、Windows 或全部终端模拟器均已通过。
2. 自定义工具忽略 signal 且不结束时，Session 继续 busy；取消不撤销已经发生的文件副作用。前台进程组取消不等于对主动逃逸后代的沙箱保证。
3. TUI 保留有限条目、字符和最近退役 Turn；工具详情只能展开保留的预览，审批参数另有完整滚动路径。Reducer 不是任意久远事件的持久化回放系统。
4. 终端恢复的实际证明覆盖上述 exit/SIGTERM/SIGHUP 路径；capture 的转义码字段本身不证明 stty 状态。SIGKILL 或宿主崩溃不在这些正常清理证明之内。
5. 本记录不声称真实模型永远服从工具调用要求，不把 AI 审查当成人工签收，不声称新 PR 已合并或站点已部署。固定跟练 Tag、PR 可审阅状态及最终 R01–R13 结果由主代理在最终交付时核对。
