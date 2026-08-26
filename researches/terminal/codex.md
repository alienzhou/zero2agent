# OpenAI Codex CLI — 终端执行（命令执行）调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [openai/codex](https://github.com/openai/codex) |
| 调研 Commit | `ce803c45aed425b08b94d8e3c5fb7db0d2193568` |
| Commit 日期 | `2026-07-23 17:48:06 +0000` |
| 语言 / 子目录 | Rust，`codex-rs/` |
| 调研日期 | `2026-07-24` |

> 本文所有结论均附 `文件路径:行号`（相对 `codex-rs/`）。凡源码中未找到证据的，明确标注「未找到」；凡属推断的，标注「推断」。

## 调研目标

为 E02-S003（引入 `terminal` 工具）提供竞品参考，回答 8 个问题：

1. 工具契约：叫什么名字、有哪些参数、描述怎么写
2. 执行机制：怎么 spawn、用不用 shell、env 怎么处理
3. 返回契约：给模型的回执长什么样、exit code 怎么传
4. 输出量控制：截断策略、上限是多少
5. 超时：默认值、超时后怎么处理进程
6. 安全边界：审批、沙箱、策略引擎、权限升级（重点）
7. 特殊命令：后台 / 长任务 / 交互式 stdin
8. 教学启发：哪些值得学、哪些太重

## 调研结论

1. **Codex 有两套并存的终端工具，按模型能力二选一装配**：经典的 `shell_command`（一次性执行、返回完整输出）和新的 `exec_command` + `write_stdin`（PTY 会话、可续写 stdin）。选择由 `shell_type_for_model_and_features()` 在 `tools/src/tool_config.rs:81-116` 完成，落地于 `core/src/tools/spec_plan.rs:663-686`。

2. **参数最小集是 `command` + `workdir` + `timeout_ms`**（`core/src/tools/handlers/shell_spec.rs:158-177`），与 OpenCode 的三件套完全一致。默认超时 `10000 ms`（`core/src/exec.rs:58`），比 OpenCode 的 2 分钟激进得多。

3. **回执是纯文本、带 `Exit code:` 和 `Wall time:` 前缀的分段字符串**，不是 JSON（`core/src/tools/mod.rs:78-103`）。非零退出被包装成 `FunctionCallError::RespondToModel`——仍然回给模型，但走「失败」通道（`core/src/tools/events.rs:378-382`）。

4. **截断是「掐中间、留头尾」，且按 token 预算而非字节**（`utils/string/src/truncate.rs:15-36`、`utils/output-truncation/src/lib.rs:25-30`）。截断时显式告知模型原始 token 数与总行数（`utils/output-truncation/src/lib.rs:12-23`）。这与 OpenCode 的「截尾」是明确分歧。

5. **安全边界是本仓库最重的部分，共四层**：Starlark DSL 策略引擎（`execpolicy/`）→ 命令安全启发式（`shell-command/src/command_safety/`）→ 平台沙箱（seatbelt / seccomp / Windows restricted token）→ 沙箱拒绝后的审批重试升级（`core/src/tools/orchestrator.rs:301-470`）。**这四层加起来是数千行代码，教学项目不可能照抄。**

6. **超时不是「kill 进程」而是「kill 进程组」**，并且有 2 秒的 I/O 排空兜底防止孙进程占着管道把 agent 挂死（`core/src/exec.rs:82-89, 1026-1027, 1101-1102`）。

7. **交互式 / 长任务由 `exec_command` 的「yield 而非等待」模型承担**：到点先返回已有输出 + `session_id`，模型后续用 `write_stdin` 续写或空轮询（`core/src/tools/handlers/shell_spec.rs:113-155`）。会话池上限 64（`core/src/unified_exec/mod.rs:73`），超限按 LRU prune。

8. **Codex 确实有后台进程列表 API，但不暴露给模型**：`list_processes()`（`core/src/unified_exec/process_manager.rs:1437-1454`）只经 `CodexThread::list_background_terminals()`（`core/src/codex_thread.rs:442-444`）供 app-server / 客户端 UI 使用（`app-server/src/request_processors/thread_processor.rs:1890-1901`）。模型侧没有 `list_processes` 工具。

## 详细分析

### A. 工具契约

#### A.1 三个工具、两套范式

| 工具名 | 定义位置 | 参数（必填加粗） | 用途 |
|--------|---------|----------------|------|
| `shell_command` | `core/src/tools/handlers/shell_spec.rs:157-225` | **`command`**、`workdir`、`timeout_ms`、`login`、`sandbox_permissions`、`justification`、`prefix_rule`、`additional_permissions` | 一次性执行，跑完返回 |
| `exec_command` | `core/src/tools/handlers/shell_spec.rs:21-111` | **`cmd`**、`workdir`、`tty`、`yield_time_ms`、`max_output_tokens`、`shell`、`login`、`environment_id`、+ 同上审批参数 | PTY 会话，到点 yield |
| `write_stdin` | `core/src/tools/handlers/shell_spec.rs:113-155` | **`session_id`**、`chars`、`yield_time_ms`、`max_output_tokens` | 向已有会话写 stdin / 空轮询 |

装配三态（`core/src/tools/spec_plan.rs:663-686`）：

```rust
// core/src/tools/spec_plan.rs:663-686
match shell_type_for_model_and_features(&turn_context.model_info, features) {
    ConfigShellToolType::UnifiedExec => {
        planned_tools.add(ExecCommandHandler::new(/* ... */));
        planned_tools.add(WriteStdinHandler);
        // Keep the legacy shell tool registered while unified exec is
        // model-visible.
        planned_tools.add_dispatch_only(ShellCommandHandler::new(shell_command_options));
    }
    ConfigShellToolType::Disabled => {}
    ConfigShellToolType::Default
    | ConfigShellToolType::Local
    | ConfigShellToolType::ShellCommand => {
        planned_tools.add(ShellCommandHandler::new(shell_command_options));
    }
}
```

注意 `add_dispatch_only`：unified_exec 模式下 `shell_command` 仍然注册但**不给模型看**，只保留内部可调用能力。

`ConfigShellToolType` 五个变体定义在 `protocol/src/openai_models.rs:278-284`（`Default` / `Local` / `UnifiedExec` / `Disabled` / `ShellCommand`），但 `tools/src/tool_config.rs:92-94` 会把 `Default` 和 `Local` 折叠成 `ShellCommand`，实际只有三种行为。

`models-manager/models.json` 中截至本 commit **所有 8 个模型条目都是 `"shell_type": "shell_command"`**（行 60、174、282、386、492、596、695、791），`unified_exec` 只能由 feature flag 打开（`tools/src/tool_config.rs:105-112`，还额外要求 `codex_utils_pty::conpty_supported()`）。

#### A.2 参数描述原文

`shell_command` 的描述极短，且**只讲一件事**——不要用 `cd`：

```rust
// core/src/tools/handlers/shell_spec.rs:208-211
r#"Runs a shell command and returns its output.
- Always set the `workdir` param when using the shell_command function. Do not use `cd` unless absolutely necessary."#
```

对比 OpenCode 那份上百行、列举了「别用 cat 用 read」的描述，Codex 这里是**极简派**。没有工具分工约束、没有 good/bad example、没有安全告示（Unix 侧）。

Windows 侧描述则明显长得多（`core/src/tools/handlers/shell_spec.rs:191-211`），列了 6 个 PowerShell 等价写法示例（`ls -a` → `Get-ChildItem -Force` 等），并追加 `windows_shell_guidance()`（`core/src/tools/handlers/shell_spec.rs:405-410`）三条安全规则：不跨 shell 组合删除命令、递归删除前先校验解析后的绝对路径、`Start-Process` 要加 `-WindowStyle Hidden`。

**这说明「描述长度」是模型/平台特定的补偿手段，不是通用最佳实践。** Unix 侧 shell 语义模型见得多，几乎不需要教；Windows 侧 PowerShell 语料少，就得手把手给例子。

#### A.3 参数默认值都写进了描述

```rust
// core/src/tools/handlers/shell_spec.rs:171-176
(
    "timeout_ms".to_string(),
    JsonSchema::number(Some(
        "Maximum command runtime. Defaults to 10000 ms.".to_string(),
    )),
),
```

`yield_time_ms` 的描述甚至写出了有效区间，且区间随平台变化（`core/src/tools/handlers/shell_spec.rs:26-30`）：

- 非 Windows：`"Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms."`
- Windows：`"... Effective range on Windows is 2000-30000 ms. Set a shorter value only when intentionally starting a long-lived or interactive process and you want a session ID promptly."`

这些数字与代码常量对齐：`MIN_YIELD_TIME_MS = 250`、`MAX_YIELD_TIME_MS = 30_000`、`WINDOWS_INITIAL_EXEC_YIELD_TIME_FLOOR_MS = 2_000`（`core/src/unified_exec/mod.rs:64-68`），实际 clamp 在 `core/src/unified_exec/mod.rs:180-187`。

#### A.4 `exec_command` 有 output_schema，`shell_command` 没有

```rust
// core/src/tools/handlers/shell_spec.rs:264-296（节选）
fn unified_exec_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "chunk_id": { "type": "string", ... },
            "wall_time_seconds": { "type": "number", ... },
            "exit_code": { "type": "number", "description": "Process exit code when the command finished during this call." },
            "session_id": { "type": "number", "description": "Session identifier to pass to write_stdin when the process is still running." },
            "original_token_count": { "type": "number", ... },
            "output": { "type": "string", "description": "Command output text, possibly truncated." }
        },
        "required": ["wall_time_seconds", "output"],
        "additionalProperties": false
    })
}
```

`shell_command` 则是 `output_schema: None`（`core/src/tools/handlers/shell_spec.rs:223`）。

关键点：**`exit_code` 与 `session_id` 是互斥语义**——命令在本次调用内结束就给 `exit_code`，还在跑就给 `session_id`。这个「二选一」通过描述文字表达（不是 schema 的 oneOf）。

#### A.5 参数结构体（Rust 侧）

`shell_command` 复用协议层的 `ShellCommandToolCallParams`（`protocol/src/models.rs:1801-1822`），注意 `timeout_ms` 带 `#[serde(alias = "timeout")]`——兼容旧模型输出的字段名。

`exec_command` 用 `ExecCommandArgs`（`core/src/tools/handlers/unified_exec.rs:27-48`），其中 `yield_time_ms` 有 serde 默认值 `10_000`（`core/src/tools/handlers/unified_exec.rs:60-62`），`tty` 默认 `false`（`core/src/tools/handlers/unified_exec.rs:68-70`）。`workdir` 与 `environment_id` 单独拆到 `ExecCommandEnvironmentArgs`（`core/src/tools/handlers/unified_exec.rs:50-58`），原因写在注释里：相对路径必须先选定 environment 再解析，不能用进程 cwd。

`write_stdin` 用 `WriteStdinArgs`（`core/src/tools/handlers/unified_exec/write_stdin.rs:20-29`），注释很有意思：

```rust
// core/src/tools/handlers/unified_exec/write_stdin.rs:20-22
struct WriteStdinArgs {
    // The model is trained on `session_id`.
    session_id: i32,
```

**「模型是按这个字段名训练的」——字段命名不是自由的，改名会掉性能。** 这是闭源模型 + 自家 CLI 才会写出的注释。

### B. 执行机制

#### B.1 `ExecParams` —— 执行请求的完整描述

```rust
// core/src/exec.rs:91-105
#[derive(Debug)]
pub struct ExecParams {
    pub command: Vec<String>,
    pub cwd: AbsolutePathBuf,
    pub expiration: ExecExpiration,
    pub capture_policy: ExecCapturePolicy,
    pub env: HashMap<String, String>,
    pub network: Option<NetworkProxy>,
    pub network_environment_id: Option<String>,
    pub sandbox_permissions: SandboxPermissions,
    pub windows_sandbox_level: codex_protocol::config_types::WindowsSandboxLevel,
    pub windows_sandbox_private_desktop: bool,
    pub justification: Option<String>,
    pub arg0: Option<String>,
}
```

