# Aider — 终端执行（命令执行）调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [Aider-AI/aider](https://github.com/Aider-AI/aider) |
| 调研 Commit | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` |
| Commit 日期 | `2026-05-22 07:02:20 -0700` |
| 调研日期 | `2026-08-26` |

## 调研目标

为 E02-S003（`terminal` 工具）提供竞品参考。Aider 是五家竞品里唯一**不走 tool-calling** 的（写文件走 `editblock` 即 SEARCH/REPLACE 块，靠解析模型回复文本而非工具调用）。本次要用源码证据回答一个架构层面的问题：**Aider 的命令执行到底是 Agent 主动调用的工具、用户手敲的斜杠命令、还是「模型建议 + 人确认」？** 并覆盖执行机制、返回契约、输出量控制、超时、安全边界等维度。

> 本文所有结论均标注 `文件:行号`。凡源码中未找到实现的机制，明确写「未找到」而非用先验补齐；作者的解读一律显式标注为「推断」。

## 调研结论

1. **是「模型建议 + 人确认后执行」，不是 tool call，也不只是斜杠命令——三条入口共用同一个执行器。** 模型在回复里输出 ` ```bash ` 代码块，Aider 的 editblock 解析器把它当成一种「文件名为 None 的 edit」抽出来（`aider/coders/editblock_coder.py:33`、`aider/coders/editblock_coder.py:452-485`），存进 `self.shell_commands`（`base_coder.py:407`），编辑落盘后统一弹确认框执行（`base_coder.py:2434-2486`）。所以命令执行**复用了写文件那套「解析回复文本」的范式**，而不是新增一层工具协议。

2. **执行器只有一个：`run_cmd()`，且有 pty / subprocess 双分支。** `aider/run_cmd.py:11-23` 根据 `sys.stdin.isatty()`、`pexpect` 可用性、非 Windows 三个条件择一：满足则走 `run_cmd_pexpect`（伪终端，`run_cmd.py:89-132`），否则走 `run_cmd_subprocess`（`run_cmd.py:42-86`）。两者都 `shell=True`，都把 stderr 并进 stdout。

3. **输出回上下文是「问用户」而非自动，且被塞成一对伪造的 user/assistant 消息。** `commands.py:1026-1044` 先算 token 数再问 `Add {k}k tokens of command output to the chat?`，同意才把 `prompts.run_output` 格式化后 append 到 `cur_messages`，并配一句 `assistant: "Ok."`。**这是与 tool-calling 最本质的差别**：tool 结果天然有 `tool_result` 槽位，Aider 没有槽位，只能伪造对话轮次。

4. **exit code 的唯一用途是驱动「自动修复」反射循环。** `cmd_test` 调 `cmd_run(args, True)` 即 `add_on_nonzero_exit=True`（`commands.py:1004`），此时跳过询问、非零退出才加进上下文（`commands.py:1026-1027`）。lint/test 失败经 `self.reflected_message` 触发下一轮（`base_coder.py:1603-1623`），上限 3 次（`base_coder.py:101`）。

5. **无超时、无输出截断、无命令黑白名单、无沙箱——四个全部确认缺失。** 对 `run_cmd.py` / `commands.py` / `linter.py` / `base_coder.py` 检索 `timeout` 零命中；检索 `truncat|max_output` 零命中；对 `aider/*.py` 检索 `blacklist|whitelist|sandbox|allowlist|denylist|dangerous` 零命中。安全兜底**全靠人在确认框前的那一眼**。

## 详细分析

### A. 架构定位：三条入口，一个执行器

命令执行有三类入口，最终都汇到 `run_cmd()` 或其子函数：

