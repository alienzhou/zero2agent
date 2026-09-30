# 人工终端交互复核：成熟产品与本课的异同

> 2026-09-30｜追加核验，服务用户「别的产品也是这个交互么」的问题。结论是有成熟先例，但入口、确认、焦点和输出分享并不统一。本次不修改业务行为，也不把源码阅读写成完整产品实测。

[调研索引](../README.md) | [本课技术设计](../../../specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md) | [两个试用场景](../../../specs/E02-act-and-execute/S004-interactive-commands/try-two-features.md)

## 结论

1. **让人直接操作外部程序、结束后回到 Agent，有成熟实现参照。** Aider 有人工 PTY 路径；pi 官方示例扩展借用终端；Gemini 有嵌入式 PTY 焦点切换。
2. **本课更接近「临时交出终端、结束后归还」，不是 Gemini 的完整焦点/后台界面。** pi 的交接形态接近，但它继承 stdio，没有新建 PTY；本课用 PTY 桥接，不能把两者底层说成相同。
3. **「直接入口也问一次 y/N」「正文一律不入模」是本课取舍，不是行业共识。** Aider 用户自己发起 /run 时不再问能否执行，结束后可以选择把正文加入聊天；Gemini 普通前台工具结果包含输出；pi 示例扩展仅返摘要。
4. **Ctrl-] 有既有终端约定，但语义不能混写。** Aider 依赖的 pexpect 4.9.0 默认也用 Ctrl-] 离开 interact；本课把它定义为中止整个受管会话，并清理进程。不是所有产品都用这个键。
5. **Codex 的 exec/write_stdin 是模型操作链，不能直接当成人工接管 UI 的同款证据。** 本轮不据此否定其其他客户端存在独立终端入口。

## 样本与证据

复用此前临时源码仓库，fetch 最新 main 并通过固定对象读取；没有覆盖旧快照工作树，也没有把分支名称当作版本。旧报告及 sources.json 保留 9 月 28 日历史观测。

| 样本 | 本次固定 SHA | 提交时间 | 本次证据 |
|---|---|---|---|
| Aider | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | 2026-05-22 07:02:20 -07:00 | 官方命令文档、源码；原始 run_cmd 模块的真实 PTY 实验 |
| pi-mono | `d2931ad3d5bf6936fbdfa5dfc81fb32f875499b2` | 2026-09-30 12:10:30 +02:00 | 官方示例扩展、用户命令调用链源码 |
| Gemini CLI | `38700b4b38bf387dafded6c97c3f190d084b49e9` | 2026-09-29 21:40:04 +00:00 | 官方 Shell 文档、按键映射、焦点处理、模型回执源码 |
| Codex | `2e5fea64eefcaa19f48458b2386011b619f69c70` | 2026-09-30 10:03:09 +00:00 | exec_command / write_stdin handler 与 schema 源码 |

不按这些 main 快照推断安装包的发布版本；本次没有核验发行 Tag。Aider 与旧快照 SHA 相同；pi 的 interactive-shell.ts、Gemini 的本次核心按键/输入文件与旧快照无差异，不能称为这两天才新增。

证据分级仍用 S（固定源码）、D（官方文档）、E（执行实验）、U（未验证）。四个完整 Agent 产品均未运行端到端会话；E 仅覆盖下述执行模块与本项目试用场景。

## 用户操作对比

| 产品／路径 | 怎么进入人工操作 | 如何返回或切换 | 交互正文是否进入模型 | 与本课的关键差别 |
|---|---|---|---|---|
| Aider | 用户 /run 或 !；模型建议命令则先问能否执行；满足 POSIX/TTY 条件时进入 pexpect | 程序结束回 Aider；pexpect 默认 Ctrl-] 离开交互 | /run 结束后询问是否把输出加到聊天；/test 非零时可自动加入 | 直接发起的 /run 不再额外确认执行，正文可选择分享 |
| pi 官方示例扩展 | 先加载 interactive-shell；!less 等匹配命令或 !i 强制交互 | 停止 TUI，程序结束后启动 TUI | 扩展不捕获正文，返回命令完成摘要；命令/摘要仍可记录 | 非默认扩展，只拦截用户 !，不是模型 bash 工具；继承 stdio |
| Gemini CLI | 交互式 shell 可用时，在运行中的命令上按 Tab 聚焦 | Shift+Tab 回到 Gemini 输入区；另有后台控制 | 普通前台结果包含 output；部分后台/摘要路径另有规则 | 切换焦点不等于终止程序，比本课多了嵌入式终端与后台交互 |
| Codex exec 链 | 模型调用 exec_command；后续用 session_id + chars 续写 | yield 返回模型，进程可继续运行 | 输出作为工具结果供模型使用 | 这里核验的是模型交互，不是把键盘独占交给人 |
| Zero2Agent S004 | 模型 interactive:true、用户 /terminal、独立 --terminal 都统一要求 y/yes 确认 | 程序结束归还；Ctrl-] 中止整个接管 | 仅状态/退出码/信号，不自动回传正文 | 无焦点切换、无交互后台化；直接入口也确认；不提供分享正文按钮 |