注意 `command: Vec<String>`——**内部表示是 argv 数组，不是字符串**。模型传的是字符串（`command: String`），由 `derive_exec_args()` 包成 argv。

`capture_policy`（`core/src/exec.rs:107-115`）区分两类调用者：模型发起的 `ShellTool` 受输出上限与超时约束，内部可信 helper 用 `FullBuffer` 全量缓冲、不受限。**「同一执行内核，按调用者身份分级限制」是个干净的设计。**

#### B.2 用不用 shell：用，且沿用用户的 shell

```rust
// core/src/shell.rs:22-49
pub fn derive_exec_args(&self, command: &str, use_login_shell: bool) -> Vec<String> {
    match self.shell_type {
        ShellType::Zsh | ShellType::Bash | ShellType::Sh => {
            let arg = if use_login_shell { "-lc" } else { "-c" };
            vec![
                self.shell_path.to_string_lossy().to_string(),
                arg.to_string(),
                command.to_string(),
            ]
        }
        ShellType::PowerShell => {
            let mut args = vec![self.shell_path.to_string_lossy().to_string()];
            if !use_login_shell {
                args.push("-NoProfile".to_string());
            }
            args.push("-Command".to_string());
            args.push(command.to_string());
            args
        }
        ShellType::Cmd => { /* /c */ }
    }
}
```

四种 shell 类型，`login` 参数决定 `-lc` 还是 `-c`（PowerShell 侧对应「加不加 `-NoProfile`」）。**`login` 是模型可控参数**（`core/src/tools/handlers/shell_spec.rs:178-186`，仅在 `allow_login_shell` 开启时暴露）。

对比 OpenCode V2 直接钉死 `/bin/sh`：Codex 走了「跟随用户 shell」路线，代价是多 shell 分支 + 探测逻辑。

#### B.3 spawn：三件必做的事

```rust
// core/src/spawn.rs:86-105
#[cfg(unix)]
unsafe {
    let detach_from_tty = matches!(stdio_policy, StdioPolicy::RedirectForShellTool);
    #[cfg(target_os = "linux")]
    let parent_pid = libc::getpid();
    cmd.pre_exec(move || {
        if detach_from_tty {
            codex_utils_pty::process_group::detach_from_tty()?;
        }
        // This relies on prctl(2), so it only works on Linux.
        #[cfg(target_os = "linux")]
        {
            // This prctl call effectively requests, "deliver SIGTERM when my
            // current parent dies."
            codex_utils_pty::process_group::set_parent_death_signal(parent_pid)?;
        }
        Ok(())
    });
}
```

1. **`detach_from_tty()`** —— 新建 session/进程组，这样后面能整组 kill。
2. **`set_parent_death_signal()`** —— Linux 特有：agent 被 SIGKILL 时子进程也收 SIGTERM。这补上了「agent 被强杀留下孤儿进程」的漏洞（`core/src/spawn.rs:82-84` 的注释明说了动机）。
3. **`kill_on_drop(true)`**（`core/src/spawn.rs:125`）—— Tokio 层兜底。

#### B.4 stdin 一定要给 `null`，不能不管

```rust
// core/src/spawn.rs:107-116
match stdio_policy {
    StdioPolicy::RedirectForShellTool => {
        // Do not create a file descriptor for stdin because otherwise some
        // commands may hang forever waiting for input. For example, ripgrep has
        // a heuristic where it may try to read from stdin as explained here:
        // https://github.com/BurntSushi/ripgrep/blob/.../hiargs.rs#L1101-L1103
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    }
    StdioPolicy::Inherit => { /* 三个都 inherit */ }
}
```

`StdioPolicy` 定义在 `core/src/spawn.rs:28-31`（不是 `sandboxing/src/spawn.rs`，只有两个变体：`RedirectForShellTool` / `Inherit`）。

**这个注释是教学金句**：不给 stdin 会让 ripgrep 之类的工具永久挂起。zero2agent 的 terminal 工具必须显式 `stdin: 'ignore'`。

#### B.5 env：白名单 + 黑名单 + 覆盖，六步流水线

```rust
// protocol/src/shell_environment.rs:56-107（节选步骤注释）
// Step 1 - determine the starting set of variables based on the `inherit` strategy.
//   All / None / Core（Core 用 UNIX_CORE_ENV_VARS 或 WINDOWS_CORE_ENV_VARS 过滤）
// Step 2 - Apply the default exclude if not disabled.
let default_excludes = vec![
    EnvironmentVariablePattern::new_case_insensitive("*KEY*"),
    EnvironmentVariablePattern::new_case_insensitive("*SECRET*"),
    EnvironmentVariablePattern::new_case_insensitive("*TOKEN*"),
];
// Step 3 - Apply custom excludes.
// Step 4 - Apply user-provided overrides.（policy.set）
// Step 5 - If include_only is non-empty, keep only the matching vars.
// Step 6 - Populate the thread ID environment variable when provided.
```

**默认就把 `*KEY*` / `*SECRET*` / `*TOKEN*` 三类变量剔掉**——防止 API key 通过 `env` 泄漏给命令输出。这是 3 行代码换来的实质安全收益，很值得抄。

入口是 `core/src/exec_env.rs:25-31` 的 `create_env()`，薄封装转发到 `shell_environment::create_env`。

#### B.6 unified_exec 额外钉死 10 个环境变量

```rust
// core/src/unified_exec/process_manager.rs:73-84
const UNIFIED_EXEC_ENV: [(&str, &str); 10] = [
    ("NO_COLOR", "1"),
    ("TERM", "dumb"),
    ("LANG", "C.UTF-8"),
    ("LC_CTYPE", "C.UTF-8"),
    ("LC_ALL", "C.UTF-8"),
    ("COLORTERM", ""),
    ("PAGER", "cat"),
    ("GIT_PAGER", "cat"),
    ("GH_PAGER", "cat"),
    ("CODEX_CI", "1"),
];
```

三类意图，全部值得抄：

- **禁彩色**（`NO_COLOR` / `TERM=dumb` / `COLORTERM=""`）：ANSI 转义序列进模型上下文是纯浪费 token。
- **禁分页器**（`PAGER` / `GIT_PAGER` / `GH_PAGER` = `cat`）：`git log` 不设这个会挂在 `less` 里等按键。**这是 terminal 工具最经典的坑。**
- **声明非交互**（`CODEX_CI=1`）：让感知 CI 的工具自动走非交互分支。

注意这是 unified_exec（PTY 路径）专属常量。PTY 会让程序以为自己在终端里，所以更需要这层压制。

#### B.7 三种后端：本地 pipe、本地 PTY、远端 exec-server

`UnifiedExecProcess` 的 `ProcessHandle` 有 `Local` 与 `ExecServer` 两支（见 `core/src/unified_exec/process.rs:199-235` 的 match）。远端后端是 `codex-exec-server`：

> `codex-exec-server` is the library backing `codex exec-server`, a small JSON-RPC server for spawning and controlling subprocesses through `codex-utils-pty`.
> —— `exec-server/README.md:1-5`

支持 `ws://IP:PORT` 与 `--remote URL --environment-id ID`（`exec-server/README.md:22-30`），远端走 Noise 加密 relay。**这是「让 agent 在容器/远端机器上执行命令」的完整实现，与本文主题正交，不展开。**

### C. 返回契约

#### C.1 给模型的是一段纯文本，不是 JSON

```rust
// core/src/tools/mod.rs:76-103
/// Format the combined exec output for sending back to the model.
/// Includes exit code and duration metadata; truncates large bodies safely.
pub fn format_exec_output_for_model(
    exec_output: &ExecToolCallOutput,
    truncation_policy: TruncationPolicy,
) -> String {
    // round to 1 decimal place
    let duration_seconds = ((exec_output.duration.as_secs_f32()) * 10.0).round() / 10.0;
    let content = build_content_with_timeout(exec_output);
    let total_lines = content.lines().count();
    let formatted_output = truncate_text(&content, truncation_policy);

    let mut sections = Vec::new();
    sections.push(format!("Exit code: {}", exec_output.exit_code));
    sections.push(format!("Wall time: {duration_seconds} seconds"));
    if total_lines != formatted_output.lines().count() {
        sections.push(format!("Total output lines: {total_lines}"));
    }
    sections.push("Output:".to_string());
    sections.push(formatted_output);
    sections.join("\n")
}
```

实际形态：

```text
Exit code: 1
Wall time: 0.3 seconds
Total output lines: 428
Output:
<stdout+stderr 合流后的文本>
```

四个设计点：

1. **exit code 显式写在第一行**——与 OpenCode V2 的结论一致（V1 藏 metadata 是坑）。
2. **wall time 也给模型**——模型能据此判断「是不是该换个更快的做法」。
3. **`Total output lines` 只在被截断时才出现**（`core/src/tools/mod.rs:95-97`）。没截断就不占 token，截断了就明确告知原始规模。**条件性元数据，值得抄。**
4. **stdout / stderr 合流**（用 `aggregated_output`，`core/src/tools/mod.rs:121`），不分字段。

#### C.2 超时信息是「前置」而非「追加」

```rust
// core/src/tools/mod.rs:115-126
fn build_content_with_timeout(exec_output: &ExecToolCallOutput) -> String {
    if exec_output.timed_out {
        format!(
            "command timed out after {} milliseconds\n{}",
            exec_output.duration.as_millis(),
            exec_output.aggregated_output.text
        )
    } else {
        exec_output.aggregated_output.text.clone()
    }
}
```

**与 OpenCode 相反**：OpenCode 把超时提示**追加**在 output 之后（`shell.ts:582-584`），Codex 放在**最前面**。

Codex 的选择更稳：超时提示放前面，即使输出被截断（掐中间保头尾）提示也一定在。放后面的话，如果截断策略是「截尾」，提示就有被切掉的风险。**这是「截断策略」与「提示位置」的耦合，容易踩。**

另外注意超时提示**不带「重试建议」**——没有 OpenCode 那句 `retry with a larger timeout value`。**这是 Codex 的一个缺失点**，模型得自己想到调大 `timeout_ms`。

#### C.3 非零退出走「失败」通道，但内容照给

```rust
// core/src/tools/events.rs:370-383
Ok(output) => {
    let content = self.format_exec_output_for_model(&output, ctx);
    let exit_code = output.exit_code;
    let event = ToolEventStage::Success { output, applied_patch_delta };
    let result = if exit_code == 0 {
        Ok(content)
    } else {
        Err(FunctionCallError::RespondToModel(content))
    };
    (event, result)
}
```

关键在 `RespondToModel` 这个变体名：**「这是个错误，但错误内容要原样回给模型」**。超时（`core/src/tools/events.rs:385-390`）与沙箱拒绝（`core/src/tools/events.rs:391-392`）走同一条路。

对照 OpenCode 的「非零退出 = 普通回执」，Codex 是「非零退出 = 带内容的失败回执」。**两者对模型的最终效果一样（都看到完整输出），差别只在框架内部的事件语义**（`ToolEventStage::Success` vs `Failure` 影响 TUI 显示）。注意 `core/src/tools/events.rs:374-377`：即使 exit code 非零，事件阶段仍是 `Success`——**「进程正常跑完但返回非零」不算工具失败**，这个区分很干净。

#### C.4 `post_tool_use_response` —— 给 hook 的第二份输出

```rust
// core/src/tools/handlers/shell.rs:228-244
let post_tool_use_response = out
    .as_ref()
    .ok()
    .map(|output| {
        crate::tools::format_exec_output_str(output, turn.model_info.truncation_policy.into())
    })
    .map(JsonValue::String);
let content = emitter.finish(event_ctx, out, /*applied_patch_delta*/ None).await?;
Ok(FunctionToolOutput {
    body: vec![
        codex_protocol::models::FunctionCallOutputContentItem::InputText { text: content },
    ],
    success: Some(true),
    post_tool_use_response,
})
```

