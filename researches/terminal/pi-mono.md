# pi-mono — 终端执行（bash / 命令执行）调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | `https://github.com/badlogic/pi-mono.git`（`git remote -v`；源码内 import 已改为 `@earendil-works/pi-agent-core` / `@earendil-works/pi-tui`，说明项目正迁往 `earendil-works/pi`） |
| 调研 Commit | `65ff8e7f6db447dcddb1a9c8fd05f081c5cda76a`（`fix lint`） |
| Commit 日期 | `2026-07-23 13:45:10 +0000` |
| 调研日期 | `2026-08-26` |

> 证据约定：本文所有结论均标注 `文件路径:行号`（相对 pi-mono 仓库根）。凡标「**推断**」的段落是笔者解读，不是源码明写的内容；凡写「源码中未找到」的，是笔者在 `packages/agent/src` 与 `packages/coding-agent/src` 全量 grep 后仍无结果。

## 调研目标

为 zero2agent E02-S003（引入 `terminal` 工具）提供实证参考：pi-mono 的 bash 工具契约、执行机制、输出治理、超时与安全边界分别怎么做的？pi-mono 风格轻量，重点是找出它「用最少代码做到够用」的取舍点，以及哪些复杂度对教学项目属于可裁剪。

## 调研结论

1. **两处 bash 工具是「同一份设计的两次实现」，参数契约与工具描述逐字相同，差别只在 I/O 抽象层。** `packages/agent/src/harness/tools/bash.ts:11-14` 与 `packages/coding-agent/src/core/tools/bash.ts:40-43` 的 `bashSchema` 完全一致；两边 `description` 字符串也是同一句（`agent/…/bash.ts:57` vs `coding-agent/…/bash.ts:327`）。真正的差异是：harness 版把执行委托给抽象的 `ExecutionEnv.exec()`（`agent/…/bash.ts:110-121`），coding-agent 版自己 `spawn`（`coding-agent/…/bash.ts:96-103`）并额外挂了 TUI 渲染器（`renderCall` / `renderResult`，`coding-agent/…/bash.ts:459-495`）。

2. **参数只有两个：`command`（必填 string）+ `timeout`（可选 number，单位秒，无默认值）。** 没有 `cwd`、没有 `background`、没有 `description` 字段。`Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }))`——即**默认永不超时**（`agent/…/bash.ts:13`）。

3. **非零退出码走 `throw`，即 Agent 侧的「工具错误」，而不是普通回执。** `if (exitCode !== 0 && exitCode !== null) throw new Error(appendStatus(outputText, \`Command exited with code ${exitCode}\`))`（`coding-agent/…/bash.ts:451-453`；harness 版同 `agent/…/bash.ts:152-154`）。关键细节：**抛错时把已捕获的输出拼在错误消息里**，模型不会因为 exit code 非零而丢失 stderr。

4. **stdout / stderr 合并成一条流，不做区分。** `child.stdout?.on("data", onData); child.stderr?.on("data", onData)`（`coding-agent/…/bash.ts:125-126`）；harness 版 `onStdout: onChunk, onStderr: onChunk`（`agent/…/bash.ts:156-157`）。返回给模型的 content 就是一个 text block，空输出时替换为 `"(no output)"`（`agent/…/bash.ts:155`）。

5. **截断是双阈值「取先命中者」+ 保留尾部，且截断后全量输出落盘临时文件，路径写进给模型的文本里。** 阈值 `DEFAULT_MAX_LINES = 2000` / `DEFAULT_MAX_BYTES = 50 * 1024`（`coding-agent/src/core/tools/truncate.ts:11-12`）。bash 用 `truncateTail`（保尾，因为错误通常在结尾，见 `truncate.ts:162-167` 注释），截断后追加形如 `[Showing lines 1001-3000 of 3000. Full output: /tmp/pi-bash-xxx.log]` 的尾注（`coding-agent/…/bash.ts:414-424`）。

6. **超时和取消都用「杀进程组」，不是 kill 单个 pid。** spawn 时 `detached: process.platform !== "win32"`（`coding-agent/…/bash.ts:99`），杀的时候 `process.kill(-pid, "SIGKILL")`，失败才退化为 `process.kill(pid, "SIGKILL")`（`utils/shell.ts:205-216`）。Windows 走 `taskkill /F /T`（`utils/shell.ts:194-202`）。