Gemini 的确认由权限策略等配置影响，本轮没有把它概括为「每次必问」或「默认不问」。本课显式人工模式也必须在启动前选择，不能把已启动的普通 pipe 命令原地升级为 PTY。

## 关键证据

### Aider：执行批准和分享输出是两件事

[官方命令文档](https://aider.chat/docs/usage/commands.html)对 /run 的说明是「Run a shell command and optionally add the output to the chat (alias: !)」。

- [commands.py#L1012-L1053](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/commands.py#L1012-L1053)：用户 /run 直接调用 run_cmd，再询问 Add ... tokens ... to the chat。不是执行前的第二次批准。
- [base_coder.py#L2450-L2485](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2450-L2485)：模型提出命令时先确认执行，随后再确认分享输出。
- [run_cmd.py#L11-L23](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/run_cmd.py#L11-L23)、[PTY 执行#L89-L132](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/run_cmd.py#L89-L132)：TTY 分派、child.interact、output_callback 捕获正文及 child.close。
- [io.py#L807-L815](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/io.py#L807-L815)、[默认回答#L884-L911](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/io.py#L884-L911)：默认值为 y，不能因 explicit_yes_required 参数名就说空回车一定拒绝。

本次还读取安装的 pexpect 4.9.0 `spawn.interact` 签名与实现：默认 escape_character 是 `\x1d`，文档明确为 Ctrl-]；它只是让 interact 返回，随后 Aider 才调用 child.close。参见 [pexpect API](https://pexpect.readthedocs.io/en/stable/api/pexpect.html#pexpect.spawn.interact)。本课的完整进程清理承诺不能从该快捷键推导出来。

### pi：最接近本课的「借出、归还」形态，但属于扩展

- [interactive-shell.ts#L1-L20](https://github.com/badlogic/pi-mono/blob/d2931ad3d5bf6936fbdfa5dfc81fb32f875499b2/packages/coding-agent/examples/extensions/interactive-shell.ts#L1-L20)：给出 `pi -e ...`、!vim、!i 等用法，并明确只拦截 user !，不拦截 agent bash。
- [交接实现#L135-L194](https://github.com/badlogic/pi-mono/blob/d2931ad3d5bf6936fbdfa5dfc81fb32f875499b2/packages/coding-agent/examples/extensions/interactive-shell.ts#L135-L194)：检测后直接停止 TUI、继承 stdio 执行、重启 TUI、返回摘要；没有额外 y/N 确认。
- [interactive-mode.ts#L6782-L6827](https://github.com/badlogic/pi-mono/blob/d2931ad3d5bf6936fbdfa5dfc81fb32f875499b2/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L6782-L6827)：用户命令进入扩展，结果交给 recordBashResult。只回摘要不等于不记录命令。

不能把官方示例扩展写成 pi 默认 bash 已支持人工接管；也不能把其继承终端写成创建 PTY。

### Gemini：当前快捷键是 Tab，搜索摘要可能过时

[当前官方 Shell 文档](https://geminicli.com/docs/tools/shell/)说明交互式命令使用 PTY，可运行 vim、nano、htop 等，并写明「To focus on the interactive shell, press Tab」。

- [keyBindings.ts#L398-L413](https://github.com/google-gemini/gemini-cli/blob/38700b4b38bf387dafded6c97c3f190d084b49e9/packages/cli/src/ui/key/keyBindings.ts#L398-L413)：Tab 聚焦、Shift+Tab 退出焦点、Ctrl+B 控制后台界面。
- [AppContainer.tsx#L1936-L1996](https://github.com/google-gemini/gemini-cli/blob/38700b4b38bf387dafded6c97c3f190d084b49e9/packages/cli/src/ui/AppContainer.tsx#L1936-L1996)：焦点与后台切换逻辑；Shift+Tab 只是归还焦点，不表示进程结束。
- [ShellInputPrompt.tsx#L28-L73](https://github.com/google-gemini/gemini-cli/blob/38700b4b38bf387dafded6c97c3f190d084b49e9/packages/cli/src/ui/components/ShellInputPrompt.tsx#L28-L73)：只有聚焦且有活动 PTY 时处理输入，再通过 writeToPty 写入。
- [shell.ts#L875-L930](https://github.com/google-gemini/gemini-cli/blob/38700b4b38bf387dafded6c97c3f190d084b49e9/packages/core/src/tools/shell.ts#L875-L930)：普通前台 llmContent 包含 result.output；人工操作不等于输出对模型保密。

本次搜索摘要仍出现旧镜像的 Ctrl+F，但当前官网与固定源码一致为 Tab。因此只将搜索用于找资料，不拿摘要决定快捷键；也没有据此宣称键位是在 9 月 28 日之后才改的。

### Codex：不能混为同一种交互

- [unified_exec.rs#L28-L73](https://github.com/openai/codex/blob/2e5fea64eefcaa19f48458b2386011b619f69c70/codex-rs/core/src/tools/handlers/unified_exec.rs#L28-L73)：exec 参数含 tty/yield 等，tty 默认 false。
- [write_stdin.rs#L22-L42](https://github.com/openai/codex/blob/2e5fea64eefcaa19f48458b2386011b619f69c70/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L22-L42)、[处理器#L81-L120](https://github.com/openai/codex/blob/2e5fea64eefcaa19f48458b2386011b619f69c70/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L81-L120)：模型通过 session_id、chars 继续操作，并收到工具结果。

以上只核验公开 exec 工具链，不作「所有 Codex 客户端没有人工终端」的否定判断。

## 本轮运行过什么

| 实验 | 实际范围与结果 | 不能推出什么 |
|---|---|---|
| Aider 原始执行模块 | 隔离依赖 pexpect 4.9.0 / psutil 7.2.2，加载上述 SHA 的 run_cmd.py，真实 PTY 中输入 example；显示 AIDER_VALUE=example，exit_code=0，返回正文包含该结果 | 没跑完整 Aider CLI、模型、执行确认或分享确认界面 |
| 本课 Node REPL | 两次输入创建 values=[1,2,3] 并 reduce 得 6；.exit 后 completed、exit 0 | 不是模型自行计算或自动填写；未验证所有 Node 调试功能 |
| 本课 less | 显式 UTF-8 后查看中文 README、翻页与搜索，再 q 返回；完整结果见试用页 | 不代表所有终端渲染器或全屏程序都通过验收 |

执行 Aider 模块时只装了两个直接依赖及其依赖到 uv 管理的隔离环境，没有安装完整产品，没有修改用户 shell 配置或调用模型。本课两条试用命令禁用相应 REPL/pager 历史文件，未改项目文件。

## 对本课方案的判断

当前方案作为教学版成立：它展示真实终端输入权的移交和恢复，能支撑 REPL、pager 等程序。但课程应明确三项自选边界：

- 模型请求和用户直接入口统一再次确认，逻辑一致但比 Aider /run 与 pi 用户入口多一步。是否给直接入口省掉重复确认，留到用户实际体验后决定，本轮不改。
- 正文默认不入模适合展示隐私边界，但意味着模型不知道人工操作细节；若以后需要继续分析输出，可单独讨论 Aider 式的「结束后主动分享」，不能悄悄改变当前契约。
- 暂不实现 Gemini 的焦点切换/后台面板。Ctrl-] 是结束会话，不能在课程图里画成「只是切回聊天，程序继续跑」。

原理、人工接管和模型续写要分开讲。先由用户用两个功能确认操作感受，再决定是否调整入口体验；不会因为看到其他产品不同，就未经确认重写已验收候选。
