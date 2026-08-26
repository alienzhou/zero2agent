# OpenCode — 终端执行（shell / 命令执行）调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| 调研 Commit | `743f6410f2e5002723fc5e893039ac49fbfe0de8` |
| Commit 日期 | `2026-07-23 18:04:46 +0000` |
| 调研日期 | `2026-08-26` |

## 调研目标

为 E02-S003（`terminal` 工具）提供竞品参考：OpenCode 的 shell 工具契约长什么样？用什么 API 执行、走哪个 shell？stdout / stderr / exit code 怎么呈现给模型？输出爆量和超时怎么兜底？安全边界靠什么（黑白名单？沙箱？权限确认？）？以及后台/交互式命令这类「特殊路径」它做到了什么程度。

> 本文所有结论均标注 `文件:行号`。凡源码中未找到实现的机制，明确写「未找到」而非用先验补齐；作者的解读一律显式标注为「推断」。
>
> **重要前提**：该 commit 的仓库里存在**两个并行的 shell 工具实现**（V1 与 V2 迁移中），本文以**当前实际接入 registry 的 V1 实现**为主线，V2 作为对照单列一节（见 §H）。

## 调研结论

1. **工具对模型暴露的名字是 `bash`，但源码里叫 shell——这是一次故意的「不改名」。** `packages/opencode/src/tool/shell/id.ts:16` 把 `ToolID` 硬编码为 `"bash"`，并在 `id.ts:14-15` 留了注释解释原因：`// Keep the exposed tool ID and permission key as "bash" for compatibility with existing plugins, users, and saved permissions. Rename with opencode 2.0.` 内部则已经抽象成四种 shell kind（`id.ts:1`：`["bash", "pwsh", "powershell", "cmd"]`）。

2. **参数只有三个：`command`（必填）、`timeout`（选填毫秒）、`workdir`（选填）。** 定义在 `packages/opencode/src/tool/shell/prompt.ts:15-23`。没有 `background`、没有 `stdin`、没有 `env`、没有 `shell` 选择参数。`workdir` 的参数描述直接写了行为约束：`Use this instead of 'cd' commands.`（`prompt.ts:19-21`）

3. **工具描述是运行时按 shell 种类动态渲染的，不是一个静态 `.txt`。** `shell.txt` 只是骨架模板（21 行，含 `${intro}` / `${commandSection}` 等占位符），`prompt.ts:273-293` 的 `render()` 按当前 shell（bash / pwsh / powershell / cmd）、当前平台、当前截断上限、当前默认超时值填空。**默认超时和截断阈值是写进描述文本里给模型看的**（`prompt.ts:97-98`）。

4. **走 shell，且 shell 是「用户默认 shell」而非硬编码 bash。** `shell.ts:601` 调 `Shell.acceptable(cfg.shell)`，解析顺序是「配置 `shell` 项 → `process.env.SHELL` → 平台兜底」（`packages/core/src/shell.ts:214-221`）。macOS 兜底是 `/bin/zsh`（`core/src/shell.ts:132-137`）。`fish` 和 `nu` 被显式标记 `deny: true`（`core/src/shell.ts:16,18`）从而在 `acceptable()` 下被跳过。

5. **exit code 不进模型可见的 output，只进 metadata；非零退出不是错误，而是普通回执。** `shell.ts:585-593` 返回体里 `exit` 挂在 `metadata` 上，而 `output` 字段只有命令输出本身。而序列化给模型时只取 `state.output`（`packages/opencode/src/session/message-v2.ts:292-295, 307-320`），metadata 不参与。**所以模型看不到 exit code**，只能从 stderr 文本推断成败。这与 V2 实现（会显式追加 `Command exited with code N.`）形成鲜明对比。

6. **stdout 和 stderr 合流成一条，不区分。** `shell.ts:487` 消费的是 `handle.all`，而 `handle.all` 定义为 `Stream.merge(stdout, stderr)`（`packages/core/src/cross-spawn-spawner.ts:264`）。测试 `packages/opencode/test/tool/shell.test.ts:1081-1093` 证实了 stdout 和 stderr 都出现在同一个 `result.output` 里。

7. **截断是「截尾保留末尾 + 全量落盘到文件 + 明确告知模型」的三段式。** 默认阈值 2000 行 / 50KB（`packages/opencode/src/tool/truncate.ts:15-16`），shell 工具用 `tail()`（`shell.ts:225-261`）**保留末尾**，超限时把完整输出写进 `~/.local/share/opencode/tool-output/` 并在 output 头部插入 `...output truncated...\n\nFull output saved to: ${file}`（`shell.ts:578-580`）。

8. **有超时，默认 2 分钟，模型可指定，超时后杀整个进程组并显式告知模型。** 默认值 `2 * 60 * 1000`（`shell.ts:347`），超时用 `Effect.raceAll` 竞速（`shell.ts:542-546`），触发后 `handle.kill({ forceKillAfter: "3 seconds" })`（`shell.ts:554`）→ 底层对进程组发 SIGTERM，3 秒后升级 SIGKILL（`cross-spawn-spawner.ts:427-437, 292-312`）。

9. **安全边界的核心不是黑白名单，而是「tree-sitter 解析命令 → 抽出路径参数 → 按路径是否逃出工作区决定要不要弹权限确认」。** 这是全篇最重的一块：加载 `tree-sitter-bash` 和 `tree-sitter-powershell` 两个 wasm（`shell.ts:311-336`），解析出所有 `command` 节点，对 `rm/cp/mv/mkdir/...` 等文件类命令（`shell.ts:29-50`）逐个解析路径参数，逃出 worktree 的升级为 `external_directory` 权限询问（`shell.ts:263-291`）。**同时每条命令本身也都会走一次 `bash` 权限询问**（`shell.ts:283-290`），默认动作是 `ask`（`packages/opencode/src/permission/index.ts:28-38`）。