7. **命令执行侧没有任何黑白名单、命令解析或沙箱。** 全仓 grep `allowedCommands|deniedCommands|forbidden|dangerous|rm -rf` 在 `packages/coding-agent/src/core` 与 `packages/agent/src` 下**零命中**。命令原样交给 bash `-c`。唯一的「信任」机制是启动期的 project trust（`core/project-trust.ts:45-80`），但它管的是「是否加载项目配置/扩展」，**不是**逐条命令确认。

8. **cwd 固定在工具创建时传入，工具调用期间不可变；不存在持久 shell session。** `createBashToolDefinition(cwd, options)`（`coding-agent/…/bash.ts:316`）闭包捕获 `cwd`，每次 execute 都 `spawn` 一个新 shell。**因此 `cd` 的效果不跨调用保留**（这一条是推断，但由「每次调用新 spawn 且 cwd 来自闭包」直接推出）。

9. **有流式输出：`onUpdate` 回调 + 100ms 节流，边跑边给 UI。** `BASH_UPDATE_THROTTLE_MS = 100`（`coding-agent/…/bash.ts:200`），`scheduleOutputUpdate` 用「距上次更新不足 100ms 就挂 timer」的合并策略（`coding-agent/…/bash.ts:369-383`）。测试断言 3000 行输出触发的 update 少于 25 次（`packages/agent/test/harness/tools.test.ts:594`）。

10. **没有 bash 版的 `file-mutation-queue`——命令执行不做任何串行化。** `withFileMutationQueue` 只被 `edit.ts:92` 使用（写文件路径级锁）；bash 工具里没有任何 import 或调用。多个 bash 调用理论上可并发跑。

## 详细分析

### A. 工具契约

两处的 schema 逐字相同：

```typescript
// packages/agent/src/harness/tools/bash.ts:11-14
const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});
```

`packages/coding-agent/src/core/tools/bash.ts:40-43` 是完全一样的四行（同样用 typebox `Type.Object`）。

工具描述（模板字符串，阈值由常量插值进去，两处一字不差）：

```typescript
// packages/agent/src/harness/tools/bash.ts:57
// == packages/coding-agent/src/core/tools/bash.ts:327
description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
```

代入常量后的实际文本是：`Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`

这段描述值得逐句读，因为它把**四件事**塞进了三句话：语义（在 cwd 里执行 bash）、返回内容（stdout + stderr）、输出治理契约（2000 行 / 50KB 双阈值 + 超限落盘）、可选参数提示。**描述里主动告知截断规则**，这是让模型自己规避「一次 `cat` 巨型文件」的低成本手段。

**两处契约的差异（穷举）**：

| 维度 | `packages/agent/.../bash.ts`（harness 版） | `packages/coding-agent/.../bash.ts`（coding-agent 版） |
|------|------|------|
| 名称 / label | `"bash"` / `"bash"`（`:55-56`） | `"bash"` / `"bash"`（`:325-326`） |
| 参数 schema | 同上 | 逐字相同 |
| description | 同上 | 逐字相同 |
| `promptSnippet` | **无** | `"Execute bash commands (ls, grep, find, etc.)"`（`:328`） |
| `promptGuidelines` | **无** | `["Inspect PI_* environment variables for current model and session details."]`，且仅当 `exposeSessionEnvironment` 为真（`:329-331`） |
| 执行后端 | `ExecutionEnv.exec()` 抽象（`:110-121`） | 自己 `spawn`，可被 `BashOperations` 替换（`:56-73`, `:96-103`） |
| cwd 来源 | `context.env.cwd`（每次调用从 turn context 取，`:62-67`） | `createBashToolDefinition(cwd, …)` 的闭包参数（`:316`） |
| 扩展钩子 | `prepare(execution, context, signal)`，可改 command/cwd/env/inheritEnv（`:29-38`, `:68`） | `spawnHook(context)`，可改 command/cwd/env（`:155-156`, `:183`） |
| TUI 渲染 | 无 | `renderCall` / `renderResult`（`:459-495`） |
| 返回类型 | `AgentHarnessTool<…>` | `ToolDefinition<…>`，再由 `wrapToolDefinition` 包成 `AgentTool`（`:497-504`） |

**推断**：harness 版是「纯内核」（无 UI、执行环境可换成远程/容器），coding-agent 版是「本地 CLI 产品实现」（自带 spawn 与终端渲染）。两者是同一契约的两套宿主适配，不是新旧替代关系——`packages/coding-agent/src/core/tools/index.ts:101,122` 明确仍在用自己那份。