`format_exec_output_str`（`core/src/tools/mod.rs:105-113`）与 `format_exec_output_for_model` 的差别：**不加 `Exit code:` / `Wall time:` 前缀，只有截断后的裸内容**。前者给 hook / 内部消费者，后者给模型。**同一份输出，两种格式，按消费者区分。**

#### C.5 unified_exec 的返回结构不同

`exec_command` / `write_stdin` 返回 `ExecCommandToolOutput`，字段见 `core/src/tools/handlers/unified_exec/exec_command.rs:328-340`：`chunk_id`、`wall_time`、`raw_output`、`truncation_policy`、`max_output_tokens`、`process_id`、`exit_code`、`original_token_count`、`output_omitted_bytes`、`hook_command`。

它对齐 A.4 的 output_schema：`process_id`（即 schema 里的 `session_id`）和 `exit_code` 二选一。沙箱拒绝时特意把 `process_id` 置 `None`，注释说明了原因：

```rust
// core/src/tools/handlers/unified_exec/exec_command.rs:387-389
// Sandbox denial is terminal, so there is no live
// process for write_stdin to resume.
process_id: None,
```

**「失败后不要留一个模型以为还能用的 session id」** —— 回执一致性的细节。

### D. 输出量控制

#### D.1 策略是「掐中间、留头尾」

```rust
// utils/string/src/truncate.rs:126-129
fn split_budget(budget: usize) -> (usize, usize) {
    let left = budget / 2;
    (left, budget - left)
}
```

头尾各占一半预算，中间挖掉并插入 marker：

```rust
// utils/string/src/truncate.rs:131-137
fn format_truncation_marker(use_tokens: bool, removed_count: u64) -> String {
    if use_tokens {
        format!("…{removed_count} tokens truncated…")
    } else {
        format!("…{removed_count} chars truncated…")
    }
}
```

**这与 OpenCode 的「截尾（保留末尾）」是明确分歧。**

- OpenCode 理由：命令输出的关键信息（报错、汇总）在末尾。
- Codex 理由（推断，源码无注释）：头部有命令回显/上下文，尾部有结论，中间是重复的进度输出。

Codex 的做法更通用（同一个函数服务所有工具输出），OpenCode 的做法更贴 shell 场景。**教学时可以把这个分歧当作「没有唯一正确答案」的例子。**

marker 里带**被删掉的数量**（`…N tokens truncated…`），这点两家一致：截断必须告诉模型。

#### D.2 预算单位是 token，不是字节

```rust
// protocol/src/protocol.rs:3336-3339
pub enum TruncationPolicy {
    Bytes(usize),
    Tokens(usize),
}
```

两种模式可互转（`protocol/src/protocol.rs:3350-3368`），换算常量是 4：

```rust
// utils/string/src/truncate.rs:4
const APPROX_BYTES_PER_TOKEN: usize = 4;
```

```rust
// utils/string/src/truncate.rs:71-78
pub fn approx_token_count(text: &str) -> usize {
    let len = text.len();
    len.saturating_add(APPROX_BYTES_PER_TOKEN.saturating_sub(1)) / APPROX_BYTES_PER_TOKEN
}

pub fn approx_bytes_for_tokens(tokens: usize) -> usize {
    tokens.saturating_mul(APPROX_BYTES_PER_TOKEN)
}
```

**「4 字节 ≈ 1 token」的粗估，没有真 tokenizer。** 这是个很实用的简化：真跑 tokenizer 又慢又要引依赖，而截断本来就是模糊约束。zero2agent 可以直接抄这个常量。

策略来源是模型配置：`TruncationMode`（`protocol/src/openai_models.rs:305-308`）+ `TruncationPolicyConfig { mode, limit }`（`protocol/src/openai_models.rs:330-333`），每个模型条目可以单独设截断模式与上限——**不同上下文窗口的模型给不同预算**。

#### D.3 UTF-8 边界必须对齐

```rust
// utils/string/src/truncate.rs:98-101（节选）
for (idx, ch) in s.char_indices() {
    let char_end = idx + ch.len_utf8();
    if char_end <= beginning_bytes {
        prefix_end = char_end;
```

用 `char_indices()` 按字符边界推进，而不是直接切字节。**与 OpenCode 的 `while ((buf[start] & 0xc0) === 0x80) start++` 是同一个问题的两种解法**——中文场景必踩。Rust 这里更简洁是因为 `&str` 本身保证 UTF-8。

#### D.4 三道独立的上限，作用在不同层

| 层 | 常量 | 值 | 位置 | 作用 |
|----|------|-----|------|------|
| 进程读取层 | `EXEC_OUTPUT_MAX_BYTES` | 1 MiB（= `DEFAULT_OUTPUT_BYTES_CAP`，`utils/pty/src/lib.rs:12`） | `core/src/exec.rs:72-76` | 防 OOM，硬上限 |
| unified_exec 缓冲层 | `UNIFIED_EXEC_OUTPUT_MAX_BYTES` | 1 MiB | `core/src/unified_exec/mod.rs:71` | 单次 yield 保留字节 |
| 模型回执层 | `TruncationPolicy` | 按模型配置 | `protocol/src/protocol.rs:3336` | 进上下文的量 |

`core/src/exec.rs:72-76` 的注释写明了第一层的动机：

```rust
/// Hard cap on bytes retained from exec stdout/stderr/aggregated output.
///
/// This mirrors unified exec's output cap so a single runaway command cannot
/// OOM the process by dumping huge amounts of data to stdout/stderr.
const EXEC_OUTPUT_MAX_BYTES: usize = DEFAULT_OUTPUT_BYTES_CAP;
```

**「防 OOM」和「省 token」是两件事，需要两道上限。** 只做后者的话，`cat /dev/urandom` 能在截断之前先把 agent 撑爆。这是 OpenCode 用「落盘 + 滚动窗口」解决的同一个问题，Codex 用「硬上限 + 掐中间」解决，明显更轻。

#### D.5 unified_exec 的 HeadTailBuffer —— 流式的掐中间

```rust
// core/src/unified_exec/head_tail_buffer.rs:20-24
impl Default for HeadTailBuffer {
    fn default() -> Self {
        Self::new(UNIFIED_EXEC_OUTPUT_MAX_BYTES)
    }
}
```

```rust
// core/src/unified_exec/head_tail_buffer.rs:27-40（节选）
/// Create a new buffer that retains at most `max_bytes` of output.
///
/// The retained output is split across a prefix ("head") and suffix ("tail")
/// budget, dropping bytes from the middle once the limit is exceeded.
pub(crate) fn new(max_bytes: usize) -> Self {
    let head_budget = max_bytes / 2;
    let tail_budget = max_bytes.saturating_sub(head_budget);
```

与 D.1 的 `truncate_middle` 同思路，但这个是**边流边丢**的版本（`push_chunk`，`core/src/unified_exec/head_tail_buffer.rs:68`），不需要先攒完整输出。omitted 字节数单独记账（`core/src/unified_exec/head_tail_buffer.rs:54-55`），最后拼 marker：

```rust
// core/src/unified_exec/mod.rs:193-195
pub(crate) fn format_output_omission_marker(omitted_bytes: usize) -> String {
    format!("... {omitted_bytes} bytes omitted ...")
}
```

#### D.6 事件流也有独立上限

```rust
// core/src/exec.rs:78-80
/// Limit the number of ExecCommandOutputDelta events emitted per exec call.
/// Aggregation still collects full output; only the live event stream is capped.
pub(crate) const MAX_EXEC_OUTPUT_DELTAS_PER_CALL: usize = 10_000;
```

**「聚合照收全量，只限制实时推送的事件数」** —— 分清「给 UI 看的流」和「给模型看的结果」，两者上限不同。zero2agent 目前没有流式 UI，可以不做。

### E. 超时

#### E.1 默认 10 秒

```rust
// core/src/exec.rs:58
pub const DEFAULT_EXEC_COMMAND_TIMEOUT_MS: u64 = 10_000;
```

**比 OpenCode 的 2 分钟激进 12 倍。** 合理性来自 unified_exec 的存在：长任务不该走一次性执行，该走 PTY 会话（见 G 节）。但对只做 `shell_command` 的实现来说，10 秒会让 `npm install`、`cargo build` 大批超时。

**zero2agent 若只做一次性执行，应取 OpenCode 的 2 分钟而非 Codex 的 10 秒。**

#### E.2 超时不是唯一的「结束条件」

```rust
// core/src/exec.rs:144-152
pub enum ExecExpiration {
    Timeout(Duration),
    DefaultTimeout,
    Cancellation(CancellationToken),
    TimeoutOrCancellation {
        timeout: Duration,
        cancellation: CancellationToken,
    },
}
```

外加结果枚举（`core/src/exec.rs:156-161`）区分 `TimedOut` / `Cancelled`。`Option<u64>` → `ExecExpiration` 的 `From` 实现（`core/src/exec.rs:163-169`）把「模型没传 timeout」映射到 `DefaultTimeout`。

**「超时」和「用户中断」是两条独立路径，善后动作不同**（见 E.3）。

#### E.3 三方竞速 + 分级 kill

```rust
// core/src/exec.rs:1018-1032
let (exit_status, timed_out) = tokio::select! {
    status_result = child.wait() => {
        let exit_status = status_result?;
        (exit_status, false)
    }
    outcome = &mut expiration_wait => {
        match outcome {
            Some(ExecExpirationOutcome::TimedOut) => {
                kill_child_process_group(&mut child)?;
                child.start_kill()?;
                (synthetic_exit_status(EXIT_CODE_SIGNAL_BASE + TIMEOUT_CODE), true)
            }
```

三路竞速：进程自然退出 / expiration 触发 / `ctrl_c`（`core/src/exec.rs:1068-1072`）。三路都调 `kill_child_process_group`——**杀组不杀进程**，与 OpenCode 结论一致。

超时与取消的善后**明确不同**：

```rust
// core/src/exec.rs:1033-1063
Some(ExecExpirationOutcome::Cancelled) => {
    // Let TERM-aware processes run cleanup briefly, then kill any
    // remaining members of the original process group.
    let process_group_id = child.id();
    let should_escalate = if let Some(process_group_id) = process_group_id {
        codex_utils_pty::process_group::terminate_process_group(process_group_id)?  // SIGTERM
    } else { false };
    match tokio::time::timeout(CANCELLATION_TERMINATION_GRACE_PERIOD, child.wait()).await {
        Ok(status) => { /* 正常退出后补一发 kill 清理残余 */ }
        Err(_) => {
            kill_child_process_group(&mut child)?;  // SIGKILL
            child.start_kill()?;
        }
    }
    (synthetic_exit_status_for_code(/*code*/ 1), false)
}
```

- **取消** → SIGTERM（`terminate_process_group`，`utils/pty/src/process_group.rs:141-143`）→ 等 50 ms（`CANCELLATION_TERMINATION_GRACE_PERIOD`，`core/src/exec.rs:66`）→ SIGKILL。给进程清理机会。
- **超时** → 直接 SIGKILL（`kill_process_group_by_pid` 里是 `libc::killpg(pgid, libc::SIGKILL)`，`utils/pty/src/process_group.rs:103`）。不留情。

**这个区分很讲究**：用户主动 Ctrl-C 时希望 `git` 之类的工具能清理锁文件；命令超时说明它已经失控，没必要客气。OpenCode 是统一的 `forceKillAfter: 3s`。

#### E.4 I/O 排空超时 —— 最容易漏的坑

```rust
// core/src/exec.rs:82-89
// Wait for the stdout/stderr collection tasks but guard against them
// hanging forever. In the normal case, both pipes are closed once the child
// terminates so the tasks exit quickly. However, if the child process
// spawned grandchildren that inherited its stdout/stderr file descriptors
// those pipes may stay open after we `kill` the direct child on timeout.
// That would cause the `read_capped` tasks to block on `read()`
// indefinitely, effectively hanging the whole agent.
pub const IO_DRAIN_TIMEOUT_MS: u64 = 2_000; // 2 s should be plenty for local pipes
```