| 入口 | 触发者 | 代码位置 | 输出是否进上下文 |
|------|--------|---------|-----------------|
| `/run <cmd>`（别名 `!`） | 用户手敲 | `commands.py:1013`；`!` 前缀在 `commands.py:312-315` 转发到 `do_run("run", ...)` | 问用户 |
| `/test <cmd>` / `auto_test` | 用户手敲 或 编辑后自动 | `commands.py:993-1011`；自动触发在 `base_coder.py:1616-1617` | **非零退出自动加**，不问 |
| ` ```bash ` 块 | **模型在回复里建议** | 解析 `editblock_coder.py:452-485`，执行 `base_coder.py:2434-2486` | 问用户 |
| `/lint` / `auto_lint` | 用户手敲 或 编辑后自动 | `commands.py:356`；linter 执行走 `linter.py:47-58` | 失败后经 reflection 进上下文 |
| `/git <args>` | 用户手敲 | `commands.py:967-991`，**不走 `run_cmd`**，自己 `subprocess.run` | 明确排除（docstring：output excluded from chat） |

第三条最关键。模型被系统提示明确教了这个约定（`aider/coders/shell.py:1-20`）：

```text
# aider/coders/shell.py:1-9
shell_cmd_prompt = """
4. *Concisely* suggest any shell commands the user might want to run in ```bash blocks.

Just suggest shell commands this way, not example code.
Only suggest complete shell commands that are ready to execute, without placeholders.
Only suggest at most a few shell commands at a time, not more than 1-3, one per line.
Do not suggest multi-line shell commands.
All shell commands will run from the root directory of the user's project.
"""
```

注意措辞是 **suggest**（建议给用户跑），不是 execute。这个提示由 `--suggest-shell-commands` 开关控制（`aider/args.py:807-811`，默认 True），关闭时换成 `no_shell_cmd_prompt`（`base_coder.py:1187-1196`）——即**只告知平台信息、不邀请模型提命令**。

解析侧的实现很有意思：shell 块和 SEARCH/REPLACE 块**共用同一个生成器**，靠 `fname is None` 区分：

```python
# aider/coders/editblock_coder.py:452-485（节选）
shell_starts = [
    "```bash", "```sh", "```shell", "```cmd", "```batch",
    "```powershell", "```ps1", "```zsh", "```fish",
    "```ksh", "```csh", "```tcsh",
]

# Check if the next line or the one after that is an editblock
next_is_editblock = (
    i + 1 < len(lines) and head_pattern.match(lines[i + 1].strip())
    or i + 2 < len(lines) and head_pattern.match(lines[i + 2].strip())
)

if any(line.strip().startswith(start) for start in shell_starts) and not next_is_editblock:
    shell_content = []
    i += 1
    while i < len(lines) and not lines[i].strip().startswith("```"):
        shell_content.append(lines[i])
        i += 1
    ...
    yield None, "".join(shell_content)   # ← fname 为 None 即 shell 命令
    continue
```

```python
# aider/coders/editblock_coder.py:33-34
self.shell_commands += [edit[1] for edit in edits if edit[0] is None]
edits = [edit for edit in edits if edit[0] is not None]
```

`next_is_editblock` 这个判断是为了避免把 ` ```bash ` 开头的 SEARCH/REPLACE 块（即编辑一个 shell 脚本文件）误判成待执行命令——一个 parser 容错细节，也正是「文本解析范式」必须付的税。

`shell_commands` 每轮对话开头清空（`base_coder.py:870`），生命周期是单轮。

### B. 执行机制

**分派逻辑**（`run_cmd.py:11-23`）：

```python
# aider/run_cmd.py:11-23
def run_cmd(command, verbose=False, error_print=None, cwd=None):
    try:
        if sys.stdin.isatty() and hasattr(pexpect, "spawn") and platform.system() != "Windows":
            return run_cmd_pexpect(command, verbose, cwd)

        return run_cmd_subprocess(command, verbose, cwd)
    except OSError as e:
        error_message = f"Error occurred while running command '{command}': {str(e)}"
        ...
        return 1, error_message
```

统一返回 `(exit_status, output)` 二元组，OSError 兜底成 `(1, 错误文本)`。