10. **`stdin` 一律 `"ignore"`——交互式命令在 OpenCode 的 shell 工具里根本没有输入通道。** `shell.ts:298, 307` 两个分支都写死 `stdin: "ignore"`。超时提示语里还专门提了这点：`If this command is expected to take longer and is not waiting for interactive input, ...`（`shell.ts:564`）。**后台执行：模型侧未找到任何入口**（详见 §G）。

## 详细分析

### A. 工具契约

**工具 ID**：`bash`（`packages/opencode/src/tool/shell/id.ts:16`）。源码文件、Effect span 名、内部类型都叫 shell，只有对外 ID 保留 `bash`：

```typescript
// packages/opencode/src/tool/shell/id.ts:14-17
// Keep the exposed tool ID and permission key as "bash" for compatibility with
// existing plugins, users, and saved permissions. Rename with opencode 2.0.
export const ToolID = "bash"
export type ToolID = typeof ToolID
```

**参数 schema**（`packages/opencode/src/tool/shell/prompt.ts:15-23`）：

```typescript
export function parameterSchema() {
  return Schema.Struct({
    command: Schema.String.annotate({ description: "The command to execute" }),
    timeout: Schema.optional(PositiveInt).annotate({ description: "Optional timeout in milliseconds" }),
    workdir: Schema.optional(Schema.String).annotate({
      description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
    }),
  })
}
```

| 参数 | 类型 | 必填 | 默认值 |
|------|------|------|--------|
| `command` | string | ✅ | — |
| `timeout` | positive int（毫秒） | ❌ | `flags.bashDefaultTimeoutMs ?? 120000`（`shell.ts:347`） |
| `workdir` | string | ❌ | `instanceCtx.directory`（`shell.ts:612-614`） |

注意 `timeout` 只有 `PositiveInt` 约束，**没有上限**（V2 实现有 10 分钟上限，见 §H）。运行期还额外做了一次负数检查并直接 `throw`（`shell.ts:615-617`）：

```typescript
// packages/opencode/src/tool/shell.ts:615-617
if (params.timeout !== undefined && params.timeout < 0) {
  throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
}
```

**工具描述：模板 + 运行时渲染。** `shell/shell.txt` 是骨架（全文 21 行），值得整段引用：

```
${intro}

Be aware: OS: ${os}, Shell: ${shell}

${workdirSection}

Use `${tmp}` for temporary work outside the workspace. This directory has already been created, already exists, and is pre-approved for external directory access.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

${commandSection}

# Git and GitHub
- Only commit, amend, push, or create PRs when explicitly requested.
- Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`; stage only intended files and never commit secrets.
- Write a concise commit message that matches the repo style.
- Do not update git config, skip hooks, use interactive `-i`, force-push, or create empty commits unless explicitly requested.
- If a commit fails or hooks reject it, fix the issue and create a new commit; do not amend the failed commit.
- Before creating a PR, inspect status, diff, remote tracking, recent commits, and the diff from the base branch.
- Review all commits included in the PR, not just the latest commit.
- Use `gh` for GitHub tasks, including PRs, issues, checks, and releases; return the PR URL when done.
```

占位符由 `prompt.ts:273-293` 的 `render(name, platform, limits, defaultTimeoutMs)` 填充，`${commandSection}` 分三套 profile（`prompt.ts:221-271`）：bash（`bashCommandSection`，`prompt.ts:78-119`）、PowerShell（`powershellCommandSection`，`prompt.ts:121-170`）、cmd.exe（`cmdCommandSection`，`prompt.ts:172-219`）。

bash 版 `commandSection` 里几条对 zero2agent 直接有参考价值的约束（`prompt.ts:96-98`）：

```
  - The command argument is required.
  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after ${defaultTimeoutMs}ms.
  - If the output exceeds ${limits.maxLines} lines or ${limits.maxBytes} bytes, it will be truncated and the full output
    will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full
    content. Do NOT use `head`, `tail`, or other truncation commands to limit output; the full output will already be
    captured to a file for more precise searching.
```

以及一整段「别用 shell 干专用工具的活」（`prompt.ts:100-106`）：

```
  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly
    instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
```

和禁止 `cd` 的 good/bad example（`prompt.ts:112-118`）：

```
  - AVOID using `cd <directory> && <command>`. Use the `workdir` parameter to change directories instead.
    <good-example>
    Use workdir="/foo/bar" with command: pytest tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>