落地在 `await_output()`（`core/src/exec.rs:1078-1096`）：超时就 `handle.abort()` 并返回空输出，绝不阻塞。

```rust
// core/src/exec.rs:1087-1094
Err(_elapsed) => {
    // Timeout: abort the task to avoid hanging on open pipes.
    handle.abort();
    Ok(StreamOutput { text: Vec::new(), truncated_after_lines: None })
}
```

**这是本次调研最有价值的单点发现。** 场景：命令起了个后台孙进程（`nohup foo &`），孙进程继承了 stdout fd。杀掉直接子进程后管道**仍然开着**，读取任务永久阻塞 → 整个 agent 挂死。杀进程组能缓解但不能根治（孙进程可能自己换了进程组）。**必须在读取侧也加超时。**

zero2agent 用 Node.js 的话，`child.stdout` 的 `'end'` 事件同样可能不触发，需要同样的兜底。

#### E.5 超时的 exit code 语义

```rust
// core/src/exec.rs:62-65
const SIGKILL_CODE: i32 = 9;
const TIMEOUT_CODE: i32 = 64;
const EXIT_CODE_SIGNAL_BASE: i32 = 128; // conventional shell: 128 + signal
const EXEC_TIMEOUT_EXIT_CODE: i32 = 124; // conventional timeout exit code
```

内部先合成 `128 + 64 = 192` 当信号标记（`core/src/exec.rs:1029`），再在上层识别并**转换成约定的 124**：

```rust
// core/src/exec.rs:789-803
#[cfg(target_family = "unix")]
{
    if let Some(signal) = raw_output.exit_status.signal() {
        if signal == TIMEOUT_CODE {
            timed_out = true;
        } else {
            return Err(CodexErr::Sandbox(SandboxErr::Signal(signal)));
        }
    }
}

let mut exit_code = raw_output.exit_status.code().unwrap_or(-1);
if timed_out {
    exit_code = EXEC_TIMEOUT_EXIT_CODE;  // 124
}
```

124 是 GNU `timeout(1)` 的约定值——**模型见过这个数字，不用解释**。这比返回 `-1` 或自定义数字友好得多。

注意 `core/src/exec.rs:795`：**非超时的信号退出直接变成 `SandboxErr::Signal` 错误**，不走正常回执。

#### E.6 超时后输出照给

```rust
// core/src/exec.rs:817-821
if timed_out {
    return Err(CodexErr::Sandbox(SandboxErr::Timeout {
        output: Box::new(exec_output),
    }));
}
```

错误变体里**带着完整的 `ExecToolCallOutput`**，上层 `core/src/tools/events.rs:385-390` 再格式化给模型。与 OpenCode 的「超时不丢已有输出」结论一致。

### F. 安全边界

这是 Codex 最重的部分。四层结构：

```text
模型发起命令
   ↓
① execpolicy 策略引擎（Starlark DSL）→ allow / prompt / forbidden
   ↓（prompt 则询问用户）
② 命令安全启发式（is_known_safe_command / dangerous_command_match）
   ↓
③ 平台沙箱（seatbelt / seccomp+landlock / Windows restricted token）
   ↓（沙箱拒绝）
④ orchestrator 重试升级（再审批 → 无沙箱重跑）
```

#### F.1 审批策略四态

```rust
// protocol/src/protocol.rs:918-942
pub enum AskForApproval {
    /// Under this policy, only "known safe" commands—as determined by
    /// `is_safe_command()`—that **only read files** are auto‑approved.
    /// Everything else will ask the user to approve.
    UnlessTrusted,

    /// The model decides when to ask the user for approval.
    #[default]
    OnRequest,

    /// Fine-grained controls for individual approval flows.
    Granular(GranularApprovalConfig),

    /// Never ask the user to approve commands. Failures are immediately returned
    /// to the model, and never escalated to the user for approval.
    Never,
}
```

`Granular` 展开成 5 个独立开关（`protocol/src/protocol.rs:944-959`）：`sandbox_approval`、`rules`（execpolicy prompt 规则）、`skill_approval`、`request_permissions`、`mcp_elicitations`。**「审批」不是一个开关而是一族开关**，因为触发来源不同。

默认是 `OnRequest`——**模型自己决定要不要申请提权**。这与「框架判定危险再拦」是相反的哲学：信任模型的判断，把 `sandbox_permissions: RequireEscalated` 做成模型可传的参数（`protocol/src/models.rs:36-45`）：

```rust
// protocol/src/models.rs:36-45
pub enum SandboxPermissions {
    /// Run with the turn's configured sandbox policy unchanged.
    #[default]
    UseDefault,
    /// Request to run outside the sandbox.
    RequireEscalated,
    /// Request to stay in the sandbox while widening permissions for this
    /// command only.
    WithAdditionalPermissions,
}
```

第三个变体值得注意：**「留在沙箱里但为这条命令放宽权限」** —— 比「整个跳出沙箱」细粒度得多。

#### F.2 execpolicy —— 用 Starlark 写策略

策略语言是 Starlark（Python 子集），核心是一个内置函数：

```starlark
# execpolicy/README.md:16-24
prefix_rule(
    pattern = ["cmd", ["alt1", "alt2"]], # ordered tokens; list entries denote alternatives
    decision = "prompt",                 # allow | prompt | forbidden; defaults to allow
    justification = "explain why this rule exists",
    match = [["cmd", "alt1"], "cmd alt2"],           # examples that must match this rule
    not_match = [["cmd", "oops"], "cmd alt3"],       # examples that must not match this rule
)
```

三个设计点：

1. **`match` / `not_match` 是加载时校验的单元测试**（`execpolicy/README.md:9`："examples that are validated at load time (think of them as unit tests)"）。规则写错了在加载时就炸，不是运行时才发现。校验函数是 `validate_match_examples` / `validate_not_match_examples`（`execpolicy/src/parser.rs:35-36` 引入）。
2. **`justification` 会出现在审批提示里**（`execpolicy/README.md:8`），`forbidden` 时还要求写替代方案。**「拒绝的时候告诉模型该用什么」** —— 回执信息量原则的直接落地。
3. **`decision` 默认 `allow`**，三态定义在 `execpolicy/src/decision.rs:9-16`，且每个变体都写了语义：

```rust
// execpolicy/src/decision.rs:9-16
pub enum Decision {
    /// Command may run without further approval.
    Allow,
    /// Request explicit user approval; rejected outright when running with `approval_policy="never"`.
    Prompt,
    /// Command is blocked without further consideration.
    Forbidden,
}
```

注意 `Prompt` 的注释：**`approval_policy="never"` 下 prompt 等于直接拒绝**，不是「静默放行」。这个默认方向是对的——降级要往安全侧降。

Starlark 解析用的方言配置：

```rust
// execpolicy/src/parser.rs:57-67
pub fn parse(&mut self, policy_identifier: &str, policy_file_contents: &str) -> Result<()> {
    let pending_validation_count = self.builder.borrow().pending_example_validations.len();
    let mut dialect = Dialect::Extended.clone();
    dialect.enable_f_strings = true;
    let ast = AstModule::parse(policy_identifier, policy_file_contents.to_string(), &dialect)
        .map_err(Error::Starlark)?;
    let globals = GlobalsBuilder::standard().with(policy_builtins).build();
```

内置函数注册在 `#[starlark_module] fn policy_builtins`（`execpolicy/src/parser.rs:347-348`），`prefix_rule` 签名见 `execpolicy/src/parser.rs:349-356`。

还有个 `host_executable()` 内置（`execpolicy/README.md:29-37`）解决一个真实问题：**`/usr/bin/git status` 要不要匹配 `git` 开头的规则？** 匹配语义说明在 `execpolicy/README.md:39-44`——默认先试完整路径精确匹配，开启 `--resolve-host-executables` 才回退到 basename；若声明了 `host_executable(name="git", paths=[...])`，则只有列出的绝对路径允许回退。

**这是「命令名可以被伪造」这类攻击的正面处理**，教学项目不必做，但值得知道问题存在。

#### F.3 规则可以在审批时被追加持久化

用户点「以后都允许」时，追加一条规则到策略文件：

```rust
// execpolicy/src/amend.rs:65-81
pub fn blocking_append_allow_prefix_rule(
    policy_path: &Path,
    prefix: &[String],
) -> Result<(), AmendError> {
    if prefix.is_empty() {
        return Err(AmendError::EmptyPrefix);
    }
    let tokens = prefix
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|source| AmendError::SerializePrefix { source })?;
    let pattern = format!("[{}]", tokens.join(", "));
    let rule = format!(r#"prefix_rule(pattern={pattern}, decision="allow")"#);
    append_rule_line(policy_path, &rule)
}
```

即**把 Starlark 源码文本拼出来 append 到文件末尾**。注意函数上方的注释：

```rust
// execpolicy/src/amend.rs:63-64
/// Note this thread uses advisory file locking and performs blocking I/O, so it should be used with
/// [`tokio::task::spawn_blocking`] when called from an async context.
```

用 advisory file locking 防并发写坏（`AmendError::LockPolicyFile`，`execpolicy/src/amend.rs:41-45`）。这个能力对应 `ReviewDecision::ApprovedExecpolicyAmendment`：

```rust
// protocol/src/protocol.rs:4088-4113（节选）
pub enum ReviewDecision {
    Approved,
    /// User has approved this command and wants to apply the proposed execpolicy
    /// amendment so future matching commands are permitted.
    ApprovedExecpolicyAmendment { proposed_execpolicy_amendment: ExecPolicyAmendment },
    /// User has approved this request and wants future prompts in the same
    /// session-scoped approval cache to be automatically approved for the
    /// remainder of the session.
    ApprovedForSession,
    /// User chose to persist a network policy rule (allow/deny) for future
    /// requests to the same host.
    NetworkPolicyAmendment { network_policy_amendment: NetworkPolicyAmendment },
    Denied { rejection: String },
    /// Automatic approval review timed out before reaching a decision.
    TimedOut,
    /// User has denied this command and the agent should not do anything until
    /// the user's next command.
    Abort,
}
```

**审批不是二元的 yes/no，而是八种粒度**：本次允许 / 追加持久规则 / 本 session 允许 / 网络规则 / 拒绝但继续 / 自动审批超时 / 拒绝并停下（`Abort`）。这个枚举本身就是很好的教学素材——它把「用户点了什么按钮」的全部语义列清了。

另外 `Default` 实现是 `Denied`（`protocol/src/protocol.rs:4121-4126`）——**默认拒绝**，不是默认允许。安全默认值的正确方向。

#### F.4 命令安全启发式 —— 白名单极短，且逐命令抠选项

`is_known_safe_command()` 是 `UnlessTrusted` 策略下自动放行的判据：

```rust
// shell-command/src/command_safety/is_safe_command.rs:12-50（节选）
pub fn is_known_safe_command(command: &[String]) -> bool {
    let command: Vec<String> = command.iter()
        .map(|s| if s == "zsh" { "bash".to_string() } else { s.clone() })
        .collect();
    if is_safe_to_call_with_exec(&command) { return true; }

    // Support `bash -lc "..."` where the script consists solely of one or
    // more "plain" commands (only bare words / quoted strings) combined with
    // a conservative allow‑list of shell operators that themselves do not
    // introduce side effects ( "&&", "||", ";", and "|" ). If every
    // individual command in the script is itself a known‑safe command, then
    // the composite expression is considered safe.
    if let Some(all_commands) = parse_shell_lc_plain_commands(&command)
        && !all_commands.is_empty()
        && all_commands.iter().all(|cmd| is_safe_to_call_with_exec(cmd))
    { return true; }
    false
}
```

**「组合命令的安全性 = 每个子命令都安全 且 只用了无副作用的连接符」** —— 递归判定，思路清晰。