**subprocess 分支**（`run_cmd.py:42-86`）的要点：

```python
# aider/run_cmd.py:61-73
process = subprocess.Popen(
    command,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,     # stderr 并入 stdout，模型只看到一条流
    text=True,
    shell=True,                   # 走 shell，支持管道/重定向/&&
    encoding=encoding,
    errors="replace",             # 编码失败不抛异常，替换字符
    bufsize=0,                    # 无缓冲，为了实时回显
    universal_newlines=True,
    cwd=cwd,
)
```

之后是 `process.stdout.read(1)` 的**逐字符**循环，边打印边攒到 `output` 列表（`run_cmd.py:75-82`）。这是为了实时回显给用户，代价是每字符一次系统调用。

- **工作目录**：由调用方传入。`/run` 传 `self.coder.root`（`commands.py:1016`），模型建议的命令传 `self.root`（`base_coder.py:2475`），linter 传 `self.root`（`linter.py:55`）。全部是项目根，与提示里承诺的「All shell commands will run from the root directory」一致。
- **环境变量**：`run_cmd` 全程**未传 `env`**，即完整继承父进程环境。唯一例外是 `/git`，它显式注入 `GIT_EDITOR=true` 防止 git 拉起交互编辑器卡住（`commands.py:971-973`）。
- **编码**：subprocess 分支默认 `encoding=sys.stdout.encoding`（`run_cmd.py:42` 的默认参数），linter 显式传 `self.encoding`（`linter.py:56`）；pexpect 分支硬编码 `encoding="utf-8"`（`run_cmd.py:112`），收尾再 `decode("utf-8", errors="replace")`（`run_cmd.py:125`）。
- **Windows 特例**：`get_windows_parent_process_name()` 用 psutil 向上遍历父进程，若发现 `powershell.exe` 就把命令包一层 `powershell -Command`（`run_cmd.py:26-38`、`run_cmd.py:49-52`）。

**pexpect 分支**（`run_cmd.py:89-132`）——理解 Aider 命令执行体验的关键：

```python
# aider/run_cmd.py:105-122
shell = os.environ.get("SHELL", "/bin/sh")
if os.path.exists(shell):
    child = pexpect.spawn(shell, args=["-i", "-c", command], encoding="utf-8", cwd=cwd)
else:
    child = pexpect.spawn(command, encoding="utf-8", cwd=cwd)

# Transfer control to the user, capturing output
child.interact(output_filter=output_callback)

child.close()
return child.exitstatus, output.getvalue().decode("utf-8", errors="replace")
```

`child.interact()` 是核心：它**把终端控制权直接交给用户**，同时用 `output_filter` 旁路抄录所有输出到 `BytesIO`。注意 shell 是以 `-i`（interactive）启动的，会加载用户的 rc 文件。

这直接回答了「为什么要 pty」：**为了让模型建议的命令能是交互式的**。`npm init`、`git rebase -i`、需要输密码的 `sudo`、甚至 `vim`，用户都能真的在里面敲键盘，敲完的完整会话记录（含用户输入的回显）再作为 output 返回。这是 Aider 作为「人在环内的结对编程工具」的定位决定的设计，与「Agent 全自动跑命令」是两条路。

条件 `sys.stdin.isatty()` 意味着：Aider 被脚本化调用（stdin 非 tty）时自动退回 subprocess，不会挂死等输入。

### C. 返回契约

**输出如何进上下文**（`commands.py:1026-1044`）：

```python
# aider/commands.py:1026-1046（节选）
if add_on_nonzero_exit:
    add = exit_status != 0
else:
    add = self.io.confirm_ask(f"Add {k_tokens:.1f}k tokens of command output to the chat?")

if add:
    num_lines = len(combined_output.strip().splitlines())
    ...
    msg = prompts.run_output.format(command=args, output=combined_output)

    self.coder.cur_messages += [
        dict(role="user", content=msg),
        dict(role="assistant", content="Ok."),
    ]

    if add_on_nonzero_exit and exit_status != 0:
        return msg
    elif add and exit_status != 0:
        self.io.placeholder = "What's wrong? Fix"
```