### B. 执行机制

coding-agent 版的 spawn 是全文最值得抄的一段：

```typescript
// packages/coding-agent/src/core/tools/bash.ts:96-107
const commandFromStdin = shellConfig.commandTransport === "stdin";
const child = spawn(shellConfig.shell, commandFromStdin ? shellConfig.args : [...shellConfig.args, command], {
	cwd,
	detached: process.platform !== "win32",
	env: env ?? getShellEnv(),
	stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
	windowsHide: true,
});
if (commandFromStdin) {
	child.stdin?.on("error", () => {});
	child.stdin?.end(command);
}
```

要点：

- **API**：`node:child_process` 的 `spawn`（`coding-agent/…/bash.ts:5` import；harness 版最终也落到 `spawn`，见 `agent/src/harness/env/nodejs.ts:414`）。**不是** `exec`，因此没有 `maxBuffer` 上限问题，输出靠流式累积器治理。
- **不使用 `shell: true`**，而是显式把 shell 当可执行文件启动、命令作为 `-c` 的参数传入。
- **shell 选择有完整的解析链**（`utils/shell.ts:66-119`）：① 用户配置的 `shellPath`；② Windows 上先找 `%ProgramFiles%\Git\bin\bash.exe`，再 `where bash.exe`；③ Unix 上先 `/bin/bash`，再 `which bash`，**兜底 `sh`**（`utils/shell.ts:118`）。即「叫 bash 工具，但极端情况下可能是 sh」。
- **一个冷门但真实的坑**：检测到「老式 WSL 的 `C:\Windows\System32\bash.exe`」时，改用 `bash -s` 并把命令**从 stdin 灌进去**而不是当 argv（`utils/shell.ts:14-21`）。这就是 `commandTransport: "argv" | "stdin"` 存在的唯一原因。
- **cwd**：spawn 前先 `fsAccess(cwd, F_OK)` 探测，不存在就抛 `Working directory does not exist: ${cwd}\nCannot execute bash commands.`（`coding-agent/…/bash.ts:88-92`）。harness 版同样处理（`env/nodejs.ts:377-387`）。
- **环境变量**：`getShellEnv()` = `{...process.env}` 且**把 pi 自己的 bin 目录 prepend 到 PATH**（`utils/shell.ts:120-133`，注意它用大小写不敏感的方式找 `PATH` key，是为 Windows 的 `Path` 兼容）。然后 `resolveSpawnContext` 先**删掉五个 `PI_*` 变量再按需重新注入**（`coding-agent/…/bash.ts:165-178`）：

```typescript
// packages/coding-agent/src/core/tools/bash.ts:165-178
const env = { ...getShellEnv() };
delete env.PI_SESSION_ID;
delete env.PI_SESSION_FILE;
delete env.PI_PROVIDER;
delete env.PI_MODEL;
delete env.PI_REASONING_LEVEL;
if (exposeSessionEnvironment && ctx) {
	env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
	...
}
```

「先删后注入」是为了防止 pi 自己被嵌套调用时继承到上一层的会话变量（**推断**：源码未写原因，但 delete-then-set 的写法只有这个解释）。harness 版的 env 语义更简单：`inheritEnv` 为 false 时**完全不继承** `process.env`，只用显式传入的（`env/nodejs.ts:237-248`）。

- **持久 shell session：源码中无此机制。** 每次 `execute` 都新 spawn 一个 shell 进程；没有任何 pty / 常驻 shell / session id 复用的代码。因此 `cd`、`export`、shell 函数都不跨调用保留。要跨调用注入固定前缀，只有 `commandPrefix` 这一个手段——它把前缀和命令用换行拼起来，仍在同一次 spawn 内（`coding-agent/…/bash.ts:340`；测试见 `tools.test.ts:565-577`）。

### C. 返回契约

成功路径：

```typescript
// packages/coding-agent/src/core/tools/bash.ts:454
return { content: [{ type: "text", text: outputText }], details };
```