白名单本身只有 23 个命令（`shell-command/src/command_safety/is_safe_command.rs:76-102`）：`cat`、`cd`、`cut`、`echo`、`expr`、`false`、`grep`、`head`、`id`、`ls`、`nl`、`paste`、`pwd`、`rev`、`seq`、`stat`、`tail`、`tr`、`true`、`uname`、`uniq`、`wc`、`which`、`whoami`（外加 Linux 专属的 `numfmt`、`tac`，`shell-command/src/command_safety/is_safe_command.rs:73`）。

**关键在于「看起来只读的命令也能写文件」，所以要逐个抠选项**：

```rust
// shell-command/src/command_safety/is_safe_command.rs:104-112
Some("base64") => {
    const UNSAFE_BASE64_OPTIONS: &[&str] = &["-o", "--output"];
    !command.iter().skip(1).any(|arg| {
        UNSAFE_BASE64_OPTIONS.contains(&arg.as_str())
            || arg.starts_with("--output=")
            || (arg.starts_with("-o") && arg != "-o")
    })
}
```

```rust
// shell-command/src/command_safety/is_safe_command.rs:114-131
Some("find") => {
    // Certain options to `find` can delete files, write to files, or
    // execute arbitrary commands, so we cannot auto-approve the
    // invocation of `find` in such cases.
    const UNSAFE_FIND_OPTIONS: &[&str] = &[
        // Options that can execute arbitrary commands.
        "-exec", "-execdir", "-ok", "-okdir",
        // Option that deletes matching files.
        "-delete",
        // Options that write pathnames to a file.
        "-fls", "-fprint", "-fprint0", "-fprintf",
    ];
    !command.iter().any(|arg| UNSAFE_FIND_OPTIONS.contains(&arg.as_str()))
}
```

`rg` 同理（`--pre` 能执行任意命令、`--hostname-bin`、`--search-zip` / `-z`，`shell-command/src/command_safety/is_safe_command.rs:134-154`）；`git` 单独走 `is_safe_git_command()`（`shell-command/src/command_safety/is_safe_command.rs:157`）。

**这是「白名单不是按命令名而是按命令名+选项组合」的实证。** `find -delete`、`rg --pre=sh`、`base64 -o` 全都是「名字听起来只读、实际能改系统」的例子。zero2agent 若做白名单，这三个具体案例是最好的教学材料。

#### F.5 危险命令识别 —— 递归穿透包装器

```rust
// shell-command/src/command_safety/is_dangerous_command.rs:9-16
pub enum DangerousCommandMatch {
    /// An `rm` invocation includes the force option.
    ForcedRm,
    /// Another dangerous-command rule matched.
    Other,
}

const MAX_DANGEROUS_COMMAND_WRAPPER_DEPTH: usize = 8;
```

核心是穿透四种包装：

```rust
// shell-command/src/command_safety/is_dangerous_command.rs:177-193
match cmd0.as_deref() {
    Some("rm") if rm_args_include_force_option(&command[1..]) => {
        Some(DangerousCommandMatch::ForcedRm)
    }
    // For sudo <cmd>, simply check <cmd>.
    Some("sudo") => dangerous_command_match_with_depth(&command[1..], wrapper_depth + 1),
    // Skip environment assignments before checking the command run by env.
    Some("env") => dangerous_command_match_for_env(command, wrapper_depth),
    // A trap action is shell source stored in the first operand.
    Some("trap") => dangerous_command_match_for_trap(command, wrapper_depth),
    _ => None,
}
```

四种绕过手法，全都被堵住：

| 绕过写法 | 处理 | 位置 |
|---------|------|------|
| `sudo rm -rf /` | 剥掉 `sudo` 再查 | `is_dangerous_command.rs:183` |
| `env FOO=1 rm -rf /` | 跳过环境赋值和 `-i`/`--` 再查 | `is_dangerous_command.rs:196-217` |
| `trap 'rm -rf /' EXIT` | 把 trap action 当 `sh -c` 脚本递归查 | `is_dangerous_command.rs:219-235` |
| `bash -c 'if x; then rm -rf /; fi'` | 解析脚本里所有字面命令（含控制流、命令替换）逐个查 | `is_dangerous_command.rs:35-43` |

且有递归深度上限 8（`is_dangerous_command.rs:16, 27-29`）防 `sudo sudo sudo ...` 炸栈。

`rm -f` 的检测细节：

```rust
// shell-command/src/command_safety/is_dangerous_command.rs:237-246
fn rm_args_include_force_option(args: &[String]) -> bool {
    args.iter()
        .take_while(|arg| arg.as_str() != "--")
        .any(|arg| {
            arg == "--force"
                || arg
                    .strip_prefix('-')
                    .is_some_and(|flags| !flags.starts_with('-') && flags.contains('f'))
        })
}
```

三个细节：`--` 之后不算选项、`-rf` 这种合并短选项要按字符查 `f`、`--force` 长选项单独判。**「解析 shell 命令行选项」本身就是个坑坑洼洼的活**，这 10 行代码浓缩了三个易错点。

**这一整节是「命令黑名单为什么很难做对」的最佳实证。** 教学结论应该是：**要么不做（靠沙箱），要么做好递归穿透**；半吊子的 `command.includes('rm -rf')` 只会给人虚假的安全感。

#### F.6 平台沙箱三选一

```rust
// sandboxing/src/manager.rs:35-40
pub enum SandboxType {
    None,
    MacosSeatbelt,
    LinuxSeccomp,
    WindowsRestrictedToken,
}
```

```rust
// sandboxing/src/manager.rs:60-74
pub fn get_platform_sandbox(windows_sandbox_enabled: bool) -> Option<SandboxType> {
    if cfg!(target_os = "macos") {
        Some(SandboxType::MacosSeatbelt)
    } else if cfg!(target_os = "linux") {
        Some(SandboxType::LinuxSeccomp)
    } else if cfg!(target_os = "windows") {
        if windows_sandbox_enabled { Some(SandboxType::WindowsRestrictedToken) } else { None }
    } else { None }
}
```

要不要沙箱的判定与「本机能不能提供沙箱」解耦：

```rust
// sandboxing/src/manager.rs:301-319
/// Returns whether the request needs a sandbox, independently of whether
/// this host can provide a concrete sandbox implementation.
pub fn should_sandbox(
    &self,
    file_system_policy: &FileSystemSandboxPolicy,
    network_policy: NetworkSandboxPolicy,
    pref: SandboxablePreference,
    has_managed_network_requirements: bool,
) -> bool {
    match pref {
        SandboxablePreference::Forbid => false,
        SandboxablePreference::Require => true,
        SandboxablePreference::Auto => should_require_platform_sandbox(
            file_system_policy, network_policy, has_managed_network_requirements,
        ),
    }
}
```

`SandboxablePreference` 三态见 `sandboxing/src/manager.rs:53-58`。`select_initial()`（`sandboxing/src/manager.rs:280-299`）把两者合起来：需要沙箱且平台支持则用平台沙箱，否则 `SandboxType::None`。**注意「平台不支持」是静默降级到无沙箱**（`sandboxing/src/manager.rs:294-295` 的 `unwrap_or(SandboxType::None)`），不是报错。

macOS 的 seatbelt 基础策略是 closed-by-default：

```scheme
; sandboxing/src/seatbelt_base_policy.sbpl:7-16
; start with closed-by-default
(deny default)

; child processes inherit the policy of their parent
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))

; process-info
(allow process-info* (target same-sandbox))
```

策略明确标注了灵感来源是 Chrome 的沙箱策略（`sandboxing/src/seatbelt_base_policy.sbpl:3-5`），并且有段注释解释了为什么比 Chrome 松：

```scheme
; sandboxing/src/seatbelt_base_policy.sbpl:43-44
; Chrome locks these CPU feature detection down a bit more tightly,
; but mostly for fingerprinting concerns which isn't an issue for codex.
```

**「威胁模型不同，防护强度就该不同」** —— 指纹识别对浏览器是问题，对 CLI 不是。这是安全工程里很重要的判断力，也说明「照抄别人的安全策略」需要先对齐威胁模型。

#### F.7 沙箱拒绝检测靠字符串匹配

```rust
// sandboxing/src/denial.rs:6-44（节选）
pub fn is_likely_sandbox_denied(
    sandbox_type: SandboxType,
    exec_output: &ExecToolCallOutput,
) -> bool {
    if sandbox_type == SandboxType::None || exec_output.exit_code == 0 {
        return false;
    }

    const SANDBOX_DENIED_KEYWORDS: [&str; 7] = [
        "operation not permitted",
        "permission denied",
        "read-only file system",
        "seccomp",
        "sandbox",
        "landlock",
        "failed to write file",
    ];
    // ... 在 stderr / stdout / aggregated_output 三处小写后 contains
    if has_sandbox_keyword { return true; }

    const QUICK_REJECT_EXIT_CODES: [i32; 3] = [2, 126, 127];
    if QUICK_REJECT_EXIT_CODES.contains(&exec_output.exit_code) {
        return false;
    }
    ...
}
```

函数名就叫 `is_likely_sandbox_denied` —— **「大概是」，作者自己承认这是启发式**。

三层判据：关键词匹配（7 个词）→ 快速否决码（2 用法错误 / 126 不可执行 / 127 命令不存在，这些明显不是沙箱问题）→ Linux 下 `128 + SIGSYS` 精确判定（`sandboxing/src/denial.rs:46-54`）。

**只有 seccomp 那条是可靠信号，其余全靠猜。** 这是操作系统层面的信息缺失：沙箱拒绝往往就表现为普通的 `EPERM`，无法与「文件真的没权限」区分。教学价值：**不是所有判定都能做到精确，工程上要接受启发式并给它兜底路径**（这里的兜底就是 F.8 的重试升级）。

#### F.8 沙箱拒绝后的重试升级流程

模块顶部注释把流程说清了：

```rust
// core/src/tools/orchestrator.rs:1-8
/*
Module: orchestrator

Central place for approvals + sandbox selection + retry semantics. Drives a
simple sequence for any ToolRuntime: approval → select sandbox → attempt →
retry with an escalated sandbox strategy on denial (no re‑approval thanks to
caching).
*/
```

第一次尝试失败且是沙箱拒绝时（`core/src/tools/orchestrator.rs:301-304`），要连过**四道闸**才能重试，任何一道不过就直接把拒绝返回给模型：

| 闸 | 条件 | 位置 |
|----|------|------|
| 1 | 网络策略拒绝但拿不到审批上下文 → 不重试 | `core/src/tools/orchestrator.rs:312-324` |
| 2 | 工具自身声明 `escalate_on_failure() == false` → 不重试 | `core/src/tools/orchestrator.rs:325-337` |
| 3 | 审批策略不接受「无沙箱审批」（`Never` / `OnRequest`）→ 不重试 | `core/src/tools/orchestrator.rs:343-367` |
| 4 | 配置本身不允许无沙箱执行 → 不重试 | `core/src/tools/orchestrator.rs:368-380` |

`shell` 与 `unified_exec` 两个 runtime 都返回 `escalate_on_failure() == true`（`core/src/tools/runtimes/shell.rs:121-123`、`core/src/tools/runtimes/unified_exec.rs:151-153`），trait 默认值也是 `true`（`core/src/tools/sandboxing.rs:371-373`）。

第 3 道闸的判定逻辑值得单看：

```rust
// core/src/tools/sandboxing.rs:351-358
fn wants_no_sandbox_approval(&self, policy: AskForApproval) -> bool {
    match policy {
        AskForApproval::UnlessTrusted => true,
        AskForApproval::Never => false,
        AskForApproval::OnRequest => false,
        AskForApproval::Granular(granular_config) => granular_config.sandbox_approval,
    }
}
```

**`OnRequest` 下不自动升级** —— 因为该策略的语义是「模型自己申请提权」，模型没申请就说明它认为不需要，框架不越权替它升级。

过闸后构造拒绝原因并再次审批：