模板（`aider/prompts.py:36-43`）是纯自然语言，**不含 exit code**：

```text
run_output = """I ran this command:

{command}

And got this output:

{output}
"""
```

三个值得注意的点：

1. **exit code 不进上下文**。模型看不到退出码，只能从 output 文本里自己猜是否成功。这是文本范式的信息损失。
2. **伪造 assistant 回复 `"Ok."`**。因为没有 `tool_result` 角色可用，只能凑成合法的 user/assistant 交替。
3. **`io.placeholder = "What's wrong? Fix"`**：命令失败且用户选了加进上下文时，Aider 把下一轮输入框**预填**成 "What's wrong? Fix"——用户敲回车即触发修复。这是把「决定是否修复」的权力留给人的 UI 技巧，不是自动循环。

模型建议的命令走另一条路（`base_coder.py:2477-2486`）：多条命令的输出先按 `Output from {command}\n{output}\n` 拼接，最后统一问一次 `Add command output to the chat?`，返回值由 `base_coder.py:1609-1614` 接住塞进 `cur_messages`。这里同样不带 exit code——`exit_status` 在 `base_coder.py:2475` 被接收后**从未被使用**。

**exit code 的真实用途在 lint/test 自动修复循环**：

```python
# aider/linter.py:53-64（节选）
returncode, stdout = run_cmd_subprocess(cmd, cwd=self.root, encoding=self.encoding)
...
errors = stdout
if returncode == 0:
    return  # zero exit status

res = f"## Running: {cmd}\n\n"
res += errors
return self.errors_to_lint_result(rel_fname, res)
```

linter 强制走 subprocess 分支（`linter.py:15` 直接 import `run_cmd_subprocess`），**绕过 pty**——推断：lint 是全自动批量执行的，不该把终端控制权交出去。

反射循环（`base_coder.py:1600-1623`）：

```python
# aider/coders/base_coder.py:1600-1623（节选）
lint_errors = self.lint_edited(edited)
self.auto_commit(edited, context="Ran the linter")
self.lint_outcome = not lint_errors
if lint_errors:
    ok = self.io.confirm_ask("Attempt to fix lint errors?")
    if ok:
        self.reflected_message = lint_errors
        return

shared_output = self.run_shell_commands()
if shared_output:
    self.cur_messages += [
        dict(role="user", content=shared_output),
        dict(role="assistant", content="Ok"),
    ]

if edited and self.auto_test:
    test_errors = self.commands.cmd_test(self.test_cmd)
    self.test_outcome = not test_errors
    if test_errors:
        ok = self.io.confirm_ask("Attempt to fix test errors?")
        if ok:
            self.reflected_message = test_errors
            return
```

顺序是 **lint → 模型建议的 shell 命令 → test**，每个失败点都要人点头才反射，上限 `max_reflections = 3`（`base_coder.py:101`，超限告警见 `base_coder.py:939-940`）。

### D. 输出量控制

**源码中无截断机制。** 对 `run_cmd.py` / `commands.py` / `linter.py` 检索 `truncat`、`max_output`、`[:1000]` 均零命中。输出全量攒在内存里（subprocess 分支的 `output` list、pexpect 分支的 `BytesIO`），全量返回。

唯一的「控制」是**把 token 数摆给用户看，让人做决定**（`commands.py:1022-1029`）：

```python
# aider/commands.py:1022-1029
token_count = self.coder.main_model.token_count(combined_output)
k_tokens = token_count / 1000
...
add = self.io.confirm_ask(f"Add {k_tokens:.1f}k tokens of command output to the chat?")
```

模型建议的命令那条路更弱，只报行数不报 token（`base_coder.py:2481-2484`）。