- **形态**：`content` 是标准的 text block 数组（给模型看），`details` 是结构化旁路信息（`{ truncation, fullOutputPath }`，`coding-agent/…/bash.ts:47-50`），**只给 UI 用，不进模型上下文**（harness 版 `details` 同型，`agent/…/bash.ts:18-21`）。这个「模型看 text、UI 看 details」的双通道是干净的分层。
- **exit code 不出现在成功回执里**——成功就是 exit 0，模型只看到输出本身。
- **stderr 与 stdout 混流**，模型无法区分哪行来自哪个流。
- **空输出**：harness 版 `outputText || "(no output)"`（`agent/…/bash.ts:155`）；coding-agent 版由 `formatOutput` 的默认参数 `emptyText = "(no output)"` 提供（`coding-agent/…/bash.ts:404`）。

失败路径统一用 `throw`，且都经过 `appendStatus` 把输出和状态行拼起来：

```typescript
// packages/coding-agent/src/core/tools/bash.ts:424
const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;
```

三种状态消息（`coding-agent/…/bash.ts:438-453`）：

| 情形 | 抛出的消息 |
|------|-----------|
| 被 abort | `<output>\n\nCommand aborted` |
| 超时 | `<output>\n\nCommand timed out after ${timeoutSecs} seconds` |
| 非零退出 | `<output>\n\nCommand exited with code ${exitCode}` |

对应测试（`packages/agent/test/harness/tools.test.ts:466-474`）直接断言 `rejects.toThrow(/failed[\s\S]*Command exited with code 7/)`——**输出在前、状态在后**是被测试锁住的契约。

`exitCode === null`（进程被信号杀死）**不算错误**，会走成功分支（`coding-agent/…/bash.ts:451` 的 `&& exitCode !== null`）。harness 版对应 `exitCode !== undefined`（`agent/…/bash.ts:152`）。

### D. 输出量控制

阈值定义与语义注释：

```typescript
// packages/coding-agent/src/core/tools/truncate.ts:1-12
/**
 * Truncation is based on two independent limits - whichever is hit first wins:
 * - Line limit (default: 2000 lines)
 * - Byte limit (default: 50KB)
 */
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
```

- **方向**：bash 用 `truncateTail`（保留末尾），从 `lines.length - 1` 倒着往前收（`truncate.ts:198-217`）；`read` 类工具用 `truncateHead`。注释写明理由：`Suitable for bash output where you want to see the end (errors, final results)`（`truncate.ts:163-164`）。
- **不切半行**，除非最后一行本身就超过字节上限——此时取该行的末尾片段并置 `lastLinePartial = true`（`truncate.ts:193-217`，尤其 `:205-212`）。测试断言此时的提示是 `Showing last 50.0KB of line 1 (line is 58.6KB). Full output: …`（`tools.test.ts:520-531`）。
- **一定告知模型**，三种尾注（`coding-agent/…/bash.ts:408-419`，函数 `formatOutput` 全体在 `:404-422`）：

```typescript
if (truncation.lastLinePartial) {
	text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
} else if (truncation.truncatedBy === "lines") {
	text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
} else {
	text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
}
```

尾注里带**绝对行号区间**（`startLine = totalLines - outputLines + 1`，`coding-agent/…/bash.ts:410`）和临时文件路径——模型于是可以自己 `grep` 那个 temp 文件来找被丢掉的部分。这是「截断不等于信息丢失」的关键设计。

- **内存有界**：`OutputAccumulator`（`core/tools/output-accumulator.ts`）流式累积，只在内存里保留一个「滚动尾巴」，`maxRollingBytes = max(maxBytes * 2, 1)`（`output-accumulator.ts:59`），超了就 `trimTail()` 从头砍并**对齐 UTF-8 边界**（`output-accumulator.ts:174-186` 的 `(buffer[start] & 0xc0) === 0x80` 循环）。原始字节一旦超阈值就转写到 `os.tmpdir()` 下 `pi-bash-<16hex>.log`（`output-accumulator.ts:19-22`, `:205-214`）。**推断**：这套设计的目的是「跑 `yes` 也不会 OOM」。
- **二进制/ANSI 净化**：`sanitizeBinaryOutput` 过滤控制字符（保留 `\t\n\r`）与会让 `string-width` 崩掉的 Unicode format 字符（`utils/shell.ts:135-170`）。`core/bash-executor.ts:80` 还额外 `stripAnsi(...)` 并 `replace(/\r/g, "")`。注意：**tool 版的 `OutputAccumulator` 路径不做 stripAnsi**，harness 版 `shell-output.ts:117` 做 sanitize + 去 `\r` 但也不 stripAnsi——只有用户手输 `!command` 走的 `bash-executor` 才 stripAnsi。