```rust
// core/src/tools/orchestrator.rs:381-395
let retry_reason = if let Some(network_approval_context) = network_approval_context.as_ref() {
    format!("Network access to \"{}\" is blocked by policy.", network_approval_context.host)
} else {
    build_denial_reason_from_output(output.as_ref())
};

// Strict auto-review approval covers the sandboxed attempt only;
// retrying without the sandbox requires a fresh guardian review.
let bypass_retry_approval = !strict_auto_review
    && tool.should_bypass_approval(approval_policy, already_approved)
    && network_approval_context.is_none();
```

**注释里这句是关键安全性质**：自动审批（auto-review）只覆盖「带沙箱的那次尝试」，脱沙箱重跑必须重新过 guardian 审查。**「审批的授权范围要绑定执行条件」** —— 用户批准的是「在沙箱里跑这条命令」，不等于批准「不带沙箱跑这条命令」。这是很容易做错的地方。

顺带一个务实的小设计：非网络场景的拒绝原因其实是个固定字符串，参数都没用上：

```rust
// core/src/tools/orchestrator.rs:524-528
fn build_denial_reason_from_output(_output: &ExecToolCallOutput) -> String {
    // Keep approval reason terse and stable for UX/tests, but accept the
    // output so we can evolve heuristics later without touching call sites.
    "command failed; retry without sandbox?".to_string()
}
```

**「先把签名留好、实现写死，以后演进不用改调用点」** —— 接口先行的典型手法。

第二次尝试的 sandbox 选择（`core/src/tools/orchestrator.rs:422-439`）：`unsandboxed_allowed` 时才真的降到 `SandboxType::None`，否则仍然带沙箱重试。**「重试」不一定等于「脱沙箱」**。

#### F.9 shell-escalation —— 拦 exec 系统调用做逐命令决策

`codex-shell-escalation` 是另一条路：不在 agent 层判定，而是在**被执行的 shell 内部**拦截每个 `exec()` 调用。

```rust
// shell-escalation/src/unix/escalate_protocol.rs:11-14
pub const ESCALATE_SOCKET_ENV_VAR: &str = "CODEX_ESCALATE_SOCKET";

/// Patched shells use this to wrap exec() calls.
pub const EXEC_WRAPPER_ENV_VAR: &str = "EXEC_WRAPPER";
```

被 patch 过的 zsh 通过 `EXEC_WRAPPER` 把每次 exec 请求经 Unix socket 发给 agent，agent 回三态决策：

```rust
// shell-escalation/src/unix/escalate_protocol.rs:37-52
pub enum EscalationDecision {
    Run,
    Escalate(EscalationExecution),
    Deny { reason: Option<String> },
}

pub enum EscalationExecution {
    /// Rerun the intercepted command outside any sandbox wrapper.
    Unsandboxed,
    /// Rerun using the turn's current sandbox configuration.
    TurnDefault,
    /// Rerun using an explicit sandbox configuration attached to the request.
    Permissions(EscalationPermissions),
}
```

请求里带 `file` / `argv` / `workdir`（`shell-escalation/src/unix/escalate_protocol.rs:18-26`），客户端侧对应动作是 `EscalateAction::{Run, Escalate, Deny}`（`shell-escalation/src/unix/escalate_protocol.rs:69-76`）。

**这解决的是「`bash -c 'a && b && c'` 里只有 `c` 需要提权」的问题**：前面的做法只能对整个命令串做一次决策，这个方案能做到逐个 exec 决策。代价是要维护 patch 过的 shell、一套 socket 协议、fd 转发（`SuperExecMessage { fds }`，`shell-escalation/src/unix/escalate_protocol.rs:79-82`）。

**这是本仓库最重的机制，也是最有想象力的一个。教学项目绝不该做，但值得知道「命令串粒度太粗」这个问题有解。**

### G. 特殊命令处理（后台 / 长任务 / 交互式）

#### G.1 核心范式：yield 而不是等待

`exec_command` 的描述一句话讲清了：

```rust
// core/src/tools/handlers/shell_spec.rs:99-100
"Runs a command in a PTY, returning output or a session ID for ongoing interaction."
```

到 `yield_time_ms` 还没跑完，就**返回已有输出 + `session_id`**，进程继续在后台活着。模型后续用 `write_stdin` 拿更多输出或写入。

**这个设计一举解决三个场景**，不需要三套机制：

| 场景 | 用法 |
|------|------|
| 长任务（`cargo build`） | `exec_command` 拿 session_id → 反复 `write_stdin(chars="")` 空轮询 |
| 交互式（`python` REPL、`ssh`） | `write_stdin(chars="print(1)\n")` |
| 后台常驻（`npm run dev`） | 拿到 session_id 后就不管，需要时再轮询 |

对比 OpenCode V2 把 background 列为 TODO 并列出「持久化状态 / 重启恢复 / owner-bound 的 get/wait/cancel 工具 / 完成投递」四项前置需求——Codex 的答案是：**别做「后台任务」抽象，做「会话」抽象**。会话天然带 id、天然能查、天然能写，不需要单独的 get/wait/cancel 三件套（cancel 用 `write_stdin` 发 Ctrl-C 即可，见 G.5）。

#### G.2 空 `chars` = 轮询，且轮询的超时区间不同

```rust
// core/src/tools/handlers/shell_spec.rs:121-126
(
    "chars".to_string(),
    JsonSchema::string(Some(
        "Bytes to write to stdin. Defaults to empty, which polls without writing.".to_string(),
    )),
),
```

```rust
// core/src/unified_exec/process_manager.rs:730-739
let yield_time_ms = {
    // Empty polls use configurable background timeout bounds. Non-empty
    // writes keep a fixed max cap so interactive stdin remains responsive.
    let time_ms = request.yield_time_ms.max(MIN_YIELD_TIME_MS);
    if request.input.is_empty() {
        time_ms.clamp(MIN_EMPTY_YIELD_TIME_MS, self.max_write_stdin_yield_time_ms)
    } else {
        time_ms.min(MAX_YIELD_TIME_MS)
    }
};
```

两套区间，注释解释了动机：

- **空轮询**：`5_000` ~ `300_000` ms（`MIN_EMPTY_YIELD_TIME_MS`、`DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS`，`core/src/unified_exec/mod.rs:67, 69`）。等长任务，可以等很久（5 分钟）。
- **写 stdin**：上限 `30_000` ms（`MAX_YIELD_TIME_MS`，`core/src/unified_exec/mod.rs:68`）。交互要保持响应性。

上限还可以配（`background_terminal_max_timeout`，`config/src/config_toml.rs:298`），构造时下限保护（`core/src/unified_exec/mod.rs:152-158`）。

**「同一个参数、同一个工具，语义随另一个参数变化」** —— 这是很实在的设计，避免了拆成两个工具。

#### G.3 输出收集是「有就返回，没有就等」

```rust
// core/src/unified_exec/process_manager.rs:1246-1263（节选）
let mut guard = output_buffer.lock().await;
drained_output = guard.drain();
has_drained_output =
    drained_output.retained_bytes() > 0 || drained_output.omitted_bytes() > 0;
if !has_drained_output {
    wait_for_output = Some(output_notify.notified());
}
// ...
if !has_drained_output {
    exit_signal_received |= cancellation_token.is_cancelled();
    if exit_signal_received && output_closed.load(Ordering::Acquire) {
        break;   // 进程退了且管道关了 → 立刻返回，不等 deadline
    }
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining == Duration::ZERO { break; }
```

关键性质：**进程提前结束就提前返回，不会白等满 `yield_time_ms`**。这需要同时确认两件事——进程已退出（cancellation_token）**且**输出管道已关闭（`output_closed`）。只看进程退出会丢掉最后一批输出。

进程退出后还给一小段窗口收尾：

```rust
// core/src/unified_exec/process_manager.rs:1229
const POST_EXIT_CLOSE_WAIT_CAP: Duration = Duration::from_millis(50);
```

进程退出后最多再等 50 ms 让管道关闭（`core/src/unified_exec/process_manager.rs:1265-1284`），超了就不等。**又是一个「兜底超时」** —— 与 E.4 的 I/O 排空同一个思路。

另有 `EARLY_EXIT_GRACE_PERIOD = 150 ms`（`core/src/unified_exec/process.rs:36`）处理「命令启动就秒退」的情形。

#### G.4 会话池：上限 64，LRU prune，但不硬赶活进程

```rust
// core/src/unified_exec/mod.rs:73
pub(crate) const MAX_UNIFIED_EXEC_PROCESSES: usize = 64;
```

```rust
// core/src/unified_exec/process_manager.rs:1346-1385（节选）
fn prune_processes_if_needed(store: &mut ProcessStore) -> Option<ProcessEntry> {
    if store.processes.len() < MAX_UNIFIED_EXEC_PROCESSES {
        return None;
    }

    let mut meta: Vec<(i32, Instant, bool)> = store.processes.iter()
        .map(|(id, entry)| (*id, entry.last_used, entry.process.has_exited()))
        .collect();
    let mut found_locked_exited_process = false;

    while let Some(process_id) = Self::process_id_to_prune_from_meta(&meta) {
        // ...
        if found_locked_exited_process && !candidate_has_exited {
            // The store may temporarily exceed its soft cap while an exited
            // process is publishing its terminal event. Do not evict a live
            // process just because that exited process is briefly locked.
            return None;
        }

        // Do not prune processes while write_stdin or terminal event
        // publication holds their interaction lock.
        if let Some(interaction_lock) = candidate_process.as_ref()
            .map(|process| process.interaction_lock())
            && let Ok(_interaction_guard) = interaction_lock.try_lock_owned()
        {
            return store.remove(process_id);
        }
```

三条不变式，都写在注释里：

1. 优先淘汰**已退出**的进程（`meta` 里带 `has_exited` 标记）。
2. **正被 `write_stdin` 使用的进程不能淘汰**（`try_lock_owned` 拿不到锁就跳过）。
3. **不能因为「某个已退出进程恰好被锁住」而误杀活进程** —— 宁可临时超过软上限。注释里明说 cap 是 "soft cap"。

**「资源上限是软的，正确性优先于上限」** —— 这个取舍很少见但很对。硬性 LRU 会在并发下杀掉模型正在交互的会话。

`ProcessEntry` 带 `last_used: tokio::time::Instant`（`core/src/unified_exec/mod.rs:177`）支撑 LRU。

#### G.5 中断：Ctrl-C 走 stdin，而不是单独的工具

```rust
// core/src/unified_exec/process_manager.rs:88
const INTERRUPT: &str = "\u{3}";
```

```rust
// core/src/unified_exec/process_manager.rs:700-712
if !request.input.is_empty() {
    if !tty {
        if request.input == INTERRUPT {
            process.interrupt().await?;
        } else {
            return Err(UnifiedExecError::StdinClosed);
        }
    } else {
        match process.write(request.input.as_bytes()).await {
            Ok(()) => {
                // Give the remote process a brief window to react so that we are
                // more likely to capture its output in the poll below.
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
```

两个要点：

1. **非 PTY 模式（`tty: false`）下 stdin 是关着的**，唯一接受的输入就是 `\x03`（Ctrl-C），转成 `interrupt()`（底层 `interrupt_process_group` 发 SIGINT，`utils/pty/src/process_group.rs:153-155`）。其他输入直接 `StdioClosed` 报错。**「不给 stdin，但留一个中断后门」** —— 既避开 B.4 的挂起问题，又保留了取消能力。
2. **写完 stdin 后主动 sleep 100 ms** 再去收输出。这是个务实的 hack：写完立刻读大概率读不到响应。注释写明了动机。

#### G.6 后台进程列表：有 API，但不给模型

```rust
// core/src/unified_exec/process_manager.rs:1437-1454
pub(crate) async fn list_processes(&self) -> Vec<BackgroundTerminalInfo> {
    let store = self.process_store.lock().await;
    let mut entries = store.processes.values()
        .filter(|entry| !entry.process.has_exited())
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.process_id);
    entries.into_iter()
        .map(|entry| BackgroundTerminalInfo {
            item_id: entry.call_id.clone(),
            process_id: entry.process_id.to_string(),
            command: entry.hook_command.clone(),
            cwd: entry.cwd.clone(),
        })
        .collect()
}
```