**推断**：这个设计只在「人在环内」时成立——`pytest` 刷十万行时，人看到 `Add 350.0k tokens...` 会说 no。换成全自动 Agent 就直接炸上下文窗口了。对 zero2agent 是明确的反面参考。

### E. 超时

**无超时机制。** `run_cmd.py`、`commands.py`、`linter.py`、`base_coder.py` 四个文件检索 `timeout` **零命中**。

- subprocess 分支：`process.wait()`（`run_cmd.py:84`）无参数，无限等待。
- pexpect 分支：`child.interact()` 本就是交互式，语义上不该有超时。

**推断**：这是 pty 设计的直接后果——既然要支持 `vim` 这类需要人待很久的命令，超时就自相矛盾。用户卡住时的退路是 Ctrl-C，而这在 pty 下会正确转发给子进程。zero2agent 若做全自动 Agent，超时不能省。

### F. 安全边界

| 机制 | Aider 是否有 | 证据 |
|------|-------------|------|
| 执行前确认 | ✅（模型建议的命令） | `base_coder.py:2455-2463` |
| 执行前确认 | ❌（`/run`、`/test`、`/git`） | `commands.py:1015` 直接执行，无 confirm |
| 命令黑白名单 | ❌ | `aider/*.py` 检索 `blacklist\|whitelist\|allowlist\|denylist\|dangerous` 零命中 |
| 沙箱 / 权限降级 | ❌ | 检索 `sandbox` 零命中 |
| 路径/工作目录限制 | ❌ | 仅设 `cwd=root`，命令内可任意 `cd ..` |
| 事后可回滚 | 🟡 git 自动 commit（针对编辑，非命令副作用） | `base_coder.py:1601` |

`/run` 不确认是合理的——那是用户自己敲的。真正的关卡在模型建议的命令：

```python
# aider/coders/base_coder.py:2450-2463
def handle_shell_commands(self, commands_str, group):
    commands = commands_str.strip().splitlines()
    command_count = sum(
        1 for cmd in commands if cmd.strip() and not cmd.strip().startswith("#")
    )
    prompt = "Run shell command?" if command_count == 1 else "Run shell commands?"
    if not self.io.confirm_ask(
        prompt,
        subject="\n".join(commands),
        explicit_yes_required=True,
        group=group,
        allow_never=True,
    ):
        return
```

四个参数各有讲究：

- **`subject="\n".join(commands)`**：把命令原文加粗显示出来（`io.py:848-857`），确保人看到自己批的是什么。
- **`explicit_yes_required=True`**：这是**最重要的安全设计**。`io.py:866-867` 里 `if self.yes is True: res = "n" if explicit_yes_required else "y"`——即**即使用户全局开了 `--yes` 自动同意，模型建议的 shell 命令依然被拒**。Aider 明确把「跑模型给的命令」列为不可自动化的操作。同时它也让 `(A)ll` 选项在分组确认里消失（`io.py:832-836`）。
- **`group=ConfirmGroup(...)`**（构造于 `base_coder.py:2439`）：一轮里多条命令共享一次决策；`show_group` 仅在多于 1 条时为真（`io.py:86-88`）。
- **`allow_never=True`**：提供 `(D)on't ask again`，把 `(question, subject)` 记进 `never_prompts` 永久拒绝（`io.py:902-903`、`io.py:823-824`）。注意 key 含 subject，所以是「这条具体命令别再问」而非「所有命令别再问」。

命令内以 `#` 开头的行被当注释跳过（`base_coder.py:2468-2469`），且执行过的命令会写进输入历史 `/run <cmd>`（`base_coder.py:2474`），方便用户复用。同一轮内重复命令去重（`base_coder.py:2441-2444` 的 `done` set）。

### G. 特殊命令处理（长时间 / 交互式 / 后台）