### E. 超时

- **没有默认超时**：schema 描述明写 `no default timeout`（`agent/…/bash.ts:13`），`resolveTimeoutMs(undefined)` 返回 `undefined`，于是不挂 timer（`coding-agent/…/bash.ts:28`, `:117-122`）。
- **模型可以指定**，单位是**秒**（浮点也行，测试用了 `timeout: 0.01`，`tools.test.ts:472`），内部乘 1000 转毫秒。
- **上界校验**：`> 2_147_483_647 ms`（约 24.8 天，`setTimeout` 的 32 位上限）抛 `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`；非有限数或 `<= 0` 抛 `Invalid timeout: must be a finite number of seconds`（`coding-agent/…/bash.ts:27-38`；harness 版 `validateTimeout` 同逻辑，`agent/…/bash.ts:41-49`）。
- **超时动作是 `killProcessTree`，不是 `child.kill()`**：

```typescript
// packages/coding-agent/src/core/tools/bash.ts:117-122
if (timeoutMs !== undefined) {
	timeoutHandle = setTimeout(() => {
		timedOut = true;
		if (child.pid) killProcessTree(child.pid);
	}, timeoutMs);
}
```

```typescript
// packages/coding-agent/src/utils/shell.ts:203-216（Unix 分支）
try {
	process.kill(-pid, "SIGKILL");
} catch {
	try {
		process.kill(pid, "SIGKILL");
	} catch { /* already dead */ }
}
```

直接 `SIGKILL` 负 pid（进程组），**没有 SIGTERM 宽限期**。这是刻意配合 `detached: true` 的——因为 detached spawn 会让 child 成为新进程组组长，所以 `-pid` 才等于「这条命令拉起的所有后代」。

- **超时时输出不丢**：`timedOut` 只是置标志位，仍然 `await waitForChildProcess(child)` 等进程收尾（`coding-agent/…/bash.ts:134-138`），然后在 catch 里 `await finishOutput()` 把已捕获内容拼进错误消息。有专门测试验证超时后 temp 文件里 `line-1` 到 `line-3000` 都在（`tools.test.ts:477-503`）。
- **一个非显然的工程细节**：`waitForChildProcess`（`utils/child-process.ts:37-49`）不在 `exit` 事件上立即 resolve，而是等 stdio 管道静默一段宽限期（`EXIT_STDIO_GRACE_MS = 100`，每来一个 chunk 就重新计时），注释里写明这是修 issue #5303——「短命 child 退出了但 detached 后代还占着 stdout，固定 deadline 会静默丢输出」。

### F. 安全边界

这是 pi-mono 最「放手」的维度：

- **没有命令黑白名单、没有命令解析、没有逐条确认**。全仓在 `packages/coding-agent/src/core` 与 `packages/agent/src` 下 grep `allowedCommands|deniedCommands|forbidden|dangerous|rm -rf` 零命中。命令原样进 `bash -c`。
- **没有沙箱**。仓库里唯一带 sandbox 字样的是 `bun/restore-sandbox-env.ts`，读了内容确认它是「Bun 编译产物在 nono 沙箱里 `process.env` 为空，从 `/proc/self/environ` 恢复」的 workaround（`bun/restore-sandbox-env.ts:1-12` 的文件头注释），**与命令隔离无关**。
- **工作目录不做逃逸防护**。`cd /` 或 `rm -rf ~` 都不会被拦——工具只保证「spawn 时的初始 cwd 是配置的 cwd」（`coding-agent/…/bash.ts:98`），命令自己 `cd` 出去是允许的。对比 write/edit 工具那边有 `resolveToCwd` 路径解析（见 [write-file 调研](../write-file/pi-mono.md)），bash 这边**完全没有对应物**。
- **唯一相关的机制是启动期 project trust**，粒度是「整个项目文件夹」而非「单条命令」：

```typescript
// packages/coding-agent/src/core/project-trust.ts:24-26
function formatProjectTrustPrompt(cwd: string): string {
	return `Trust project folder?\n${cwd}\n\nThis allows pi to load ${CONFIG_DIR_NAME} settings and resources, install missing project packages, and execute project extensions.`;
}
```