调用链：`Session::list_background_terminals()`（`core/src/tasks/mod.rs:855-857`）→ `CodexThread::list_background_terminals()`（`core/src/codex_thread.rs:442-444`）→ app-server 的 thread 请求处理器（`app-server/src/request_processors/thread_processor.rs:1890-1901`）。

**全程没有工具 spec 暴露给模型。** 这个列表是给客户端 UI 用的（让用户看到「有哪些后台终端在跑」）。模型只能记住自己拿到的 `session_id`。

配套的终止能力：`terminate_process(process_id)`（`core/src/unified_exec/process_manager.rs:1456-1466`）与 `terminate_all_processes()`（经 `close_unified_exec_processes()`，`core/src/tasks/mod.rs:848-853`），后者由 `Op::CleanBackgroundTerminals` 触发（`core/src/session/handlers.rs:65-67, 704-705`）。

**这是个重要的设计判断：「进程列表」是人的需求，不是模型的需求。** 模型是单线程推理的，它知道自己开了什么；给它一个 list 工具只会诱导它去 poll。zero2agent 若做后台执行，可以照这个思路——**列表给 UI，不给模型**。

#### G.7 `clock.sleep` —— 等待被做成了独立工具

```rust
// core/src/tools/handlers/sleep.rs:24-26
const NAMESPACE: &str = "clock";
const TOOL_NAME: &str = "sleep";
const MAX_SLEEP_DURATION_MS: u64 = 12 * 60 * 60 * 1000;
```

```rust
// core/src/tools/handlers/sleep.rs:49-50
description: "Pause execution for a specified duration. The sleep ends early when new input arrives for the active turn. Returns the elapsed wall-clock time."
```

三个点：

1. **上限 12 小时**（`core/src/tools/handlers/sleep.rs:26`）。
2. **有新输入时提前结束** —— 用户插话不用等睡完。
3. **返回实际经过的时间** —— 模型能知道自己是睡满了还是被打断了。

有了 `sleep` 工具，模型就不需要 `shell_command("sleep 30")`（那会占一个进程 + 撞超时）。**「把等待从 shell 里拿出来做成一等公民」**，这是个漂亮的解耦。zero2agent 若要支持轮询长任务，这个工具比想象中重要。

### H. 未找到答案的维度

以下几项在本次调研范围内**未找到源码证据**，如实记录：

| 维度 | 状态 | 已做的检索 |
|------|------|-----------|
| `default.rules` 的内容与分发方式 | **未找到** | 代码里只有路径构造：`default_policy_path() = codex_home/rules/default.rules`（`core/src/exec_policy.rs:52, 841-843`），加载走 `load_exec_policy()` 扫各 config layer 的 `rules/` 目录（`core/src/exec_policy.rs:635-660`）。仓库内 `find . -name '*.rules'` 无结果，`execpolicy/src` 与 `core/src/exec_policy.rs` 也没有 `include_str!` 内嵌默认策略。**推断**：该文件由用户/企业配置层提供或由 `prefix_rule_migration()`（`core/src/session/mod.rs:569-578`）在运行时生成，仓库不预置内容。 |
| 「重试时调大 timeout」的提示语 | **未找到** | `rg 'larger timeout\|increase the timeout'` 在 `*.rs` 内无命中。超时回执只有 `command timed out after N milliseconds`（`core/src/tools/mod.rs:115-126`），不含恢复建议。这是相对 OpenCode 的缺失点（见 C.2）。 |
| 输出超限落盘 | **未找到（即：不做）** | `rg 'NamedTempFile\|tempfile\|spill'` 在 `core/src/exec.rs` 与 `core/src/unified_exec/*.rs` 无命中。Codex 只做内存内「掐中间」（D.1、D.5），没有 OpenCode 那套落盘 + 引导 Grep 的机制。 |
| `background: true` 之类的参数 | **未找到（即：不做）** | `rg '"background"'` 在 `*.rs` 内无命中。后台执行完全由 `exec_command` 的会话语义承担（G.1），没有布尔开关。 |
| 工具描述里的「别用 cat / grep，用专用工具」约束 | **工具描述里未找到，在 system prompt 里找到一条** | `core/src/tools/handlers/shell_spec.rs` 全文只提到 `cd`（`:208-209`）。工具分工的引导写在 system prompt：`- When searching for text or files, prefer using \`rg\` or \`rg --files\` ...`（`core/gpt-5.2-codex_prompt.md:5`）。**位置不同，不是没有。** |

## 对 zero2agent 的启发

### 值得学的

| 点 | Codex 做法 | 为什么值得学 |
|----|-----------|-------------|
| **参数最小集 = command + workdir + timeout_ms** | `core/src/tools/handlers/shell_spec.rs:158-177` | 与 OpenCode 的三件套逐字一致。两个独立项目收敛到同一组参数，基本可以当定论用 |
| **默认值写进参数描述** | `"Maximum command runtime. Defaults to 10000 ms."`（`shell_spec.rs:171-176`） | 模型不传参数时才会用默认值，而它只能从描述里知道默认值是多少。一句话成本，避免模型盲传 |
| **exit code + wall time 显式放回执第一行** | `Exit code: N` / `Wall time: X seconds`（`core/src/tools/mod.rs:93-94`） | 与 OpenCode V2 结论一致。wall time 是 Codex 多给的一项，让模型能自己判断「这条路太慢，换写法」 |
| **`Total output lines` 只在截断时出现** | `core/src/tools/mod.rs:95-97` | 条件性元数据：没截断就不占 token，截断了就告知原始规模。这个技巧可以推广到所有工具回执 |
| **超时提示放在输出**前**面** | `core/src/tools/mod.rs:115-126` | 提示位置必须和截断策略配套：掐中间/截尾都可能吃掉尾部，放头部才保证一定送达 |
| **stdin 显式给 `null`** | `cmd.stdin(Stdio::null())` + ripgrep 挂起的注释（`core/src/spawn.rs:107-116`） | 不给 stdin 会让 `rg`、`git`、`ssh` 之类永久等输入。**一行代码，避免最难查的一类 bug** |
| **env 默认剔掉 `*KEY*` / `*SECRET*` / `*TOKEN*`** | `protocol/src/shell_environment.rs:56-107` | 3 行换来实质安全收益：防止 `env` 或报错信息把 API key 吐进模型上下文 |
| **钉死 `NO_COLOR` / `TERM=dumb` / `PAGER=cat`** | `core/src/unified_exec/process_manager.rs:73-84` | `git log` 不设 `GIT_PAGER=cat` 会挂在 `less` 里；ANSI 色码进上下文是纯浪费 token。**terminal 工具最经典的两个坑，10 行常量解决** |
| **杀进程组而非进程** | `kill_child_process_group`（`core/src/exec.rs:1026`、`utils/pty/src/process_group.rs:103`） | 与 OpenCode 结论一致。只杀 shell 会留孤儿 |
| **超时 vs 取消：kill 分级不同** | 取消 SIGTERM→50 ms→SIGKILL（`core/src/exec.rs:1033-1063`）；超时直接 SIGKILL（`core/src/exec.rs:1026-1027`） | 用户主动中断时给进程清理锁文件的机会；命令超时说明已失控，不必客气。**一个 if 分支体现的判断力** |
| **I/O 读取侧也要有超时** | `IO_DRAIN_TIMEOUT_MS = 2_000` + `handle.abort()`（`core/src/exec.rs:82-89, 1087-1094`） | **本次调研最有价值的单点发现。** 孙进程继承了 stdout fd 时，杀掉子进程后管道仍开着，读取会永久阻塞 → 整个 agent 挂死。杀进程组不能根治，必须在读取侧兜底 |
| **超时 exit code 用 124** | `EXEC_TIMEOUT_EXIT_CODE = 124`（`core/src/exec.rs:65, 800-803`） | GNU `timeout(1)` 的约定值，模型见过，不用解释。比 `-1` 或自定义数字友好 |
| **超时后已有输出照给** | `SandboxErr::Timeout { output }`（`core/src/exec.rs:817-821`） | 超时前的输出往往就是诊断依据。与 OpenCode 一致 |
| **两道上限分别防 OOM 和省 token** | `EXEC_OUTPUT_MAX_BYTES = 1 MiB`（`core/src/exec.rs:72-76`）+ `TruncationPolicy`（`protocol/src/protocol.rs:3336-3339`） | 只做后者的话，`cat /dev/urandom` 能在截断之前先撑爆 agent。**这是两个问题，需要两道闸** |
| **「4 字节 ≈ 1 token」粗估** | `APPROX_BYTES_PER_TOKEN = 4`（`utils/string/src/truncate.rs:4, 71-78`） | 截断本来就是模糊约束，跑真 tokenizer 又慢又要引依赖。这个常量可以直接抄 |
| **UTF-8 边界对齐** | `char_indices()` 逐字符推进（`utils/string/src/truncate.rs:98-101`） | 与 OpenCode 的 `& 0xc0 === 0x80` 是同一问题的两种解法。中文场景必踩 |
| **审批默认值是 Denied** | `ReviewDecision` 的 `Default` = `Denied`（`protocol/src/protocol.rs:4121-4126`） | 安全默认值的正确方向。同理 `Prompt` 在 `approval_policy="never"` 下等于拒绝而非放行（`execpolicy/src/decision.rs:9-16`） |
| **失败时不要留一个模型以为还能用的 session id** | 沙箱拒绝后 `process_id: None`（`core/src/tools/handlers/unified_exec/exec_command.rs:387-389`） | 回执一致性：给了 id 模型就会去用，用了就再失败一轮 |
| **后台进程列表给 UI，不给模型** | `list_processes()` 只经 `CodexThread::list_background_terminals()` 到 app-server（`core/src/unified_exec/process_manager.rs:1437-1454`、`core/src/codex_thread.rs:442-444`） | 「有哪些后台任务」是人的需求。给模型一个 list 工具只会诱导它 poll。**这条判断很反直觉但很对** |

### 太重、不必学

| 点 | Codex 的重量 | zero2agent 该怎么办 |
|----|-------------|-------------------|
| **两套终端工具并存 + 按模型装配** | `shell_command` 与 `exec_command`/`write_stdin` 三态装配（`core/src/tools/spec_plan.rs:663-686`），选择逻辑在 `tools/src/tool_config.rs:81-116` | **只做一套。** 双轨制是「有多代自家模型要兼容」的产物，教学项目没这个包袱 |
| **Starlark 策略引擎** | `execpolicy/` 整个 crate（`parser.rs` 含 starlark 方言配置、`prefix_rule` 内置函数、加载时 `match`/`not_match` 校验、`host_executable()` 路径解析） | **不做。** 这是「企业要下发可审计策略」的需求。但 `justification` 与「forbidden 时给替代方案」的思路可以借到普通错误消息里 |
| **规则追加持久化 + advisory file locking** | `blocking_append_allow_prefix_rule()` 拼 Starlark 文本 append（`execpolicy/src/amend.rs:65-81`） | **不做。** 需要策略文件格式 + 并发写保护 + 8 种审批语义（`ReviewDecision`，`protocol/src/protocol.rs:4088-4113`）配套 |
| **命令安全启发式白名单** | 23 个命令的白名单 + 逐命令抠危险选项（`find -delete`/`-exec`、`rg --pre`、`base64 -o`），`shell-command/src/command_safety/is_safe_command.rs:76-154` | **不做完整版，但要读一遍。** 这三个例子是「名字听起来只读、实际能改系统」的最佳教学材料 |
| **危险命令黑名单 + 递归穿透包装器** | `sudo` / `env` / `trap` / `bash -c` 四种绕过全堵，深度上限 8（`shell-command/src/command_safety/is_dangerous_command.rs:16, 177-193`） | **不做。** 教学结论应该是「要么靠沙箱，要么做好递归穿透」；`command.includes('rm -rf')` 只给虚假安全感 |
| **平台沙箱三选一** | seatbelt `.sbpl` 策略 + Linux seccomp/landlock + Windows restricted token（`sandboxing/src/manager.rs:35-40`、`sandboxing/src/seatbelt_base_policy.sbpl`） | **不做。** 每个平台一套原生 API，且「平台不支持就静默降级到无沙箱」（`sandboxing/src/manager.rs:294-295`）说明连 Codex 自己都没法保证覆盖 |
| **沙箱拒绝检测 + 重试升级** | `is_likely_sandbox_denied()` 7 个关键词启发式（`sandboxing/src/denial.rs:6-44`）+ orchestrator 四道闸（`core/src/tools/orchestrator.rs:312-380`） | **不做。** 没有沙箱就没有这条路。但「审批的授权范围要绑定执行条件」这个性质（`core/src/tools/orchestrator.rs:393-395` 的注释）值得记住 |
| **shell-escalation：拦 exec 系统调用** | patch 过的 zsh + Unix socket 协议 + fd 转发（`shell-escalation/src/unix/escalate_protocol.rs:11-82`） | **不做。** 但值得知道「`a && b && c` 只有 `c` 需要提权」这个问题有解 |
| **PTY 会话池 + LRU prune** | 上限 64、三条不变式的软上限 prune（`core/src/unified_exec/mod.rs:73`、`core/src/unified_exec/process_manager.rs:1346-1385`） | **S003 不做。** 若将来做后台执行，这套 prune 不变式（优先淘汰已退出的 / 正被使用的不能淘汰 / 宁可超上限也不误杀活进程）是现成的需求清单 |
| **远端 exec-server 后端** | `codex-exec-server` + Noise 加密 relay（`exec-server/README.md:1-30`） | **不做。** 与本主题正交 |
| **多 shell 支持（zsh/bash/sh/pwsh/cmd）** | `derive_exec_args()` 四分支（`core/src/shell.rs:22-49`）+ Windows 专属长描述与安全规则（`shell_spec.rs:191-211, 405-410`） | **不做。** 固定一个 shell。Windows 那段长描述反过来证明了「描述长度是平台/模型特定的补偿」，不是通用最佳实践 |