- **交互式命令**：pty 分支的 `child.interact()` 原生支持——用户直接在子进程终端里操作，stdin 全程可用（`run_cmd.py:120`）。这是 Aider 最独特的地方，五家里唯一把终端控制权真交给人的。
- **长时间运行**：无超时，靠人 Ctrl-C。
- **后台执行**：**未找到**任何后台/异步执行机制。无 `&` 特殊处理、无任务表、无 job 管理。`run_cmd` 是彻底同步阻塞的，`process.wait()` / `child.close()` 之后才返回。
- **stdin 注入**：`run_cmd_subprocess` **未设置 `stdin=PIPE`**（`run_cmd.py:61-73`），子进程继承父进程 stdin。所以 subprocess 分支下交互式命令行为不确定（可能读到 Aider 的输入流）——**推断**：这正是 Aider 优先走 pty 的动机之一。

## 对 zero2agent 的启发

### 核心洞察：Aider 反证了 tool-calling 的必要性

Aider 的命令执行和它的写文件是同一个范式，代价在这里比写文件暴露得更彻底：

| 维度 | Aider（文本建议 + 人确认） | tool-calling 的 terminal 工具 |
|------|--------------------------|---------------------------|
| 命令来源 | 从回复正文正则抓 ` ```bash ` 块 | 结构化 `tool_call` 参数 |
| 歧义风险 | 高——「示例代码」和「要执行的命令」都是 ```bash，靠 `next_is_editblock` 之类启发式硬扛（`editblock_coder.py:467-475`） | 无——调工具就是要执行 |
| 结果回传 | 伪造 `user` + `assistant:"Ok."` 消息对（`commands.py:1041-1044`） | 天然的 `tool_result` 槽位 |
| exit code | **丢失**，模型看不到（`prompts.py:36-43`） | 可结构化返回 |
| 谁决定执行 | 人（每次确认） | 模型（Harness 兜底策略） |
| 谁决定下一步 | 人（`placeholder = "What's wrong? Fix"`） | 模型（读 tool_result 自主决策） |

**最本质的差别不是协议形式，而是控制权归属。** Aider 里模型只有「建议权」，执行与否、输出是否给模型看、失败后是否修复，三个决策点全在人手上（`base_coder.py:2455`、`base_coder.py:2479-2480`、`base_coder.py:1604-1606`）。tool-calling 的 terminal 工具则把这三件事交给模型闭环。这解释了为什么 Aider 敢不做超时、不做截断——**有人兜着**。zero2agent 走 tool-calling，就没有这个人形兜底，超时和截断从「可选优化」变成「必需品」。

### 可直接借鉴（S003 范围内）

1. **`(exit_status, output)` 二元组 + stderr 合并进 stdout**（`run_cmd.py:22`、`run_cmd.py:63`）。极简且够用：一条输出流对模型最友好，不用纠结 stdout/stderr 交错顺序。zero2agent 的 terminal 回执可以就是「exit code + 合并输出」。
2. **但一定要把 exit code 给模型**。Aider 丢了它（`prompts.py:36-43`），模型只能猜。这是个可以直接在教程里点出来的对比点。
3. **`shell=True` + `cwd` 显式传入**（`run_cmd.py:67`、`run_cmd.py:72`）。走 shell 才能支持管道和 `&&`，这是 Agent 跑命令的实际需要；`cwd` 从 `ToolContext` 传入，与 S001/S002 已建立的 cwd 约定一致。
4. **`errors="replace"` 兜编码**（`run_cmd.py:70`）。命令输出含二进制/乱码时不抛异常，教学代码里一行参数换来的健壮性。
5. **OSError 转成返回值而非抛异常**（`run_cmd.py:17-23`）。命令不存在时返回 `(1, 错误说明)` 让模型自己纠正，比抛给 Harness 更符合 Agent 语义。

### 明确不借鉴 / 反面参考