措辞里 trust 的对象是「加载 `.pi` 配置 / 装缺失的项目包 / 执行项目扩展」，**不包含 bash 工具调用**。且 `resolveProjectTrusted` 在「项目里没有需要 trust 的资源」时直接返回 `true`（`project-trust.ts:48-51`）。

- **有的是「善后」而非「预防」**：所有 detached child pid 被登记进一个模块级 `Set`（`utils/shell.ts:175-188`），进程退出/信号时 `killTrackedDetachedChildren()` 统一清理（调用点：`interactive-mode.ts:3579,3605,3637`、`print-mode.ts:55`、`rpc-mode.ts:373`）。这防的是「pi 退出后孤儿进程还在跑」，不是防危险命令。

**推断**：pi-mono 的安全模型是「信任本地开发者的 cwd，把风险控制交给用户和 git」。这与 zero2agent 的教学定位一致（S003 不做确认层），但对生产工具是明确的设计取舍。

### G. 特殊命令处理（后台 / 长跑 / 交互式 / 流式）

| 能力 | pi-mono 的做法 |
|------|---------------|
| 后台执行 | **无专门支持**。schema 里没有 `background` 参数，源码里没有 job 表 / task id / 「稍后取结果」的机制。想后台只能靠模型自己写 `cmd &` 或 `nohup`，而这会被 `killProcessTree(-pid)` 在 abort/timeout 时一并杀掉。 |
| 长时间运行 | 靠「无默认超时 + 流式输出 + 可 abort」三件套硬扛：命令可以跑到天荒地老，输出实时进 UI，用户按取消键触发 `AbortSignal`（`coding-agent/…/bash.ts:111-113,127-130`）。 |
| 交互式命令（stdin） | **模型侧不可用**。`stdio[0]` 在正常路径是 `"ignore"`（`coding-agent/…/bash.ts:101`）——需要输入的命令直接读到 EOF。唯一 pipe stdin 的场景是前述 WSL bash 的 `commandTransport === "stdin"`，那是用来传命令本身的，不是给模型灌数据。**源码中没有任何「向运行中进程写 stdin」的接口**。 |
| 流式输出 | **有**，`onUpdate(partialResult)` + 100ms 节流合并（`coding-agent/…/bash.ts:353-383`）。首次先发一个空 update 占位（`:384-386`），跑完再发终态。 |

流式那段的节流逻辑值得单看，因为它是「既不丢最后一帧、又不刷爆终端」的紧凑写法：

```typescript
// packages/coding-agent/src/core/tools/bash.ts:369-383
const scheduleOutputUpdate = () => {
	if (!onUpdate) return;
	updateDirty = true;
	const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
	if (delay <= 0) {
		clearUpdateTimer();
		emitOutputUpdate();
		return;
	}
	updateTimer ??= setTimeout(() => {
		updateTimer = undefined;
		emitOutputUpdate();
	}, delay);
};
```

配合 `acceptingOutput` 布尔闸（`coding-agent/…/bash.ts:388-392`）丢弃「执行已 settle 后迟到的 chunk」——这也有专门测试（`tools.test.ts:504-518`，用一个故意迟到的 `LateOutputExecutionEnv`）。

### H. UI 呈现（`tool-execution.ts` 与 bash 的 `renderResult`）

`modes/interactive/components/tool-execution.ts` 是**通用**的工具执行组件，不含任何 bash 专属逻辑。它做的是分派：

- 优先用扩展提供的 `renderCall`/`renderResult`，回退到内置工具定义的（`tool-execution.ts:80-99`）。
- `updateResult(result, isPartial)`（`tool-execution.ts:164-176`）把流式中间态喂给渲染器，`isPartial` 决定背景色：pending / error / success 三档（`tool-execution.ts:254-259`）。
- 渲染器抛异常时兜底到 fallback 组件（`tool-execution.ts:279-283`、`:296-302`）——扩展写崩了不会带崩 TUI。

bash 专属的呈现在 `coding-agent/…/bash.ts` 自己的两个渲染器里：

- `renderCall` 把调用渲染成 `$ <command>`，带 `(timeout Ns)` 后缀（`formatBashCall`，`:226-233`）。
- `renderResult` 默认**只显示末尾 5 行**（`BASH_PREVIEW_LINES = 5`，`:199`），折叠时提示 `... (N earlier lines, <key> to expand)`（`:275-279`），并显示 `Elapsed 3.2s` / `Took 3.2s`（`:309-313`，运行中每秒 `invalidate` 刷新计时，`:471-473`）。
- 一个巧思：**UI 上把给模型看的那段截断尾注剥掉**，因为 UI 自己会用高亮的 warning 行重新呈现同样信息（`:251-255` 剥离，`:292-307` 重建）。同一份 details，两种受众两种呈现。