```

**「运行时渲染描述」的意义**（推断）：截断阈值和默认超时都来自用户配置（`truncate.ts:75-83` 读 `tool_output.max_lines` / `max_bytes`），如果描述写死数字就会和实际行为脱节。测试 `shell.test.ts:1067` 正是断言 `tool.description` 里含 `commands will time out after 500ms`——**描述文本被当成契约的一部分来测**。

### B. 执行机制

**API 层级**：`shell.ts` 用 Effect 的 `ChildProcess.make` 描述命令，交给注入的 `ChildProcessSpawner` 执行（`shell.ts:341, 511`）；实际 spawner 实现是 `packages/core/src/cross-spawn-spawner.ts`，底层用 npm `cross-spawn` 包（`cross-spawn-spawner.ts:26, 270`）。

**是否走 shell**：走。POSIX 分支把整条命令字符串作为 `command`、args 传空数组、通过 `shell` 选项指定解释器（`shell.ts:303-310`）：

```typescript
// packages/opencode/src/tool/shell.ts:293-312
function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd, env, stdin: "ignore", detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
```

三个细节（`shell.ts:303-310`）：
- `detached: process.platform !== "win32"` —— POSIX 上开新进程组，这是后面能 `kill(-pid)` 杀整组的前提。
- `stdin: "ignore"` —— 没有输入通道（见 §G）。
- Windows PowerShell 显式加 `-NonInteractive`。

**用哪个 shell**：`Shell.acceptable(cfg.shell)`（`shell.ts:601`）。解析链路在 `packages/core/src/shell.ts`：

```typescript
// packages/core/src/shell.ts:214-221
export function acceptable(configShell?: string) {
  if (configShell) return select(configShell, { acceptable: true })
  defaultAcceptable ??= select(process.env.SHELL, { acceptable: true })
  return defaultAcceptable
}
```

`select()`（`core/src/shell.ts:114-121`）先校验候选 shell 是否 `ok()`（即 META 表里没标 `deny`），解析不出来则平台兜底 `fallback()`（`core/src/shell.ts:132-137`）：macOS → `/bin/zsh`，其他 → `which("bash")` → `/bin/sh`。

META 表（`core/src/shell.ts:13-23`）标了每种 shell 的特性，`fish: { deny: true }` 和 `nu: { deny: true }` 是被拒的：

```typescript
// packages/core/src/shell.ts:13-23
const META: Record<string, { deny?: boolean; login?: boolean; posix?: boolean; ps?: boolean }> = {
  bash: { login: true, posix: true },
  dash: { login: true, posix: true },
  fish: { deny: true, login: true },
  ksh: { login: true, posix: true },
  nu: { deny: true },
  powershell: { ps: true },
  pwsh: { ps: true },
  sh: { login: true, posix: true },
  zsh: { login: true, posix: true },
}
```

> 推断：`fish` / `nu` 被 deny 的原因应该是它们的语法（尤其 `&&`、变量展开）与 prompt 里教给模型的 bash 习惯不兼容，而 tree-sitter 只有 bash / PowerShell 两套 parser，没法解析 fish。源码注释里未说明理由，此为解读。

**工作目录**：`params.workdir` 存在则用 `resolvePath(params.workdir, instanceCtx.directory, shell)` 解析（相对路径按 instance 目录 resolve），否则直接用 `instanceCtx.directory`（`shell.ts:612-614`）。cwd 直接传给 spawner 的 `cwd` 选项，**不是靠 `cd` 拼进命令**。

**环境变量**：`shellEnv()`（`shell.ts:416-426`）在 `process.env` 之上叠加插件贡献：

```typescript
// packages/opencode/src/tool/shell.ts:416-426
const shellEnv = Effect.fn("ShellTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
  const extra = yield* plugin.trigger("shell.env", { cwd, sessionID: ctx.sessionID, callID: ctx.callID }, { env: {} })
  return {
    ...process.env,
    ...extra.env,
  }
})
```

即**全量继承宿主环境**，插件可覆盖。模型无法通过参数设置环境变量。

> 值得注意的对比：另有一条**非工具**的执行路径（TUI 里用户手敲的 shell 命令，`packages/opencode/src/session/prompt.ts:522-524`）用的是 `Shell.args()`（`core/src/shell.ts:166-200`），它会 source 用户的 `.zshrc` / `.bashrc`、`shopt -s expand_aliases`，然后 `cd -- "$1"` 再 `eval`。**shell 工具（模型调用的那条）不走这条路**，所以模型执行的命令拿不到用户 shell 别名。

### C. 返回契约

返回值是结构化的 `ExecuteResult`（`shell.ts:585-593`）：

```typescript
// packages/opencode/src/tool/shell.ts:585-593
return {
  title: input.command,
  metadata: {
    output: last || preview(output),
    exit: code,
    truncated: cut,
    ...(cut && file ? { outputPath: file } : {}),
  },
  output,
}
```

关键在于**哪一部分给模型看**。序列化成 model message 时只取 `state.output`（`packages/opencode/src/session/message-v2.ts:292-320`）：

```typescript
// packages/opencode/src/session/message-v2.ts:292-295
if (part.state.status === "completed") {
  const outputText = part.state.time.compacted
    ? "[Old tool result content cleared]"
    : truncateToolOutput(part.state.output, options?.toolOutputMaxChars)
```

`metadata` 只走事件流给 TUI 展示（`shell.ts:487-530` 边流边 `ctx.metadata(...)` 更新，`session/prompt.ts:400-411` 落库）。所以三者的呈现是：

| 项 | 模型可见？ | 载体 |
|----|-----------|------|
| stdout | ✅ | `output`，与 stderr 合流 |
| stderr | ✅ | `output`，与 stderr 合流（`cross-spawn-spawner.ts:264` `Stream.merge`） |
| exit code | ❌ | 只在 `metadata.exit` |

**stdout / stderr 合流**：`shell.ts:487` 消费 `handle.all`，而 `all` 是：

```typescript
// packages/core/src/cross-spawn-spawner.ts:264
return { stdout, stderr, all: Stream.merge(stdout, stderr) }
```

`Stream.merge` 意味着**交错顺序不保证**（推断：并发 merge 无排序语义）。测试只断言两者都在（`shell.test.ts:1086-1089`），没断言顺序。

**非零退出是普通回执，不是错误。** 测试直接确认（`packages/opencode/test/tool/shell.test.ts:1096-1106`）：

```typescript
it.live("returns non-zero exit code", () =>
  runIn(projectRoot, Effect.gen(function* () {
    const result = yield* run({ command: `exit 42` })
    expect(result.metadata.exit).toBe(42)
  })),
)
```

`run()` 正常返回，`Effect` 不 fail。工具层唯一会抛错的是参数非法（`shell.ts:616` 负 timeout）和内部 defect（`shell.ts:558` `Effect.orDie`）。

> **这是一个可疑的设计**（推断）：模型看不到 exit code，只能靠 stderr 文本猜「失败了没」。对 `exit 1` 且无输出的命令，模型收到的就是字面 `(no output)`（`shell.ts:576`），无法区分「成功且无输出」和「失败」。V2 实现修正了这一点（§G）。

**无输出兜底**：`output` 为空串时替换为 `(no output)`（`shell.ts:575-576`）。

### D. 输出量控制

阈值来自 `Truncate.Service.limits()`（`shell.ts:438`），默认：

```typescript
// packages/opencode/src/tool/truncate.ts:15-17
export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024
export const DIR = TRUNCATION_DIR
```

可被配置覆盖（`truncate.ts:75-83` 读 `cfg.tool_output.max_lines` / `max_bytes`）。落盘目录是 `<data>/tool-output`（`truncation-dir.ts:4`），并有 7 天清理（`truncate.ts:13, 54-66`）。

shell 工具**没有直接用** `Truncate.output()`（那个通用截断是 `head` 方向，`truncate.ts:89`），而是自己实现了一套流式 + 截尾方案，分三层：

**第一层：流式滚动窗口。** 边读边攒 chunk，超过 `maxBytes * 2` 就从头丢弃（`shell.ts:438-439, 488-496`）：

```typescript
// packages/opencode/src/tool/shell.ts:438-439
const limits = yield* trunc.limits()
const keep = limits.maxBytes * 2
```
```typescript
// packages/opencode/src/tool/shell.ts:488-496
const size = Buffer.byteLength(chunk, "utf-8")
list.push({ text: chunk, size })
used += size
while (used > keep && list.length > 1) {
  const item = list.shift()
  if (!item) break
  used -= item.size
  cut = true
}
```

即**内存里最多只留 2 倍 maxBytes（默认 100KB）的尾部**，防止 `yes` 之类无限输出打爆内存。

**第二层：超限落盘。** 累积输出超 `maxBytes` 时，切换到写文件流（`shell.ts:504-521`，即 `trunc.write(full)` + `createWriteStream(next, { flags: "a" })`）：

```typescript
// packages/opencode/src/tool/shell.ts:504-513（节选）
if (Buffer.byteLength(full, "utf-8") > limits.maxBytes) {
  return trunc.write(full).pipe(
    Effect.andThen((next) => Effect.sync(() => {
      file = next
      cut = true
      sink = createWriteStream(next, { flags: "a" })
      full = ""
    })),
```

**第三层：最终裁剪 = 截尾。** `tail(raw, maxLines, maxBytes)`（`shell.ts:225-261`）从**最后一行往前**收集，即**保留末尾、丢弃开头**：

```typescript
// packages/opencode/src/tool/shell.ts:234-260（节选）
const out: string[] = []
let bytes = 0
for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
  const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
  if (bytes + size > maxBytes) {
    if (out.length === 0) {
      // 单行就超限：按字节切，且跳过 UTF-8 续字节保证不截坏多字节字符
      const buf = Buffer.from(lines[i], "utf-8")
      let start = buf.length - maxBytes
      if (start < 0) start = 0
      while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
      out.unshift(buf.subarray(start).toString("utf-8"))
    }
    break
  }
  out.unshift(lines[i])
  bytes += size
}
return { text: out.join("\n"), cut: true }
```

注意 `(buf[start] & 0xc0) === 0x80` 那几行——**按字节截断时手动对齐 UTF-8 边界**，避免给模型送半个汉字。

**截断了会明确告诉模型**，且给出完整输出的文件路径（`shell.ts:578-580`）：

```typescript
if (cut && file) {
  output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
}
```

**截头 vs 截尾的取舍**（推断）：命令输出的关键信息（报错、汇总、失败列表）通常在末尾，所以 shell 截尾；而文件读取 / grep 结果的关键信息在开头，所以通用 `Truncate.output` 默认 `head`（`truncate.ts:89`）。这是**按数据形态选方向**，不是随手写的。

另有一条独立的 metadata 限流：`MAX_METADATA_LENGTH = 30_000`（`shell.ts:27`），`preview()`（`shell.ts:220-223`）保留末尾 30000 字符给 TUI，与模型侧无关。

### E. 超时

**默认值** `2 * 60 * 1000` = 2 分钟（`shell.ts:347`），可被环境变量 `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` 覆盖（`packages/opencode/src/effect/runtime-flags.ts:53`）：

```typescript
// packages/opencode/src/tool/shell.ts:347
const defaultTimeoutMs = flags.bashDefaultTimeoutMs ?? 2 * 60 * 1000
```

**模型可指定**：`timeout` 参数（毫秒），无上限。

**实现方式**：`Effect.raceAll` 三方竞速——正常退出 / 用户中止 / 超时（`shell.ts:542-556`）：

```typescript
// packages/opencode/src/tool/shell.ts:540-556
const timeout = Effect.sleep(`${input.timeout + 100} millis`)

const exit = yield* Effect.raceAll([
  handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
  abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
  timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
])

if (exit.kind === "abort") {
  aborted = true
  yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
}
if (exit.kind === "timeout") {
  expired = true
  yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
}
```

（`input.timeout + 100` 那个 100ms 宽限没有注释解释；推断是给进程留出正常退出的余量，避免边界抖动。）

**进程怎么杀**：`handle.kill({ forceKillAfter: "3 seconds" })` 落到 spawner 的 kill 实现（`cross-spawn-spawner.ts:427-437`），先 `killGroup`（对**进程组**发信号）、失败才降级 `killOne`；3 秒后升级 `SIGKILL`：

```typescript
// packages/core/src/cross-spawn-spawner.ts:427-437
kill: (opts?: ChildProcess.KillOptions) => {
  const sig = opts?.killSignal ?? "SIGTERM"
  const send = (s: NodeJS.Signals) =>
    Effect.catch(killGroup(command, proc, s), () => killOne(command, proc, s))
  const attempt = send(sig).pipe(Effect.andThen(Deferred.await(signal)), Effect.asVoid)
  if (!opts?.forceKillAfter) return attempt
  return Effect.timeoutOrElse(attempt, {
    duration: opts.forceKillAfter,
    orElse: () => send("SIGKILL").pipe(Effect.andThen(Deferred.await(signal)), Effect.asVoid),
  })
},
```

`killGroup` POSIX 分支就是 `process.kill(-proc.pid!, signal)`（`cross-spawn-spawner.ts:308`），Windows 分支走 `taskkill /pid N /T /F`（`cross-spawn-spawner.ts:299`）。**这是「杀整个进程组」而不是只杀 shell 本身**——正是 `detached: true` 换来的能力。

（另有一份独立的 `Shell.killTree()`（`core/src/shell.ts:31-60`），SIGTERM → 等 200ms → SIGKILL，但 shell 工具没用它，用的是上面 spawner 那条。）

**超时后告知模型**：拼进 `<shell_metadata>` 块（`shell.ts:560-584`）：

```typescript
// packages/opencode/src/tool/shell.ts:561-566
const meta: string[] = []
if (expired) {
  meta.push(
    `shell tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
  )
}
if (aborted) meta.push("User aborted the command")
```
```typescript
// packages/opencode/src/tool/shell.ts:582-584
if (meta.length > 0) {
  output += "\n\n<shell_metadata>\n" + meta.join("\n") + "\n</shell_metadata>"
}
```

两点设计意图（可从文本本身读出，非推断）：
1. **超时不丢已有输出**——超时提示是**追加**在 output 后面，模型仍能看到进程被杀之前的输出。
2. **提示里带下一步动作**（"retry with a larger timeout"），而且**提醒模型考虑另一种可能**（"is not waiting for interactive input"）——因为 stdin 被 ignore，交互式命令会永久卡住直到超时。

测试覆盖：`shell.test.ts:1046-1058`（显式 timeout）、`1060-1078`（默认 timeout 且断言描述文本）。

### F. 安全边界

OpenCode 的安全模型是**「解析命令 → 抽路径 → 分级询问」**，而不是黑白名单。分两条询问通道（`shell.ts:263-291`）。

**第一步：tree-sitter 解析命令。** 加载 bash 和 PowerShell 两套 wasm parser（`shell.ts:311-336`），一次性 lazy 初始化：

```typescript
// packages/opencode/src/tool/shell.ts:311-335（节选）
const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  ...
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, { with: { type: "wasm" } })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, { with: { type: "wasm" } })
  ...
  return { bash, ps }
})
```

**第二步：`collect()` 扫描出「需要询问什么」**（`shell.ts:378-414`）：

```typescript
// packages/opencode/src/tool/shell.ts:391-412（节选）
for (const node of commands(root)) {
  const command = parts(node)
  const tokens = command.map((item) => item.text)
  const cmd = ps || shellKind === "cmd" ? tokens[0]?.toLowerCase() : tokens[0]

  if (cmd && (FILES.has(cmd) || (shellKind === "cmd" && CMD_FILES.has(cmd)))) {
    for (const arg of pathArgs(command, ps, shellKind === "cmd")) {
      const resolved = yield* argPath(arg, cwd, ps, shell)
      if (!resolved || containsPath(resolved, instance)) continue
      const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
      scan.dirs.add(dir)
    }
  }

  if (tokens.length && (!cmd || !CWD.has(cmd))) {
    scan.patterns.add(source(node))
    scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
  }
}
```

`FILES` 是「会碰文件的命令」白名单（`shell.ts:29-50`）——注意这**不是**「允许执行的命令白名单」，而是「需要额外检查路径参数的命令清单」：

```typescript
// packages/opencode/src/tool/shell.ts:28-50
const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content", "set-content", "add-content", "copy-item", "move-item",
  "remove-item", "new-item", "rename-item",
])
```

路径解析这段做得相当细：`argPath()`（`shell.ts:369-376`）会 unquote、展开 `~`（`home()`，`shell.ts:129-133`）、展开 `$env:X` / `$HOME` / `$PWD`（`expand()`，`shell.ts:145-151`）、剥掉 glob 通配后的部分（`prefix()`，`shell.ts:174-179`）、**跳过含动态展开的路径**（`dynamic()`，`shell.ts:167-172`，遇到 `$(`、`${`、反引号就放弃）。

**第三步：两级询问**（`shell.ts:263-291`）：

```typescript
// packages/opencode/src/tool/shell.ts:263-291
const ask = Effect.fn("ShellTool.ask")(function* (ctx: Tool.Context, scan: Scan, input: { command: string }) {
  if (scan.dirs.size > 0) {
    const directories = Array.from(scan.dirs)
    const globs = directories.map((dir) => { ... return path.join(dir, "*") })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: { command: input.command, directories, patterns: globs },
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: ShellID.ToolID,     // 即 "bash"
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: { command: input.command },
  })
})
```

**工作目录逃逸**：`workdir` 本身也检查，逃出去就加进 `scan.dirs` 触发 `external_directory` 询问（`shell.ts:625`）：

```typescript
// packages/opencode/src/tool/shell.ts:624-626
const scan = yield* collect(tree.rootNode, cwd, ps, shell, instanceCtx)
if (!containsPath(cwd, instanceCtx)) scan.dirs.add(cwd)
yield* ask(ctx, scan, params)
```

`containsPath()` 判定「在工作区内」（`packages/opencode/src/project/instance-context.ts:18-24`）：

```typescript
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  if (FSUtil.contains(ctx.directory, filepath)) return true
  // Non-git projects set worktree to "/" which would match ANY absolute path.
  // Skip worktree check in this case to preserve external_directory permissions.
  if (ctx.worktree === "/") return false
  return FSUtil.contains(ctx.worktree, filepath)
}
```

**所以答案是：工作目录逃逸不做硬拒绝，而是升级为权限询问。** 与 write-file 调研的结论一致（见 [write-file/opencode.md](../write-file/opencode.md)）。

**权限系统的默认动作是 ask**（`packages/opencode/src/permission/index.ts:28-38`）：

```typescript
export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  return (
    rulesets.flat().findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}
```

三种 action：`deny` 直接失败、`allow` 放行、`ask` 挂起等用户回复（`permission/index.ts:72-107`）。

**`BashArity.prefix()`：让「总是允许」可复用。** `scan.always` 存的不是完整命令，而是命令前缀 + `*`（`shell.ts:410`）。`BashArity.prefix()`（`packages/opencode/src/permission/arity.ts:1-9`）查一张「命令前缀 → 有意义 token 数」的字典：

```typescript
// packages/opencode/src/permission/arity.ts:1-9
export function prefix(tokens: string[]) {
  for (let len = tokens.length; len > 0; len--) {
    const prefix = tokens.slice(0, len).join(" ")
    const arity = ARITY[prefix]
    if (arity !== undefined) return tokens.slice(0, arity)
  }
  if (tokens.length === 0) return []
  return tokens.slice(0, 1)
}
```

字典里 `git: 2`、`npm run: 3`、`docker compose: 3`、`rm: 1`（`arity.ts:24-162`）。效果是：用户对 `git status` 点「总是允许」，保存的规则是 `git status *`（而不是 `git *`，也不是那条具体命令）。字典本身是 LLM 生成的，prompt 就留在文件注释里（`arity.ts:11-23`）。

**明确不存在的机制（已检索确认）**：
- **命令黑名单 / 允许执行的白名单**：未找到。`FILES` / `CMD_FILES` 是「需检查路径的命令」清单，不是准入控制；一切命令都能执行（前提是权限询问被批准）。
- **沙箱 / 容器 / seccomp**：未找到。命令以宿主用户权限直接跑（V2 的工具描述里甚至把这点写明：`with the host user's filesystem, process, and network authority`，`packages/core/src/tool/bash.ts:109`）。
- **对 `$(...)`、反引号的拦截**：未找到。`dynamic()`（`shell.ts:167-172`）只是**放弃解析**这些路径参数（因此不触发 external_directory 询问），命令本身照跑。这意味着 `rm $(echo /etc/x)` 的路径检查会静默失空——但仍会走 `bash` 权限询问那一关。

### F-bis. tmp 目录：一个「预批准的逃逸口」

`shell.txt:7` 给了模型一个官方的工作区外落脚点：

```
Use `${tmp}` for temporary work outside the workspace. This directory has already been created, already exists, and is pre-approved for external directory access.
```

`${tmp}` 由 `Global.Path.tmp` 填充（`prompt.ts:281`）。这是**用「引导到安全区」替代「一味拒绝」**——推断意图：模型总有正当的临时文件需求，与其让它每次撞权限弹窗，不如给一个预批准目录。

### G. 特殊命令处理（后台 / 长时间 / 交互式）

**交互式命令（stdin）：无输入通道。** `stdin: "ignore"` 写死在两个分支（`shell.ts:298, 307`）。模型没有任何参数可以传 stdin。后果是交互式命令（`git rebase -i`、`npm login`、等待输入的 `read`）会**挂到超时被杀**。OpenCode 的应对是**在提示语里教模型识别这个情况**（`shell.ts:564` 的 "is not waiting for interactive input"）和在 shell.txt 里禁止交互式 git（`shell.txt:17`：`Do not ... use interactive -i ...`）。

**后台执行：模型侧未找到入口。** 检索结果：
- shell 工具参数里没有 `background` / `run_in_background`（`prompt.ts:15-23`）。
- `packages/opencode/src/tool/` 下提到 `background` 的只有 `registry.ts` / `task.ts` / `read.ts` / `task.txt`，**没有 shell.ts**。
- `packages/core/src/background-job.ts` 里有一套完整的后台作业服务（`Status = "running" | "completed" | "error" | "cancelled"`，`background-job.ts:7`；`start` / `wait` / `extend` 等，`background-job.ts:64-80`），但**没有被 shell 工具引用**。
- V2 的 `bash.ts` 用 TODO 明确说了这是**有意不做**（`packages/core/src/tool/bash.ts:72-74`）：

```typescript
// packages/core/src/tool/bash.ts:72-74
// TODO: Persist background job status and define restart recovery before exposing remote observation.
// TODO: Re-add model-facing background launch only with owner-bound get/wait/cancel tools and completion delivery.
// TODO: Add HTTP background-job observation only after durable status, restart recovery, and authorization are defined.
```

「Re-add model-facing background launch」的措辞说明**曾经有过、被移除了**，且回归条件是「必须先有配套的 get/wait/cancel 工具和完成投递机制」。

**长时间运行：只有 timeout + 流式 metadata。** 长命令期间 `ctx.metadata({ metadata: { output: last } })` 会持续推送增量给 TUI（`shell.ts:498, 515-529`，测试 `shell.test.ts:1108`「streams metadata updates progressively」），**但这是给人看的，模型只在命令结束后一次性收到结果**。

**pty**：`packages/core/src/pty/` 下有完整的 pty 实现（`pty.bun.ts` / `pty.node.ts` / `protocol.ts` / `ticket.ts`），但检索 `packages/opencode/src/tool/` 和 `packages/core/src/tool/` 下的 `Pty.` 引用为零命中——**pty 不服务于模型的 shell 工具**（推断：它是给 TUI 的交互式终端面板用的）。

### H. 对照：V2 的 `bash.ts`（`packages/core/src/tool/bash.ts`）

同一 commit 里存在一个更精简的 V2 实现，虽然当前 registry 接的是 V1（`packages/opencode/src/tool/registry.ts:105` `yield* ShellTool`），但它的取舍对 zero2agent 更有参考价值——**因为它就是「把 V1 砍成最小可用」的结果**，而且砍掉了什么全部写在 TODO 里（`bash.ts:66-77`）。

关键差异：

| 维度 | V1（`opencode/src/tool/shell.ts`） | V2（`core/src/tool/bash.ts`） |
|------|-----------------------------------|------------------------------|
| 代码量 | 646 行 + 294 行 prompt.ts | 207 行 |
| 工具描述 | 模板 + 三套 profile 运行时渲染 | **一段字符串常量**（`bash.ts:109`） |
| shell 选择 | 用户 SHELL / 配置 / 平台兜底 + META 表 | 配置 `shell` 或 `/bin/sh`（POSIX）/ `COMSPEC`（Win）（`bash.ts:49`） |
| timeout 上限 | 无 | **10 分钟**（`bash.ts:20, 28`） |
| exit code 给模型 | ❌ | ✅ `Command exited with code N.`（`bash.ts:51-57, 118-121`） |
| 命令解析 | tree-sitter bash + PowerShell | **正则 tokenize**（`bash.ts:79`） |
| 路径逃逸 | 触发 external_directory 询问 | **只产出 advisory warning**（`bash.ts:138-141`） |
| 输出上限 | 2000 行 / 50KB + 落盘 | 1MB 内存硬上限（`bash.ts:21`），不落盘 |

V2 的 `toModelOutput` 是本次调研里最值得抄的一段——**它把 exit code 显式说给模型**：

```typescript
// packages/core/src/tool/bash.ts:51-57
const modelOutput = (output: Output) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.timeout) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command timed out before completion.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}
```
```typescript
// packages/core/src/tool/bash.ts:118-121
toModelOutput: ({ output }) => [
  { type: "text", text: output.output },
  { type: "text", text: modelOutput(output) },
],
```

V2 的工具描述（`bash.ts:109`）也值得整段引用，因为它把「这个工具有多危险」直接写给模型：

```
Execute one shell command string with the host user's filesystem, process, and network authority.
The active Location is the default working directory. Relative workdir values resolve from that Location.
External workdir values require external_directory approval; best-effort command-argument path warnings
are advisory only. Timeout values are milliseconds (default: 120000; maximum: 600000). Uses the configured
shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows.
```

V2 的超时处理也更直白——超时不是「杀了再拼提示」，而是**返回一个 `timeout: true` 的正常结果**（`bash.ts:177-184`）：

```typescript
// packages/core/src/tool/bash.ts:177-184
if (!result) {
  return {
    output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
    truncated: false,
    timeout: true,
    ...(warnings.length ? { warnings } : {}),
  }
}
```

进程清理靠 `ChildProcess.make(..., { detached: process.platform !== "win32", forceKillAfter: Duration.seconds(3) })`（`bash.ts:158-164`）声明式指定，由 spawner 的 scope finalizer 负责（`cross-spawn-spawner.ts:382-402`）。

## 对 zero2agent 的启发

### 值得学的

| 点 | OpenCode 做法 | 为什么值得学 |
|----|--------------|-------------|
| **参数三件套** | `command` / `timeout` / `workdir`（`prompt.ts:15-23`） | 两套实现（V1/V2）参数完全一致，说明这是收敛后的最小集。`workdir` 尤其重要——不给的话模型只能 `cd x && cmd`，而每次 shell 都是新进程、cwd 不持久，容易出错 |
| **stdout/stderr 合流** | `handle.all` = `Stream.merge`（`cross-spawn-spawner.ts:264`） | 分开返回会逼模型在两个字段间拼时序。合流一条最省事，V1/V2 都这么做（V2 `combineOutput: true`，`bash.ts:168`） |
| **exit code 显式说给模型** | **V2** 追加 `Command exited with code N.`（`bash.ts:56, 118-121`） | V1 把 exit code 藏在 metadata 里是明显的坑（模型分不清「成功无输出」和「失败」）。**照 V2 抄**，不要照 V1 |
| **非零退出 = 普通回执** | `shell.test.ts:1096-1106` | 命令失败是模型要读的信息，不是工具异常。如果 throw，模型拿到的是框架的错误包装而不是 stderr |
| **截断截尾而非截头** | `tail()`（`shell.ts:225-261`） | 命令输出关键信息在末尾（报错、汇总）。这是 shell 特有的取舍——同仓库的通用截断默认 `head`（`truncate.ts:89`） |
| **截断要告诉模型** | `...output truncated...`（`shell.ts:579`） | 否则模型会把截断后的内容当完整输出来推理 |
| **超时不丢已有输出** | 提示**追加**在 output 后（`shell.ts:582-584`） | 超时前的输出往往就是诊断依据 |
| **超时提示带下一步动作** | `retry with a larger timeout value in milliseconds`（`shell.ts:564`） | 回执不只报告失败，还告诉模型怎么恢复。这是「回执带信息量」原则在 terminal 场景的落地 |
| **默认超时 2 分钟** | `shell.ts:347` / `bash.ts:19` | 两套实现同值，可以直接采用这个数 |
| **杀进程组而非进程** | `detached: true` + `process.kill(-pid)`（`shell.ts:308`、`cross-spawn-spawner.ts:308`） | 只杀 shell 会留下孤儿子进程。**这是 5 行代码的成本，收益很大**，教学价值也高（能讲清进程组概念） |
| **UTF-8 边界对齐** | `while ((buf[start] & 0xc0) === 0x80) start++`（`shell.ts:243`） | 按字节截断会截坏多字节字符。中文场景必踩，3 行代码 |
| **描述里禁 shell 干专用工具的活** | `prompt.ts:100-106` | 不写这段，模型会一直用 `cat` 而不是 `read`，`grep` 而不是 grep 工具。zero2agent 已有 read/grep/glob，这段约束是刚需 |
| **描述里禁 `cd`，给 good/bad example** | `prompt.ts:112-118` | good/bad example 对格式约束的效果显著优于纯散文描述 |

### 太重、不必学

| 点 | OpenCode 的重量 | zero2agent 该怎么办 |
|----|----------------|-------------------|
| **tree-sitter 解析命令** | 两个 wasm parser + 十几个辅助函数（`shell.ts:88-261, 305-336, 378-414`），近 300 行 | **不做**。V2 自己都退回正则 tokenize（`bash.ts:79`）并把 tree-sitter 列为 TODO（`bash.ts:66`），是「重到官方自己都先砍掉」的证明 |
| **多 shell 支持（bash/zsh/pwsh/cmd）+ 三套 prompt profile** | `prompt.ts` 294 行几乎全在处理这个 | **不做**。V2 直接 `/bin/sh`（`bash.ts:49`）。教学项目固定一个 shell（或 `process.env.SHELL` 单行兜底）即可 |
| **运行时渲染工具描述** | `render()` + 模板占位符（`prompt.ts:273-293`） | **不做**（除非超时/阈值可配置）。写静态字符串，把数字写死并与代码常量对齐 |
| **权限系统 + arity 字典 + 「总是允许」规则持久化** | `permission/index.ts` + `arity.ts`（数百条命令字典） | **不做**。zero2agent 已定「只做正常执行路径」，权限确认需要扩 ToolContext + 交互通道，是独立主题 |
| **超限落盘 + 7 天清理 + 引导模型 Grep 大文件** | `truncate.ts` 全套 + shell 里的流式 sink（`shell.ts:450-473, 500-521`） | **简化**。截断 + 明确告知即可。落盘引入了目录管理、清理调度、路径告知三层复杂度，V2 也砍掉了（`bash.ts:21` 只有 1MB 内存上限，TODO `bash.ts:77` 标着「以后再做流式落盘」） |
| **流式 metadata 推送** | `ctx.metadata()` 边流边推（`shell.ts:515-529`） | **不做**。这是给 TUI 实时显示的，模型仍是一次性收结果。除非 zero2agent 的 TUI 明确要这个体验 |
| **external_directory 分级询问** | `shell.ts:263-291` + `collect()` | **不做**。与 write-file 结论一致：zero2agent 更适合「硬拒绝逃逸」或「不管」，而非升级询问 |

### 三个可以直接借走的「教学锚点」

1. **「exit code 要不要给模型看」是个真实的分歧点，而且 OpenCode 自己改了主意。** V1 藏在 metadata（`shell.ts:588`），V2 显式追加文本（`bash.ts:56`）。同一仓库同一 commit 里的前后对比，是很好的教学素材：说明「结构化返回值里哪些字段真的到了模型手里」这件事容易搞错。

2. **「截头还是截尾」不是随手决定的，取决于数据形态。** 同仓库同一个 `Truncate` 服务，shell 走 tail（`shell.ts:569`），通用输出默认 head（`truncate.ts:89`）。

3. **后台执行「不做」是有明确条件的。** V2 的 TODO（`bash.ts:72-74`）写出了回归的前置条件：持久化状态、重启恢复、owner-bound 的 get/wait/cancel 配套工具、完成投递。这正好可以作为 S004 讨论后台执行时的需求清单——**它说明「加个 background 参数」远不是完整方案**。

## 关键源码引用

| 文件 | 行号 | 内容 |
|------|------|------|
| `packages/opencode/src/tool/shell.ts` | `338-644` | V1 shell 工具主体（`Tool.define`、`execute`、`run`） |
| `packages/opencode/src/tool/shell.ts` | `293-312` | `cmd()` —— 进程构造（shell / cwd / env / stdin ignore / detached） |
| `packages/opencode/src/tool/shell.ts` | `225-261` | `tail()` —— 截尾 + UTF-8 边界对齐 |
| `packages/opencode/src/tool/shell.ts` | `428-595` | `run()` —— 流式收集、滚动窗口、落盘、竞速超时、输出组装 |
| `packages/opencode/src/tool/shell.ts` | `540-558` | 超时 / abort / 正常退出三方竞速 + kill |
| `packages/opencode/src/tool/shell.ts` | `560-584` | `<shell_metadata>` 拼装（超时 / abort 提示） |
| `packages/opencode/src/tool/shell.ts` | `263-291` | `ask()` —— 两级权限询问 |
| `packages/opencode/src/tool/shell.ts` | `378-414` | `collect()` —— tree-sitter 扫描出待询问的路径与命令 |
| `packages/opencode/src/tool/shell/prompt.ts` | `15-23` | 参数 schema |
| `packages/opencode/src/tool/shell/prompt.ts` | `78-119` | bash 版工具描述正文 |
| `packages/opencode/src/tool/shell/prompt.ts` | `273-293` | `render()` —— 描述运行时渲染 |
| `packages/opencode/src/tool/shell/shell.txt` | 全文 21 行 | 描述模板骨架 |
| `packages/opencode/src/tool/shell/id.ts` | `14-17` | 工具 ID 为何仍叫 `bash` |
| `packages/opencode/src/tool/truncate.ts` | `15-17, 75-83` | 截断阈值默认值与配置覆盖 |
| `packages/core/src/shell.ts` | `13-23, 114-137, 214-221` | shell 解析（META 表、fallback、acceptable） |
| `packages/core/src/cross-spawn-spawner.ts` | `264` | `all: Stream.merge(stdout, stderr)` |
| `packages/core/src/cross-spawn-spawner.ts` | `292-312, 427-437` | 杀进程组 + SIGTERM→SIGKILL 升级 |
| `packages/core/src/tool/bash.ts` | 全文 207 行 | V2 精简实现（含 TODO 清单） |
| `packages/core/src/tool/bash.ts` | `51-57, 118-121` | exit code 显式给模型 |
| `packages/opencode/src/session/message-v2.ts` | `292-320` | 工具结果序列化给模型（只取 `output`） |
| `packages/opencode/src/permission/index.ts` | `28-38, 67-107` | 权限 evaluate / ask |
| `packages/opencode/src/permission/arity.ts` | `1-9, 24+` | 命令前缀 arity 字典 |
| `packages/opencode/test/tool/shell.test.ts` | `1046-1106, 1140-1160` | 超时 / exit code / stderr 合流 / 截断的行为测试 |

## 参考资料

- [Aider 终端执行调研](./aider.md)
- [OpenCode write-file 调研](../write-file/opencode.md)（权限系统、`containsPath` 逃逸策略的上游描述）