1. **不做 pty**。pty 是为「人在环内接管终端」服务的（`child.interact()`，`run_cmd.py:120`），zero2agent 是全自动 Agent，没有人来敲键盘，pty 只带来复杂度（依赖 pexpect、Windows 不支持、交互挂死风险）。S004 若要做交互式命令，也该走「stdin 参数 / 后台 + 写入」而非把控制权交出去。
2. **必须补超时**。Aider 无超时（`timeout` 零命中）是它 pty 设计的合理后果，但对全自动 Agent 是致命的——一个 `npm install` 卡住就永久挂死，且没人能 Ctrl-C。
3. **必须补输出截断**。Aider 用「报 token 数问人」代替截断（`commands.py:1022-1029`），全自动场景下这条路不存在。建议截断保留头尾（错误信息常在尾部，命令回显常在头部）并标注省略量。
4. **确认流程不是 S003 的事，但 `explicit_yes_required` 的思想要记住**。`io.py:866-867` 那行「即使 `--yes` 也拒绝模型给的 shell 命令」是 Aider 对危险性的最强表态。zero2agent Epic 3（安全边界）做 approval 时，「有些操作不允许被 auto-approve 覆盖」是个可以直接搬的分级思路。
5. **逐字符 `read(1)` 读输出**（`run_cmd.py:76-80`）不要学。那是为实时回显给人看服务的，Agent 场景直接 `communicate()` 收全量即可。

### 落到 S003 的建议形态

```
terminal({ command: string }) -> string
  ├─ 执行：走 shell，cwd 来自 ToolContext，继承环境变量
  ├─ 收集：stderr 合并进 stdout，encoding 容错
  ├─ 超时：有默认上限，超时 kill 并明确告知模型（补 Aider 之缺）
  ├─ 截断：超阈值截头尾并标注（补 Aider 之缺）
  └─ 回执：明确包含 exit code + 输出（补 Aider 之缺）
```

三个「补 Aider 之缺」正好是 S003 相对 Aider 的教学增量，也是「非 tool-calling → tool-calling」这个范式迁移必然要付的账。

## 关键源码引用速查

| 位置 | 内容 |
|------|------|
| `aider/run_cmd.py:11-23` | `run_cmd` 分派：pty / subprocess 三条件判断 |
| `aider/run_cmd.py:42-86` | `run_cmd_subprocess`：Popen + shell=True + 逐字符回显 |
| `aider/run_cmd.py:89-132` | `run_cmd_pexpect`：`child.interact()` 交出终端控制权 |
| `aider/run_cmd.py:26-38` | Windows 父进程探测（powershell 包装） |
| `aider/coders/shell.py:1-20` | `shell_cmd_prompt`：教模型用 ```bash 块「建议」命令 |
| `aider/coders/editblock_coder.py:452-485` | 从回复文本解析 shell 块，`yield None, content` |
| `aider/coders/editblock_coder.py:33-34` | 按 `fname is None` 分流到 `shell_commands` |
| `aider/coders/base_coder.py:2434-2448` | `run_shell_commands`：去重 + ConfirmGroup |
| `aider/coders/base_coder.py:2450-2486` | `handle_shell_commands`：确认、执行、问是否加上下文 |
| `aider/coders/base_coder.py:1600-1623` | lint → shell → test 的顺序与 reflection 触发 |
| `aider/commands.py:1013-1053` | `cmd_run`：token 计数、`run_output` 注入、placeholder |
| `aider/commands.py:993-1011` | `cmd_test`：`add_on_nonzero_exit=True` |
| `aider/commands.py:967-991` | `cmd_git`：独立 subprocess + `GIT_EDITOR=true`，输出不进 chat |
| `aider/linter.py:47-68` | linter 强制走 subprocess，returncode 非零才算错误 |
| `aider/io.py:807-870` | `confirm_ask`：`explicit_yes_required` 压制 `--yes` |
| `aider/args.py:807-811` | `--suggest-shell-commands` 开关（默认 True） |

## 参考资料

- [Aider write-file 调研](../write-file/aider.md)（同仓库同 commit，编辑范式背景）
- [replace-in-file 五竞品横向对比](../replace-in-file/README.md)