## 对 zero2agent 的启发

| 维度 | pi-mono 做法 | zero2agent S003 建议 |
|------|-------------|---------------------|
| 工具参数 | `{ command: string, timeout?: number }` | ✅ **直接照搬**。两个字段就够，不加 `cwd` / `background` / `description` |
| 工具描述 | 一句话讲语义 + 主动声明截断规则和阈值 | ✅ **强烈建议照搬这个套路**。把「输出会被截到 N 行/KB」写进 description，是用一行文本换模型行为收敛 |
| 执行 API | `spawn(shell, ["-c", command])`，不用 `shell: true` | ✅ 采纳。教学版可硬编码 `/bin/bash`，跳过 `getShellConfig` 那 50 行跨平台解析 |
| stdout/stderr | 合并单流 | ✅ 采纳。分流会让回执格式复杂一倍，收益不明显 |
| 退出码 | 非零 → `throw`，且**把输出拼进错误消息** | ✅ **这条是精髓**：错误里必须带输出，否则模型看到 `exit 1` 却不知道为什么 |
| 空输出 | 替换为 `"(no output)"` | ✅ 采纳，一行代码，避免模型面对空字符串困惑 |
| 截断方向 | 保尾（`truncateTail`） | ✅ 采纳。命令输出的信息量在末尾（错误、结论） |
| 截断阈值 | 2000 行 / 50KB，取先命中 | ✅ 数值可直接借用；教学版可先只做单一维度（比如只按行数），双阈值留 backlog |
| 截断告知 | 尾注带绝对行号区间 + temp 文件路径 | ⚠️ 部分采纳：**尾注要有**（告知截断 + 大致规模），但 temp 文件落盘那套 `OutputAccumulator` 太重，S003 可以只写 `[Output truncated: showing last 500 of 3000 lines]` |
| 内存有界累积 | `OutputAccumulator` 滚动尾巴 + UTF-8 边界对齐 + 转写临时文件（220 行） | ❌ **不学**。教学版直接 `output += chunk` 然后末尾一次截断即可；把「无界内存」记进 backlog 更诚实 |
| 默认超时 | **无默认超时** | ⚠️ **建议偏离**：给一个默认值（如 30s 或 120s）。pi-mono 敢不设默认是因为它有实时流式 UI 和随时可按的取消键；zero2agent 教学版没这两样，一个 `sleep 999` 就把循环挂死了 |
| 超时单位 | 秒（浮点合法），内部转毫秒 | ✅ 采纳，秒对模型更自然 |
| 杀进程 | `detached: true` + `process.kill(-pid, "SIGKILL")` | ✅ **建议采纳**，就三行代码，但解决的是真问题：`npm test` 起的子进程不会因为 kill 父 shell 而变孤儿。这是很好的教学点（进程组 vs 单进程） |
| 超时保留输出 | 置标志位，等进程收尾后把输出拼进错误 | ✅ 采纳。「超时了什么都看不到」是很糟的体验 |
| cwd 不存在检查 | spawn 前 `fsAccess` 探测 + 明确错误信息 | ✅ 采纳，五行代码换清晰报错 |
| 持久 shell session | **无**，每次新 spawn | ✅ 与教学版一致。可以在文档里写明「`cd` 不跨调用生效」这个约束 |
| 安全边界 | 无名单、无沙箱、无逐条确认 | ✅ 与「S003 只做正常执行路径」一致。**但要在 spec 里显式写明这是取舍，不是遗漏** |
| 流式输出 + 节流 | `onUpdate` + 100ms 合并 | ⏸️ S003 可暂缓（zero2agent 当前工具回执是一次性 string）。若做，pi 这套 `updateDirty + lastUpdateAt` 的节流写法值得抄 |
| PI_* 环境变量注入 | 先 delete 再按需注入 | ❌ 不学，产品特性 |
| 可插拔 `BashOperations` | 有（为 SSH/远程） | ❌ 过度设计，与 write-file 调研对 `WriteOperations` 的结论一致 |
| 跨平台 shell 解析 | 60 行（Git Bash / WSL / Cygwin / sh 兜底 / stdin transport） | ❌ 不学。教学项目锁定 Unix，`/bin/bash` 硬编码，把跨平台记 backlog |
| 二进制/ANSI 净化 | `sanitizeBinaryOutput` + 部分路径 `stripAnsi` | ⏸️ 建议做**最小版**（滤掉 `\x00-\x1F` 除 `\t\n\r`）。理由不是美观，是「二进制字节进上下文会污染 token 且可能触发 API 报错」 |
| 命令执行串行化 | **无**（`file-mutation-queue` 只管文件写） | ✅ 与教学版一致，不做 |
| UI 折叠 | 默认只显示末尾 5 行，可展开 | 📌 记录：这提示了「给模型的截断」和「给人的截断」是两套独立策略，同一份 `details` 两种呈现 |

