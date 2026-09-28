# Aider：人接管 PTY，不是模型持久交互会话

## 基本信息

| 项目 | 值 |
|---|---|
| 仓库 | [Aider-AI/aider](https://github.com/Aider-AI/aider) |
| 实际 HEAD | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` |
| Commit 日期 | 2026-05-22 07:02:20 -0700 |
| 分支 | main；origin/main、origin/HEAD 指向相同 SHA |
| 最近可达 Tag | v0.86.3.dev（depth=100 浅克隆可见范围） |
| 观测时间 | 2026-09-28 23:54:10 +08:00 |
| 旧 snapshot | 与本次 HEAD 完全相同 |
| 证据等级 | S：源码确认，未端到端运行，测试仅阅读 |
| 时间异常 | 未发现晚于用户 2026-09-28 的 commit |

## 调研目标

为 E02-S004 澄清：Aider 的交互能力属于模型工具、人工终端，还是输入输出管道。
沿模型命令建议 → 确认 → runtime 分支 → 输入接管 → 输出入模追踪，重点校正 explicit_yes_required 和 headless 行为。
范围是当前公开仓库命令链路；不运行外部代码，不把依赖接口名称当作完整运行证明。

## 调研结论

1. 模型没有 terminal 工具 schema：命令通过回复中的 shell 代码块提取，再经用户确认运行。默认允许“建议命令”，不是默认允许自动执行。
2. run_cmd 在 stdin 为 TTY、pexpect.spawn 可用、非 Windows 时选择 pexpect；否则走 subprocess。这是环境探测，不是读取命令后判断它是否交互。
3. pexpect 分支调用 child.interact，将键盘控制交给人并捕获输出；模型没有 send/write/poll/resume session 工具。
4. subprocess 分支只把 stdout 设为 PIPE，stdin 省略而继承父输入。headless 回退不保证无交互等待，也可能消耗调用者的输入流。
5. explicit_yes_required 确实使全局 --yes 被拒、禁用 All 批量同意，但默认 Yes、空回车和 EOF 仍能返回同意；它不是“必须显式输入 yes”。
6. 与旧 snapshot 同 SHA，本次纠正均属解读修正，不是 Aider 新版本变化。交互输出可经确认进入模型，不能把人工接管理解为秘密天然隔离。

## 能力与默认状态

| 能力 | 源码存在 | 模型可用方式 | 默认/条件 | 本轮实测 |
|---|---|---|---|---|
| 模型建议 shell 命令 | 是 | 文本代码块，无工具 schema | suggest-shell-commands=True | 未运行 |
| 模型运行中续写 stdin | 所查链路没有 | 无 write/session 工具 | 不可直接配置开启 | 未运行 |
| 人工 PTY 交互 | 是 | 模型建议后，人接管 | stdin TTY + pexpect.spawn + 非 Windows | 未运行 |
| subprocess 输出 pipe | 是 | 命令结束后可分享结果 | 不满足 PTY 条件即回退 | 未运行 |
| subprocess stdin pipe | 否，未设置 PIPE | 无模型输入接口 | 继承父 stdin | 未运行 |
| 持久 session/yield | 所查链路没有 | 无句柄协议 | 同步阻塞调用 | 未运行 |
| 增量展示 | 是 | 向人的终端打印 | 两分支均有 | 未运行 |
| 模型增量读取 | 没有本链协议 | 完成后分享输出 | 非 streaming tool result | 未运行 |
| 输入关闭/信号 API | 没有 Aider 包装接口 | 人/终端/依赖处理 | 不提供模型操作 | 未运行 |
| 命令确认 | 是 | shell 建议执行前 | 全局 --yes 不能越过该关卡 | 未运行 |
| 输出截断/运行超时 | 所查执行链没有 | 无参数 | 全量内存、无 Aider deadline | 未运行 |

## 详细分析

### 1. 模型可见契约不是 tool schema

[命令提示词](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/shell.py#L1-L20)要求模型：

- 在 bash 代码块中建议可直接执行的命令。
- 每行一条，建议 1–3 条，不要多行命令。
- 从项目根目录执行。
- 根据提供的平台信息选用合适 shell。

这里的 1–3 条是提示词指导，不是 runtime 硬上限。
[默认参数](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/args.py#L806-L811)将 suggest-shell-commands 设为 True。
[提示词选择](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1185-L1196)在关闭时换成无命令建议版本。
执行入口也检查该开关，关闭不只是修改提示词。

[editblock 解析器](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/editblock_coder.py#L439-L484)识别 bash/sh/shell/cmd/powershell 等 fenced block。
紧邻 SEARCH/REPLACE 的代码块有专门排除判断，避免把待编辑脚本误当命令。
以 filename=None 的条目返回，再由 get_edits 收集进 self.shell_commands。
这是文本解析协议，不是服务端注册 JSON schema 的工具调用。
本结论限命令链路，不推导“Aider 所有功能都没有任何 function-call 模式”。

### 2. 关键调用链与入口分流

```text
模型回复 shell fenced block
 → editblock get_edits → shell_commands
 → run_shell_commands（开关检查、去重）
 → handle_shell_commands（确认、按行执行）
 → run_cmd
    ├─ stdin TTY && pexpect.spawn && 非 Windows
    │   → pexpect.spawn → child.interact → child.close
    └─ 其他
        → Popen(stdout=PIPE, stderr=STDOUT, shell=True)
        → read(1) + print + 累积 → wait
 → 分享输出确认 → user 消息 + assistant "Ok"
```

[模型执行调度](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2434-L2485)用 set 去重命令块。
每个块按行 strip、跳过空行和注释；每行独立调用 run_cmd，不保持同一 shell。
所以模型建议的 cd 和下一行命令不会共享 cwd；不能把 multiline block 当持久 shell 脚本。
执行根目录由 self.root 显式传入。

| 入口 | 执行前确认 | 使用后端 | 输出去向 |
|---|---|---|---|
| 模型 shell 建议 | explicit_yes_required | run_cmd 自动分支 | 另问是否加入聊天 |
| /run、! | 用户已经显式发起，不另问执行 | run_cmd 自动分支 | 报 token 数后询问 |
| /test / auto_test | 非普通建议确认路径 | cmd_run(args, True) | 非零退出自动加入 |
| lint | 独立 lint 流程 | 强制 run_cmd_subprocess | 失败作为 lint 结果 |
| /git | 不经 run_cmd | subprocess.run | 命令文档标明排除聊天 |

[/run、/test](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/commands.py#L993-L1053)与[lint 强制 subprocess](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/linter.py#L47-L68)证明不能把所有入口概括成“统一 PTY”。
/git 设置 GIT_EDITOR=true；这只是避免编辑器启动，不是通用交互控制。

### 3. run_cmd 探测的是宿主输入，不是命令需求

[分派条件](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/run_cmd.py#L11-L23)精确为：

```python
sys.stdin.isatty() and hasattr(pexpect, "spawn") and platform.system() != "Windows"
```

没有根据 vim/npm init/sudo 等命令名检测。
TTY 环境下 echo 也可能走 pexpect；非 TTY 环境下需要交互的命令也会走 subprocess。
只检查 stdin，不检查 stdout.isatty；因此重定向 stdout 后的体验仍需验证。
pexpect 是顶层 import，hasattr 不是“没安装依赖时也能安全回退”的完整保证。
[锁定依赖](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/requirements.txt#L248-L251)为 pexpect 4.9.0；本轮未安装或执行它。

### 4. subprocess：stdout pipe 不代表 stdin 可续写

[完整 subprocess 实现](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/run_cmd.py#L42-L86)设置 stdout=PIPE、stderr=STDOUT，未设置 stdin。
依 Python Popen 的默认契约，stdin 继承父输入，不是 DEVNULL，也不是 Aider 保存的可写 PIPE。
Aider 没有 process.stdin.write、communicate(input=...) 或 write_stdin 命令。
读循环每次 read(1)，print(flush=True) 即时回显，再 append 到列表。
没有换行也可尝试读取，但子进程自身是否 flush、底层解码如何缓冲仍会影响及时性。
bufsize=0 不能消除子程序自己的 stdio 缓冲。
read(1) 也不能直接等同于“每字符一个操作系统调用”；旧报告的该性能表述缺乏实测。

headless 场景有两种不同风险：

- 父 stdin 已 EOF：子程序可能得到 EOF，然后退出或报错。
- 父 stdin 仍打开：子程序可能读取后续内容或等待更多输入，Aider 同步执行被阻塞。

因此“非 TTY 自动回退，不会挂死等输入”不成立。
关闭父输入和关闭某个受管 session 的写端是不同能力；这里没有后者。
stdout 读到 EOF 后才 wait，若后代持有写端，父 shell 退出也不保证读循环立刻结束。

### 5. pexpect：人工接管、输出抄录

[PTY 路径](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/run_cmd.py#L89-L132)先确定 SHELL，默认 /bin/sh。
路径存在时 spawn(shell, args=["-i", "-c", command], encoding="utf-8", cwd=cwd)。
-i 让 shell 进入交互方式，可能加载用户 shell 配置；这与普通 Popen(shell=True) 环境并不等价。
若 SHELL 路径不存在，退为 pexpect.spawn(command)，没有再包装 shell。
故不能说两分支都用了 shell=True，也不能保证 fallback 支持同样的管道、重定向解析。

child.interact(output_filter=output_callback) 把交互交给用户。
output_callback 将收到的字节写入 BytesIO，再原样返回给显示路径。
Aider 本身没有 input_filter，没有模型输入队列，没有“用户/模型写权切换”状态。
interact 返回后 child.close，再读 child.exitstatus。
这是一段同步人工操作窗口，不是工具先 yield 后模型接着操作。

Aider 没有显式设置 interact 的 escape_character、signal 转发策略或 EOF 操作。
Ctrl-C 是否成为 PTY 行规程 SIGINT、Ctrl-D 是否生效，受 pexpect 与终端模式影响。
本轮没有读取/执行 pexpect 内部实现，所以不把默认 escape 键、终端恢复细节或信号转发作为已验证产品行为。
“人能操作终端”与“已经验证 vim/sudo/rebase 全部正常”必须分开。

### 6. explicit_yes_required 的实际语义

[完整确认逻辑](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/io.py#L807-L925)必须整体阅读，不能只看参数名。

| 输入/配置 | explicit_yes_required=True 时结果 |
|---|---|
| self.yes=True，即全局 --yes | res="n"，拒绝 |
| self.yes=False | 拒绝 |
| 用户键入 y/yes | 同意 |
| 用户键入 a/all | 不作为同意，也不能建立 All 偏好 |
| 空回车 | 使用 default；调用方没覆写时为 y，因此同意 |
| EOFError | 使用 default；该调用路径默认 y，因此同意 |
| 已记录 Don't ask again | 直接拒绝 |
| 分组 Skip all | 后续跳过 |

default="y" 位于签名；EOF/空串处理位于 884–891；最终判断位于 908–911。
[模型调用方](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2450-L2463)没有传 default="n"。
所以应表述为“压制自动 yes 和批量 All”，而非“必须输入明确肯定文本”。
EOF 在此是确认 UI 的事件，不是子进程输入 EOF；两个生命周期不能混淆。
该发现为源码分支推导，未做端到端无人值守运行；启动阶段还有其他读取/退出条件，不能武断宣称任意 EOF 启动都会执行命令。

### 7. 输出如何进入模型

模型建议命令执行后按 Output from command + output 拼接。
再次确认 Add command output to the chat? 才返回给调用者。
[加入对话的位置](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1599-L1623)添加 role=user 和 assistant="Ok"。
没有结构化 tool_result，也没有运行中的模型输出流。
[/run 回传](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/commands.py#L1013-L1053)先估 token，再询问。
[prompts.run_output](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/prompts.py#L36-L43)只有 command/output，不含 exit code。

exit code 没直接显示在模型模板，不等于“只有自动修复才使用它”：
/run 非零后设置下一条输入提示，/test 非零决定自动分享。
模型建议路径接收 exit_status 但不使用。
pexpect signal 终止时 Aider 没读取 child.signalstatus 或归一化 exitstatus；可能的 None 与 subprocess 返回码不统一。
/test 的 !=0 判断会把 None 视作非零；实际信号行为留待运行验证。

### 8. 日志、秘密与输出治理

PTY 捕获的是输出，不是每个按键的独立输入日志。
但终端回显的输入会成为输出；打印出来的 token、password 或连接串也会进入 BytesIO。
应用关闭 echo 时是否泄露依赖实际终端行为；Aider 未增加秘密识别或自动脱敏。
人同意分享后，捕获正文会进入模型上下文；/test 失败还会绕过该分享询问。

[模型命令写入输入历史](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2471-L2485)发生在执行前。
[FileHistory 持久化](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/io.py#L736-L745)在配置了 input_history_file 时写入。
命令确认的 subject 和 Running command 通过 tool_output 展示。
[tool_output 日志](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/io.py#L995-L1002)和[聊天日志文件写入](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/io.py#L1117-L1136)证明拒绝输出分享不等于命令无痕。
run_cmd 的逐字符 print 不直接调用该日志函数；不能反向声称捕获的每个字节都必然进入 Aider chat-history 文件。
OS 终端录屏、shell/program 日志属于额外边界，本轮未验证。

subprocess 列表和 PTY BytesIO 全量累积，没有执行链上的截断、溢出文件、大小配额。
/run 的 token 提示只是用户决策信息，不是内存/上下文硬限制。
无限输出、ANSI 控制序列、慢终端和读取背压缺少本轮验证，不能以“有人看着”代替资源预算。

### 9. 并发、session 和清理

run_shell_commands 按序 await 等价地同步调用 run_cmd；每条命令新建进程。
没有跨 turn process id/session id、owner 绑定、任务上限、TTL、LRU 或重新接入 API。
PTY 内人类输入与输出并行由 pexpect.interact 承担，不代表 Aider 提供模型读写并发。
没有用户/模型同时争用 stdin 的仲裁协议，因为模型根本没有该写入通道。

subprocess 在正常路径 wait；pexpect 在正常路径 close。
异常路径没有显式 finally 做 terminate/kill/wait；KeyboardInterrupt 也不属于 except Exception。
因此不能从正常 close 推导出取消、异常、宿主退出都可靠清理进程树。
Aider 本链没有默认运行 deadline、进程组创建/kill、宿主退出受管进程 registry。
上层有 KeyboardInterrupt 处理也不等于为这个局部 child 安排了清理。
Ctrl-C/EOF/异常脱离 interact 后的具体子进程存活和终端恢复属于 U。

### 10. 平台差异

Windows 被明确排除在 pexpect 分支之外。
[Windows 父进程探测](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/run_cmd.py#L26-L54)查 powershell.exe/cmd.exe，遇 powershell 包装 powershell -Command。
这不等于使用 ConPTY，也不保证交互式全屏程序体验。
Unix pexpect 使用 SHELL；subprocess 虽读取 SHELL 变量用于 verbose 展示，却未将其传为 Popen executable。
两个分支的 shell 选择不能混为一谈。
本轮未验证 Windows、PowerShell quoting、远程 TTY、重定向 stdout 或编码差异。

## 与旧 snapshot 的对比

两个报告 SHA 相同；没有产品源码变化可声称。

| 旧结论 | 本轮修正 | 类型 |
|---|---|---|
| 非 TTY 回退不会挂死等输入 | stdin 继承父流，仍可能等待/消费输入 | 原推断错误 |
| pty/subprocess 都 shell=True | 只有 Popen；pexpect 显式 shell 或直接 spawn | 原表述错误 |
| explicit_yes_required 不可被 --yes 覆盖 | 这点成立；但空回车/EOF 默认 Yes 漏掉了 | 补足关键分支 |
| 完整会话记录包括所有用户输入 | 只捕获输出；输入仅在回显等情况下包含 | 原表述过强 |
| PTY 只为人，因此自动 Agent 不该采用 | 这是产品取舍，PTY 也可由模型工具写入 | 原设计推论不成立 |
| exit code 唯一用途是反射循环 | 还影响 /run placeholder 和 /test 分享 | 原范围错误 |

保留旧文档，不改写历史；本轮作为 S004 使用时应以这份边界说明为准。

## 测试证据与缺口

- [test_run_cmd_echo](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/tests/basic/test_run_cmd.py#L1-L11)：仅 echo/退出码/输出。调用 run_cmd，实际会随测试 stdin 条件选择分支，不保证覆盖 PTY。
- [explicit_yes 测试](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/tests/basic/test_io.py#L176-L205)：覆盖 yes=True/False/手输 y；不覆盖 explicit_yes 下空回车或 EOF。
- [group 测试](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/tests/basic/test_io.py#L208-L247)：All、Skip、explicit_yes 隐藏 All。
- [命令建议测试](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/tests/basic/test_coder.py#L975-L1010)：mock handle_shell_commands，只证明解析/分派，不证明进程和人工接管。
- 全部测试只读未运行；未安装 requirements。
- U：PTY 密码回显、interact escape/EOF、Ctrl-C 与 SIGTERM、resize、终端模式恢复。
- U：headless 连续输入被子进程消费、stdout 后代继承、取消进程树。
- U：无限输出/内存上界、Unicode 分段、多平台 shell 差异、秘密落入远端模型的端到端轨迹。
- U：pexpect 4.9.0 内部实现未独立取证，依赖层行为不冒充 Aider 自己的明确契约。

## 对 S004 的选择启发

1. 把“人的交互能力”和“模型的交互协议”分层；Aider 证明前者可很轻，但后者仍需要句柄和状态机。
2. 若首期采用 pipe，显式 stdin=PIPE/DEVNULL，不能依赖继承 stdin 的隐式行为。
3. 输出实时显示不等于模型可反馈输入；设计 yield、poll、write、close 的完整回路。
4. EOF、Ctrl-D 字节、SIGINT、用户取消和宿主退出分别定义，避免一个“停止”覆盖所有状态。
5. 危险确认默认 No，EOF 应拒绝；测试应覆盖配置组合而不只看函数名。
6. 命令同意与输出分享分开有价值，但密码既可能在参数，也可能在终端回显；需要明确日志和脱敏政策。
7. 每次命令新进程可保持简单；若要跨 turn，就必须新增所有权、配额、清理、输出游标，不能只保留一个 Popen 对象。
8. 保留结构化 exitCode/signal/status；避免模型只能从自然语言输出猜测成功。
9. 不以人工确认代替运行超时和输出预算；不照搬全量 read 列表/BytesIO。
10. 这些是研究建议，不构成 E02-S004 已确认设计。

## 复现取证与参考资料

```sh
git clone --depth 100 https://github.com/Aider-AI/aider.git <checkout>
git -C <checkout> log -1 --format='%H %ci %D'
git -C <checkout> describe --tags --abbrev=0
git -C <checkout> show 5dc9490bb35f9729ef2c95d00a19ccd30c26339c:aider/run_cmd.py
git -C <checkout> show 5dc9490bb35f9729ef2c95d00a19ccd30c26339c:aider/io.py
```

- [调研方法](README.md)
- [S003 旧报告](../terminal/aider.md)
- 各节 permalink 固定在本次实际 HEAD；没有执行产品来证明端到端能力。