### 四个可以直接借走的「教学锚点」

1. **默认超时该取多少，取决于有没有会话机制。** Codex 是 10 秒（`core/src/exec.rs:58`），OpenCode 是 2 分钟。Codex 敢这么激进，是因为长任务本该走 `exec_command` 的 PTY 会话（G.1）。**zero2agent 只做一次性执行，就必须取 2 分钟量级，不能抄 10 秒。** 这是「一个常量的取值取决于系统里有没有另一个机制」的好例子。

2. **「截头还是截尾」两家分歧，说明它没有唯一答案。** Codex 掐中间保头尾（`utils/string/src/truncate.rs:126-137`），OpenCode 截尾保末尾（`shell.ts:225-261`）。Codex 那套服务所有工具输出所以要通用；OpenCode 专为 shell 优化所以赌「报错在末尾」。**教学时正好用来讲「设计取舍要看约束条件，不是背最佳实践」。**

3. **「杀进程组」还不够，读取侧也要超时。** 这是 Codex 独有、OpenCode 没有的发现（`core/src/exec.rs:82-89`）。孙进程可以自己换进程组，逃过 `killpg`，然后一直占着继承来的 stdout fd —— 这时 `read()` 永久阻塞，整个 agent 挂死。**「进程杀了 ≠ 管道关了」，这是终端工具最隐蔽的一个坑，值得单独一节。**

4. **「进程列表」是人的需求，不是模型的需求。** Codex 有完整的 `list_processes` / `terminate_process` 能力，但**一个都没暴露成工具**（G.6）。这条判断可以直接迁移到 S004 讨论后台执行时：**先问「这个能力是给谁的」，再决定要不要做成工具。**

## 关键源码引用

| 文件 | 行号 | 内容 |
|------|------|------|
| `core/src/tools/handlers/shell_spec.rs` | `157-225` | `shell_command` 工具 spec（参数 + 描述 + `output_schema: None`） |
| `core/src/tools/handlers/shell_spec.rs` | `21-111` | `exec_command` 工具 spec |
| `core/src/tools/handlers/shell_spec.rs` | `113-155` | `write_stdin` 工具 spec（含空 `chars` = 轮询的描述） |
| `core/src/tools/handlers/shell_spec.rs` | `264-296` | `unified_exec_output_schema()` —— `exit_code` / `session_id` 互斥语义 |
| `core/src/tools/handlers/shell_spec.rs` | `405-410` | `windows_shell_guidance()` 三条安全规则 |
| `core/src/tools/spec_plan.rs` | `663-686` | 两套终端工具的三态装配 |
| `core/src/exec.rs` | `58, 62-65` | 默认超时 10 s、`TIMEOUT_CODE` / `EXEC_TIMEOUT_EXIT_CODE = 124` |
| `core/src/exec.rs` | `72-80` | `EXEC_OUTPUT_MAX_BYTES`（防 OOM）、`MAX_EXEC_OUTPUT_DELTAS_PER_CALL` |
| `core/src/exec.rs` | `82-89` | `IO_DRAIN_TIMEOUT_MS` 及其注释（孙进程占管道导致 agent 挂死） |
| `core/src/exec.rs` | `144-169` | `ExecExpiration` —— 超时 / 取消 / 两者 |
| `core/src/exec.rs` | `1018-1072` | 三方竞速 + 超时直接 SIGKILL / 取消先 SIGTERM 后 SIGKILL |
| `core/src/exec.rs` | `1078-1096` | `await_output()` —— 读取侧超时后 `handle.abort()` |
| `core/src/exec.rs` | `789-821` | 信号 → 超时判定、exit code 归一化到 124、超时仍带完整 output |
| `core/src/spawn.rs` | `86-105` | `pre_exec`：detach tty + parent death signal |
| `core/src/spawn.rs` | `107-116` | `stdin(Stdio::null())` 及 ripgrep 挂起注释 |
| `core/src/shell.rs` | `22-49` | `derive_exec_args()` —— 四种 shell 的 `-c` / `-lc` |
| `protocol/src/shell_environment.rs` | `56-107` | env 六步流水线，默认剔除 `*KEY*` / `*SECRET*` / `*TOKEN*` |
| `core/src/unified_exec/process_manager.rs` | `73-84` | `UNIFIED_EXEC_ENV` —— 禁彩色 / 禁分页器 / 声明非交互 |
| `core/src/tools/mod.rs` | `76-103` | `format_exec_output_for_model()` —— 回执文本格式 |
| `core/src/tools/mod.rs` | `115-126` | `build_content_with_timeout()` —— 超时提示前置 |
| `core/src/tools/events.rs` | `370-392` | 非零退出 → `FunctionCallError::RespondToModel`，事件阶段仍是 `Success` |
| `core/src/tools/handlers/shell.rs` | `228-244` | `post_tool_use_response` —— 给 hook 的第二份（无前缀）输出 |
| `utils/string/src/truncate.rs` | `15-36, 126-137` | 掐中间保头尾 + 截断 marker 带删除量 |
| `utils/string/src/truncate.rs` | `4, 71-78` | `APPROX_BYTES_PER_TOKEN = 4` 与 token 粗估 |
| `utils/output-truncation/src/lib.rs` | `12-30` | 截断时前置 `Warning: truncated output (original token count: N)` |
| `protocol/src/protocol.rs` | `3336-3368` | `TruncationPolicy::{Bytes, Tokens}` 与互转 |
| `core/src/unified_exec/head_tail_buffer.rs` | `27-40, 54-55, 68` | 流式版「掐中间」+ omitted 字节记账 |
| `protocol/src/protocol.rs` | `918-959` | `AskForApproval` 四态 + `Granular` 五个开关 |
| `protocol/src/protocol.rs` | `4088-4126` | `ReviewDecision` 八种语义，`Default` = `Denied` |
| `protocol/src/models.rs` | `36-45` | `SandboxPermissions` 三态（含「留在沙箱但放宽本条命令」） |
| `execpolicy/README.md` | `8-44` | `prefix_rule` 语法、`match`/`not_match` 加载时校验、`host_executable()` |
| `execpolicy/src/decision.rs` | `9-16` | `Decision::{Allow, Prompt, Forbidden}` 及 `never` 下 prompt = 拒绝 |
| `execpolicy/src/amend.rs` | `63-81` | 追加 allow 规则（拼 Starlark 文本 + advisory locking） |
| `core/src/exec_policy.rs` | `52, 841-843` | `default.rules` 路径构造（文件实体未找到） |
| `shell-command/src/command_safety/is_safe_command.rs` | `12-50` | `is_known_safe_command()` —— 组合命令递归判定 |
| `shell-command/src/command_safety/is_safe_command.rs` | `76-154` | 23 命令白名单 + `base64 -o` / `find -delete` / `rg --pre` 选项抠除 |
| `shell-command/src/command_safety/is_dangerous_command.rs` | `16, 177-246` | 递归穿透 `sudo`/`env`/`trap`/`bash -c`，深度上限 8，`rm -f` 选项解析 |
| `sandboxing/src/manager.rs` | `35-74, 280-319` | `SandboxType` 四态、平台选择、`should_sandbox()` 与静默降级 |
| `sandboxing/src/seatbelt_base_policy.sbpl` | `3-16, 43-44` | closed-by-default 策略 + 「威胁模型不同所以比 Chrome 松」 |
| `sandboxing/src/denial.rs` | `6-54` | `is_likely_sandbox_denied()` —— 关键词 / 快速否决码 / SIGSYS |
| `core/src/tools/orchestrator.rs` | `1-8` | 模块注释：approval → select sandbox → attempt → escalated retry |
| `core/src/tools/orchestrator.rs` | `301-380` | 重试前的四道闸 |
| `core/src/tools/orchestrator.rs` | `381-395` | 「自动审批只覆盖带沙箱的那次尝试」 |
| `core/src/tools/orchestrator.rs` | `524-528` | `build_denial_reason_from_output()` —— 签名先行、实现写死 |
| `core/src/tools/sandboxing.rs` | `351-373` | `wants_no_sandbox_approval()`、`escalate_on_failure()` 默认 true |
| `shell-escalation/src/unix/escalate_protocol.rs` | `11-82` | 拦 exec 的 socket 协议与三态决策 |
| `core/src/unified_exec/mod.rs` | `64-73` | yield 时间上下限、输出上限、会话池上限 64 |
| `core/src/unified_exec/process_manager.rs` | `700-712` | Ctrl-C 走 stdin；写完 sleep 100 ms 再收输出 |
| `core/src/unified_exec/process_manager.rs` | `730-739` | 空轮询与写 stdin 两套超时区间 |
| `core/src/unified_exec/process_manager.rs` | `1229-1284` | 提前退出提前返回；`POST_EXIT_CLOSE_WAIT_CAP = 50 ms` |
| `core/src/unified_exec/process_manager.rs` | `1346-1385` | `prune_processes_if_needed()` —— 软上限的三条不变式 |
| `core/src/unified_exec/process_manager.rs` | `1437-1466` | `list_processes()` / `terminate_process()`（不暴露给模型） |
| `core/src/codex_thread.rs` | `442-444` | `list_background_terminals()` |
| `app-server/src/request_processors/thread_processor.rs` | `1890-1901` | 后台终端列表的客户端出口 |
| `core/src/tools/handlers/sleep.rs` | `24-26, 49-50` | `clock.sleep` 工具：12 小时上限、有新输入提前结束 |
| `core/gpt-5.2-codex_prompt.md` | `5` | 工具分工引导写在 system prompt（`prefer using rg`），不在工具描述里 |

## 参考资料

- [OpenCode 终端执行调研](./opencode.md)（参数三件套、截尾策略、V1/V2 对照的上游描述）
- [Aider 终端执行调研](./aider.md)
- [Codex write-file 调研](../write-file/codex.md)（`apply_patch`、审批链路的上游描述）
- `codex-rs/execpolicy/README.md`：策略 DSL 官方说明
- `codex-rs/exec-server/README.md`：远端执行后端说明