**一句话总结**：pi-mono 的 bash 工具本体（去掉流式节流、`OutputAccumulator`、跨平台 shell 解析、TUI 渲染这四块）其实只有约 40 行有效逻辑——**spawn 进程组 → 合并两个流 → 等退出 → 保尾截断 → 非零则把输出拼进 throw**。这五步就是 zero2agent S003 的完整蓝本。唯一建议有意偏离的点是「加一个默认超时」，因为 pi-mono 不设默认超时的前提（实时流式 + 随时取消）zero2agent 当前还不具备。

## 关键源码引用

- `packages/agent/src/harness/tools/bash.ts:1-162`：harness 版 bash 工具全文（schema `:11-14`、description `:57`、超时校验 `:41-49`、截断尾注 `:130-141`、错误分支 `:145-154`）
- `packages/coding-agent/src/core/tools/bash.ts:1-506`：coding-agent 版全文（`createLocalBashOperations` `:82-146`、spawn `:96-107`、超时 kill `:117-122`、env 处理 `:158-184`、工具定义 `:316-458`、TUI 渲染 `:459-495`）
- `packages/coding-agent/src/utils/shell.ts:60-133`：`getShellConfig` shell 解析链、`getShellEnv` PATH 注入
- `packages/coding-agent/src/utils/shell.ts:175-224`：detached pid 追踪与 `killProcessTree`
- `packages/coding-agent/src/core/tools/truncate.ts:11-12,162-230`：截断阈值常量与 `truncateTail`
- `packages/coding-agent/src/core/tools/output-accumulator.ts:1-223`：流式有界累积器 + 临时文件转写
- `packages/coding-agent/src/utils/child-process.ts:37-49`：`waitForChildProcess` 的 stdio 静默宽限期（避免丢输出）
- `packages/agent/src/harness/utils/shell-output.ts:51-195`：harness 版的 `executeShellWithCapture`
- `packages/agent/src/harness/env/nodejs.ts:364-497`：`NodeExecutionEnv.exec`（harness 的实际 spawn 实现）
- `packages/agent/src/harness/types.ts:344-373`：`ShellExecOptions` / `Shell` / `ExecutionEnv` 接口
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts:80-99,164-176,254-283`：通用工具执行组件的渲染器分派与 partial 状态
- `packages/coding-agent/src/core/project-trust.ts:24-26,45-80`：项目级 trust（非命令级）
- `packages/agent/test/harness/tools.test.ts:449-600`：bash 行为的完整测试断言（合流、非零退出、超时保留输出、超长单行、commandPrefix、update 合并）

## 未覆盖 / 未找到的维度

- **后台任务管理**：源码中无 job 表、无 task id、无「稍后取结果」接口。pi-mono 不提供此能力。
- **向运行中进程写 stdin**：源码中无此接口，`stdio[0]` 固定 `"ignore"`。
- **命令黑白名单 / 命令行解析 / 沙箱隔离**：grep 后确认全部不存在。
- **pty / 伪终端**：源码中未找到任何 pty 相关依赖或调用。
- **命令执行的 system prompt 引导文本**：只找到 `promptSnippet`（`bash.ts:328`）与 `promptGuidelines`（`:329-331`）两个短字段；没有找到独立的 bash 使用指南 markdown 或更长的策略文本。

## 参考资料

- [pi-mono write-file 调研](../write-file/pi-mono.md)（`WriteOperations` 可插拔抽象、`file-mutation-queue` 的结论可对照）
- [replace-in-file 横向对比](../replace-in-file/README.md)
