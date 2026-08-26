# Gemini CLI — 终端执行（shell）调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| 调研 Commit | `d76d2d07422176eefbc90676d8d77a7d912a6970` |
| Commit 日期 | `2026-07-23 12:55:34 -0500` |
| 调研日期 | `2026-08-26` |

## 调研目标

为 E02-S003（`terminal` 工具）提供竞品参考：Gemini CLI 的 shell 工具怎么定义契约、怎么执行、怎么控制输出量与超时、安全边界做到哪一层？以及它为 S004（后台/长时任务）预留了什么能力？

> 本文所有结论均标注 `文件:行号`。凡是源码里没找到的维度，明确写「未找到」。凡是我的解读而非代码明写的，标注为「推断」。

## 调研结论

1. **工具名 `run_shell_command`，5 个参数，只有 `command` 必填。** 名称常量在 `definitions/base-declarations.ts:56`；参数 schema 在 `definitions/dynamic-declaration-helpers.ts:85-159`，`required: [command]`（L157）。参数为 `command` / `description` / `dir_path` / `is_background` / `delay_ms`，另有一个仅在 sandbox 开启时才出现的 `additional_permissions`（L120-155）。

2. **工具描述是运行时按平台 + 开关动态生成的，不是静态字符串。** `getShellToolDescription(enableInteractiveShell, enableEfficiency)`（`dynamic-declaration-helpers.ts:36-68`）会根据 `os.platform()` 给出不同文本（Windows 说 `powershell.exe -NoProfile -Command`，POSIX 说 `bash -c`），还会在描述里**把返回字段逐条列给模型**（L48-56）。这是 gemini 的一个明确设计：返回契约写进 description。

3. **执行是双引擎：优先 node-pty，失败降级 `child_process.spawn`。** `ShellExecutionService.execute`（`services/shellExecutionService.ts:356-389`）先试 `executeWithPty`，`catch` 后落到 `childProcessFallback`。PTY 路径带完整 xterm headless terminal（`shellExecutionService.ts:977-983`），非 PTY 路径是 `stdio: ['ignore','pipe','pipe']` + `detached`（L583-590）。

4. **stdout/stderr 合并成一个 `output` 字段，非零退出不是错误而是普通回执。** `childProcessFallback` 里 stdout / stderr 两个 handler 都往同一个 `state.output` 追加（L813-814 → L690-700）；工具层组装 `Output: ... / Exit Code: ... / Signal: ...` 的多行文本（`tools/shell.ts:802-830`）。**只有进程级错误（spawn 失败）才写 `error.type = SHELL_EXECUTE_ERROR`**（`shell.ts:1013-1019`），退出码非零仅作为文本字段 + `data.isError`（L813-817）。

5. **超时是「无输出超时」（inactivity timeout），默认 5 分钟，模型不能指定。** `config.ts:1303-1304`：`(params.shellToolInactivityTimeout ?? 300) * 1000`。它在**每一个输出事件上重置计时器**（`shell.ts:582-591` 的 `resetTimeout`，在事件回调首行调用，L605）。超时不是「总时长上限」而是「静默上限」——这是与多数实现不同的关键差异。schema 里没有 timeout 参数（`dynamic-declaration-helpers.ts:95-156`）。

6. **命令注入是硬拦截：检测到命令替换直接拒绝执行。** `shell.ts:468-478`：`detectCommandSubstitution` 命中就返回一段固定的拒绝文本，**连 spawn 都不发起**。检测器是手写的引号状态机（`utils/shell-utils.ts:1095-1142` bash 版、L1148-1194 PowerShell 版），逐字符跟踪单/双引号与反斜杠转义，命中 `$(`、`` ` ``、`<(`、`>(` 即返回 true。

7. **权限走独立的 PolicyEngine + TOML 规则，`ApprovalMode` 只有 4 档。** `policy/types.ts:48-53`：`DEFAULT` / `AUTO_EDIT` / `YOLO` / `PLAN`。**值得注意：`AUTO_EDIT` 不放行 shell**——`policies/write.toml` 里 `replace` / `write_file` 都有 `modes = ["autoEdit"]` 的 allow 规则（L36-40、L65-69），但 `run_shell_command` 只有一条 `decision = "ask_user"`（L47-51），没有 autoEdit 豁免。语义是「自动改文件可以，自动跑命令不行」。

8. **「本会话都允许 npm test」这类记忆确实有，实现方式是把根命令转成 argsPattern 正则规则。** 用户选 `ProceedAlways` / `ProceedAlwaysAndSave` 时，`getPolicyUpdateOptions`（`shell.ts:253-270`）提取**根命令集合**作为 `commandPrefix`；`policy/utils.ts:56-90` 的 `buildArgsPatterns` 把它编译成匹配 `"command":"git` 这类 JSON 片段的正则，再 `policyEngine.addRule`（`policy/config.ts:726-757`）。持久化与否由 `persistScope: 'workspace' | 'user'` 决定（`confirmation-bus/types.ts:149`）。

9. **工作目录逃逸有硬校验，两处。** 参数校验期：`shell.ts:1120-1131` 的 `validateToolParamValues` 对 `dir_path` 做 `path.resolve(targetDir, dir_path)` 后 `config.validatePathAccess`；执行期再校验一次并返回 `PATH_NOT_IN_WORKSPACE`（`shell.ts:511-527`）。**但这只管 cwd，命令内容本身能访问任何路径——逃逸防护靠 sandbox（可选）而非工具层。**

10. **后台能力（对应 S004）分三块：`is_background` 参数、两个独立工具、以及一层 PID 追踪 wrapper。** 独立工具是 `list_background_processes` 和 `read_background_output`（`tools/shellBackgroundTools.ts:74`、L253），注册在 `config.ts:4002-4011`。**没有 kill 工具**——`ShellExecutionService.kill` 存在（`shellExecutionService.ts:1407`）但只被 UI 层用，没暴露给模型（推断：全仓 grep `kill_background` 无结果）。

11. **整体重量：`shell.ts` 1160 行 + `shellExecutionService.ts` 1626 行 + `shell-utils.ts` 1197 行 ≈ 4000 行，是 edit 工具（726 行）的 5 倍。** 但重的地方**不在执行本身**，而在 sandbox 权限协商（`shell.ts:272-386` + 执行后的 denial 启发式 L860-1000，约占 shell.ts 一半）、PTY 渲染节流、以及跨平台 shell 差异。纯执行逻辑其实不到 100 行。

## 详细分析

### A. 工具契约

工具名 `run_shell_command`：

```typescript
// packages/core/src/tools/definitions/base-declarations.ts:56-58
export const SHELL_TOOL_NAME = 'run_shell_command';
export const SHELL_PARAM_COMMAND = 'command';
export const SHELL_PARAM_IS_BACKGROUND = 'is_background';
```

参数表（源：`dynamic-declaration-helpers.ts:95-157`）：

| 参数 | 类型 | 必填 | 默认 | 说明（原文摘要） |
|------|------|------|------|-----------------|
| `command` | string | ✅ | — | `Exact bash command to execute as \`bash -c <command>\``（Windows 换成 powershell 文案，L72-77） |
| `description` | string | ❌ | — | 给用户看的简述，`No line breaks.` |
| `dir_path` | string | ❌ | project root | `Must be a directory within the workspace and must already exist.` |
| `is_background` | boolean | ❌ | false | 长时服务/watcher 用；先起进程、观察一下、再转后台 |
| `delay_ms` | integer | ❌ | 200（`shell.ts:65`） | 转后台前等待多久，让进程产出初始输出 |
| `additional_permissions` | object | ❌ | — | **仅 `enableToolSandboxing` 为 true 时才加入 schema**（L120-155） |

description 全文（POSIX 分支，`dynamic-declaration-helpers.ts:64-67`，含 `enableEfficiency` 与 `returnedInfo` 拼接段）：

```
This tool executes a given shell command as `bash -c <command>`. To run a command
in the background, set the `is_background` parameter to true. Do NOT use `&` to
background commands. Command is executed as a subprocess that leads its own
process group. Command process group can be terminated as `kill -- -PGID` or
signaled as `kill -s SIGNAL -- -PGID`.

      Efficiency Guidelines:
      - Quiet Flags: Always prefer silent or quiet flags (e.g., `npm install --silent`,
        `git --no-pager`) to reduce output volume while still capturing necessary information.
      - Pagination: Always disable terminal pagination to ensure commands terminate
        (e.g., use `git --no-pager`, `systemctl --no-pager`, or set `PAGER=cat`).

      The following information is returned:

      Output: Combined stdout/stderr. Can be `(empty)` or partial on error and for
              any unwaited background processes.
      Exit Code: Only included if non-zero (command failed).
      Error: Only included if a process-level error occurred (e.g., spawn failure).
      Signal: Only included if process was terminated by a signal.
      Background PIDs: Only included if background processes were started.
      Process Group PGID: Only included if available.
```

三点值得抄：**（1）** 描述里明确告诉模型「后台请用参数，不要自己写 `&`」；**（2）** 「Efficiency Guidelines」把 `--no-pager` / `PAGER=cat` 这类降噪要求写进 prompt；**（3）** 返回字段逐条声明，且注明「哪些字段只在特定条件下出现」，模型不必猜。

`getSchema()` 还会按 modelId 走 override（`shell.ts:1147-1155` → `definitions/coreTools.ts:241-258`），但实测 gemini-3 家族的 override 就是直接调同一个 `getShellDeclaration`（`model-family-sets/gemini-3.ts:345-354`），即**当前没有模型专属差异**。

### B. 执行机制

**Shell 选择**（`utils/shell-utils.ts:658-702`）：

```typescript
// packages/core/src/utils/shell-utils.ts:698-701
  // Unix-like systems (Linux, macOS)
  return { executable: 'bash', argsPrefix: ['-c'], shell: 'bash' };
```

Windows 侧逻辑更绕：先看 `ComSpec` 是否指向 powershell/pwsh，再优先找 `pwsh.exe`（`-NoProfile -Command`），最后退回 `powershell.exe`（`-NoProfile -NonInteractive -Command`）。代码注释解释了原因：PowerShell 5.1 会吞掉参数里的双引号（issue #25859），`-NonInteractive` 是为了避免 PSReadLine 抢 ConPTY 的输入（L659-666、L671-674）。**没有读 `$SHELL`——POSIX 下硬编码 bash。**

**spawn 方式**（`shellExecutionService.ts:583-590`）：

```typescript
const child = cpSpawn(finalExecutable, finalArgs, {
  cwd: finalCwd,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsVerbatimArguments: isWindows ? false : undefined,
  shell: false,
  detached: !isWindows && !isBun,
  env: finalEnv,
});
```

注意 `shell: false` + 显式传 `bash -c <cmd>`：**不用 Node 的 `shell: true`，而是自己拼 argv**。`detached: true` 让子进程成为进程组组长，方便后面按 `-pid` 整组杀；Bun 下禁用（注释说 Bun 的 `child_process` 不正确调 `setsid()`，会立刻收 SIGHUP，L576-581）。`stdio[0]` 是 `'ignore'`——**非 PTY 路径下 stdin 直接关掉**，交互式命令只能走 PTY 路径。

**命令包了两层 wrapper：**

第一层在工具里，为了抓后台 PID（`shell.ts:121-137`）：

```typescript
// packages/core/src/tools/shell.ts:132-136
const escapedTempFilePath = escapeShellArg(tempFilePath, 'bash');
return `_bgpids_file=${escapedTempFilePath}\n(\n  trap 'jobs -p > "$_bgpids_file"' EXIT\n${trimmed}\n)\n__code=$?\nexit $__code`;
```

把用户命令塞进子 shell，用 `EXIT` trap 把 `jobs -p` 的结果写到临时文件，执行完再读回来报给模型（`shell.ts:731-771`）。临时目录是 `fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-shell-'))`（L502）；Windows 直接跳过这层包装（L122-124）。用 `\n` 而非 `;` 分隔是为了不破坏 heredoc 和行尾注释（函数 doc 注释 L108-111）。**`__code=$?; exit $__code` 是为了让子 shell 的退出码透传出来**（测试 `shell.test.ts:345-366` 验证了 `sh -c 'sleep 60 & exit 1'` 仍报 `Exit Code: 1`）。

第二层在服务里（`shellExecutionService.ts:68-82`），bash 下强制前置 `shopt -u promptvars nullglob extglob nocaseglob dotglob;`；Windows PTY 下前置 `chcp 65001` 修 ConPTY 的代码页 mojibake（L100-116，注释里连 microsoft/terminal 的源码行号都引了）。

**环境变量**（`shellExecutionService.ts:462-522`）：先经 `sanitizeEnvironment` 白/黑名单脱敏（`services/environmentSanitization.ts:13-50`，在 CI（`GITHUB_SHA` 存在）下强制严格模式），然后叠加：

```typescript
// packages/core/src/services/shellExecutionService.ts:485-491
const baseEnv = {
  ...sanitizedEnv,
  [GEMINI_CLI_IDENTIFICATION_ENV_VAR]: '1',   // 即 GEMINI_CLI=1
  TERM: 'xterm-256color',
  PAGER: shellExecutionConfig.pager ?? 'cat',
  GIT_PAGER: shellExecutionConfig.pager ?? 'cat',
};
```

非交互模式下还会注入一整套「禁止弹凭据框」的变量：`GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=''` / `SSH_ASKPASS=''` / `GH_PROMPT_DISABLED=1` / `GCM_INTERACTIVE=never` / `DISPLAY=''` / `DBUS_SESSION_BUS_ADDRESS=''`，并追加一条 `GIT_CONFIG_KEY_n=credential.helper` + 空值来禁用 git 凭据助手（L505-521）。**这一组是防「命令挂在密码提示上不返回」的实战经验，很值得记录。**

**cwd**（`shell.ts:511-513`）：`dir_path` 给了就 `path.resolve(targetDir, dir_path)`，否则 `config.getTargetDir()`。注意是 `resolve(targetDir, ...)` 而非 `resolve(process.cwd(), ...)`——相对路径以 workspace 根为基准。

### C. 返回契约

回执是**纯文本多行拼接**，不是 JSON（尽管 `docs/tools/shell.md:41-48` 说返回 JSON 对象且字段名叫 `Stdout`/`Stderr`/`Directory`——**文档与代码不一致，代码里没有这些字段**，实际是 `Output` 单字段合流）：

```typescript
// packages/core/src/tools/shell.ts:802-830
const llmContentParts = [`Output: ${result.output || '(empty)'}`];
if (result.error) {
  const finalError = result.error.message.replaceAll(commandToExecute, this.params.command);
  llmContentParts.push(`Error: ${finalError}`);
}
if (result.exitCode !== null && result.exitCode !== 0) {
  llmContentParts.push(`Exit Code: ${result.exitCode}`);
  data = { exitCode: result.exitCode, isError: true };
}
if (result.signal) {
  llmContentParts.push(`Signal: ${result.signal}`);
}
if (backgroundPIDs.length) {
  llmContentParts.push(`Background PIDs: ${backgroundPIDs.join(', ')}`);
}
if (result.pid) {
  llmContentParts.push(`Process Group PGID: ${result.pid}`);
}
llmContent = llmContentParts.join('\n');
```

要点：

- **字段按需出现**：exit code 为 0 时不写 `Exit Code` 行。这与 description 里的声明一致。
- **信号单独表达**：`Signal: <num>` 是独立行；signal 在服务层被转成数字（`shellExecutionService.ts:752-755`，`os.constants.signals[signal]`）。
- **错误消息里的 wrapper 被替换回原命令**：`result.error.message.replaceAll(commandToExecute, this.params.command)`（L807-808）——不让模型看到 `_bgpids_file=... trap ...` 这堆内部包装。测试 `shell.test.ts:546-571` 验证了这点。
- **非零退出 ≠ 工具错误**：`error` 字段只在 `result.error` 存在时设置，类型 `SHELL_EXECUTE_ERROR`（`shell.ts:1013-1019`）。退出码走 `data.isError`（UI 用），模型侧只是文本。
- **回执整体被包进 `<untrusted_context>`**（`shell.ts:1043`，实现在 `utils/textUtils.ts:189-195`）：命令输出被显式标记为不可信数据，防 prompt injection。这是个便宜且有效的护栏。

取消 / 超时有专门分支（`shell.ts:776-791`）：

```typescript
timeoutMessage = `Command was automatically cancelled because it exceeded the timeout of ${(timeoutMs / 60000).toFixed(1)} minutes without output.`;
// ...
if (result.output.trim()) {
  llmContent += ` Below is the output before it was cancelled:\n${result.output}`;
} else {
  llmContent += ' There was no output before it was cancelled.';
}
```

**即使被杀也把已产出的输出交给模型**，并明说「这是被杀之前的输出」。

### D. 输出量控制

三层截断，阈值各不相同：

| 层 | 阈值 | 策略 | 告知模型？ |
|----|------|------|-----------|
| 服务层结果缓冲（child_process） | 16 MB（`shellExecutionService.ts:49`） | 保尾去头（`appendAndTruncate`，L392-419） | ✅ 追加 `[GEMINI_CLI_WARNING: Output truncated. The buffer is limited to 16MB.]`（L743-749） |
| PTY scrollback | 300,000 行（`shellExecutionService.ts:66`） | xterm 环形缓冲自然丢头部 | ❌ 未找到告知 |
| 工具层实时预览缓冲 | 100,000 字符（`shell.ts:62`） | 保尾去头（`trimLiveOutputBuffer`，L70-83） | ❌（这是 UI 预览，不进 llmContent） |

`SCROLLBACK_LIMIT = 300000` 的注释直说了动机：「We want to allow shell outputs that are close to the context window in size」（L64-66）。也就是**gemini 有意不在工具层做小额截断，而是把整段输出塞给模型**。

`trimLiveOutputBuffer` 里有个细节：切片起点如果落在 UTF-16 低位代理上就 +1，避免切出半个 emoji（`shell.ts:74-81`）。

**可选的 LLM 摘要**是第四层：若配置里为 `run_shell_command` 开了 `summarizeToolOutput`，回执会先过一遍摘要模型再交给主模型（`shell.ts:1020-1035` → `utils/summarizer.ts:79-99`，目标长度 `maxOutputTokens ?? 2000`）。默认是否开启我**未找到**（`getSummarizeToolOutputConfig` 的默认值没查）。

**二进制输出有专门处理**：前 4096 字节做嗅探（`shellExecutionService.ts:662-687`），`isBinary()` 命中就发 `binary_detected` 事件、停止累积文本、改为汇报字节数（`shell.ts:626-641`）：

```typescript
// packages/core/src/tools/shell.ts:626-641
case 'binary_detected':
  isBinaryStream = true;
  cumulativeOutput = '[Binary output detected. Halting stream...]';
  ...
case 'binary_progress':
  cumulativeOutput = `[Receiving binary output... ${formatBytes(event.bytesReceived)} received]`;
```

**编码**：stdout / stderr 各一个 `new TextDecoder('utf-8')` 流式解码（L666-669），进程结束时 flush 尾部残留字节（L822-866 的 `cleanup()`）。**这解决了「多字节字符被 chunk 边界切开变乱码」的经典问题。** ANSI 转义序列在最终结果里被 `stripAnsi` 去掉（L750），但 PTY 路径会额外保留一份结构化 `ansiOutput` 给 UI 上色（L1269-1292）。

### E. 超时

- **默认 300 秒 = 5 分钟**，且语义是「无输出 300 秒」：`config.ts:1303-1304` `(params.shellToolInactivityTimeout ?? 300) * 1000`（`config.test.ts:1444` 断言 `300000`）。
- **模型不能指定**：schema 无 timeout 字段。
- **计时器在每个输出事件上重置**：`shell.ts:582-591` 定义 `resetTimeout`，`shell.ts:598-601` 的事件回调第一行就调它。`timeoutMs <= 0` 视为禁用（L583-585）。
- **超时通过 AbortController 传导，不直接杀进程**：`timeoutController.abort()` → 合流到 `combinedController` → 服务层的 `abortHandler` 执行杀进程（`shell.ts:571-580`、L592-597）。
- **杀进程是完整的进程树 + 信号升级序列**（`utils/process-utils.ts:37-147`）：
  1. 用 `pgrep -P` 递归枚举所有后代（L58-79）；
  2. 先 `process.kill(-pid, SIGTERM)` 杀整组，再逐个 pid 杀（L86-101）；
  3. 等 `SIGKILL_TIMEOUT_MS = 200` ms（L11-12），若仍未退出，重复 SIGKILL（L110-134）；
  4. Windows 走 `taskkill /pid <pid> /f /t`（L48-55）。
  
  这套是 `escalate: true` 才启用的（`shellExecutionService.ts:808-813`、L1326-1332）；不带 escalate 时默认直接 SIGKILL（`process-utils.ts:85`）。

### F. 安全边界

这块是 Gemini 最重的部分，分五层。

**1. 命令解析：真 parser，不是正则。** `parseCommandDetails`（`shell-utils.ts:614-640`）按平台分派：bash 走 tree-sitter（`loadBashLanguage`，L132-164；`PARSE_TIMEOUT_MICROS = 1e6`，L193），PowerShell 走一段 base64 嵌入的 PS 解析脚本（L197+），PS 解析失败时降级到 bash parser（L622-631）。基于 parser 的能力：

- `getCommandRoots(command)`（L826-840）：返回**所有**子命令的根名，`git status && npm test` → `['git','npm']`，并过滤掉重定向节点。
- `hasRedirection(command)`（L751+）：先用 `/[><]/` 快筛，命中再用 parser 精判。
- `stripShellWrapper(command)`（L842-891）：剥掉 `bash -c "..."` / `powershell -Command "..."` 这类包装，拿到真正的内层命令。**这是防「用 wrapper 绕过白名单」的关键一步**，工具在 confirm 和 execute 两处都先剥（`shell.ts:260`、L389、L466）。

**2. 命令替换硬拦截**（前述结论 6）。注意它是**执行期**拦截而非参数校验期，返回的是普通 `llmContent`（无 `error` 字段），也就是说模型看到的是一条「被拒绝」的普通回执（`shell.ts:468-478`）。

**3. `ApprovalMode` 四档 + TOML 规则表。** 语义（`policy/types.ts:48-65`，permissiveness 从低到高 `PLAN < DEFAULT < AUTO_EDIT < YOLO`）：

| 模式 | 对 shell 的效果 | 依据 |
|------|----------------|------|
| `PLAN` | **禁止**。`toolName = "*"` catch-all deny，denyMessage 明说「Execution of scripts (including those from skills) is blocked」 | `policies/plan.toml:74-79` |
| `DEFAULT` | **每次询问**（交互式）；非交互式直接 deny | `policies/write.toml:47-51`、L89-100 |
| `AUTO_EDIT` | **仍然询问**——没有 autoEdit 豁免规则 | `write.toml` 中 `run_shell_command` 无 `modes = ["autoEdit"]` 条目（对比 L36-40 的 `replace`） |
| `YOLO` | 全放行（`toolName="*"` allow, priority 998, `allowRedirection = true`），但 `ask_user` 仍问、plan mode 切换仍 deny | `policies/yolo.toml:33-56` |

`shell.ts:273-275` 里 YOLO 直接短路掉整个 sandbox 协商逻辑。

**4. 黑白名单 + 危险命令启发式。** `PolicyEngine.applyShellHeuristics`（`policy/policy-engine.ts:305-341`）：

```typescript
if (this.sandboxManager.isDangerousCommand(parsedArgs)) {
  if (this.approvalMode === ApprovalMode.YOLO) return decision;  // YOLO 不降级
  return PolicyDecision.ASK_USER;                                 // 否则强制询问
}
if (this.sandboxManager.isKnownSafeCommand(parsedArgs) && decision === PolicyDecision.ASK_USER) {
  return PolicyDecision.ALLOW;                                    // 已知安全则免问
}
```

- **白名单**（`sandbox/utils/commandSafety.ts:147-179` 的 `isSafeToCallWithExec` 内 `safeCommands` 集合）：28 个只读命令 `cat cd cut echo expr false grep head id ls nl paste pwd rev seq stat tail tr true uname uniq wc which whoami numfmt tac` + `__read`/`__write` 内部标记。对 `base64` / `find` / `rg` / `git` / `sed` 做**逐参数深检**（例：`sed -n` 的脚本参数必须形如 `10p` 或 `5,10p`，L412-435；`git branch` 只有纯列举 flag 才算只读，L383-409）。白名单还支持 `bash -c "..."` 形式：拆分子命令要求**每一个**都在白名单里，且脚本里不能出现 `()<>`（L103-135）。
- **黑名单**（同文件 L447+）：`rm -f/-rf/-fr`、`sudo`（递归判断其后命令）、`find -exec/-delete/...`、`rg --pre/--search-zip`（能借解压器执行任意程序）、`git` 带 config 覆盖全局选项等。

  推断：这里的粒度说明 gemini 的安全模型是「不信任 flag」——同一个根命令（`rg`、`git`、`find`）既可能安全也可能危险，取决于参数。

**5. 重定向降级：`>` 一律降级为询问。** `shouldDowngradeForRedirection`（`policy-engine.ts:284-301`）：有重定向且未显式 `allowRedirection` 时，把 ALLOW 降为 ASK_USER（AUTO_EDIT / YOLO 除外）。语义清晰：**读命令一旦带 `>` 就变成写操作**。`checkShellCommand`（L342-495）会对复合命令**逐子命令递归校验**，任一子命令 DENY 则整体 DENY，任一 ASK_USER 则整体 ASK_USER；parser 失败时 fallback 到 `defaultDecision`（非 YOLO 下即 ASK_USER / DENY，L349-395）——**解析不出来就不敢放行**。

**6. 「记住这个命令」的实现。** 见结论 8。补充两个细节：一是**降级到根命令粒度**——用户同意一次 `git status`，记下来的是 `commandPrefix: ['git']`（`shell.ts:258-267` 取 `getCommandRoots` 结果）；`allowRedirection` 只在原命令确实带重定向时才置 true（L260）。二是 `TOOLS_REQUIRING_NARROWING` 机制：对敏感工具，没有 `commandPrefix` 就拒绝写入 always-allow 规则（`policy/config.ts:734-739`）。

**7. 工作目录逃逸。** 见结论 9。工具层只校验 `dir_path`，**命令内容能读写任何路径**。真正的文件系统隔离靠可选 sandbox（macOS seatbelt / Linux / Windows 各一套 `SandboxManager`），`shell.ts:272-386` 的一大半代码是在做「命令可能需要网络/额外路径 → 提前向用户申请权限」的协商，执行失败后还会用 `parseDenials` 猜是不是被沙箱拒了，然后把需要的路径**归并简化**后再申请一次（`shell.ts:860-1000`，`simplifyPaths` L165-241 会做「同父目录 ≥3 个子路径就合并成父目录，但敏感目录如 `/etc` `~` 不合并」）。

### G. 特殊命令处理（S004 相关）

**后台执行三件套：**

1. **`is_background` 参数**（`shell.ts:707-728`）：正常起进程 → 等 `delay_ms`（默认 200ms）→ 若仍在跑，`ShellExecutionService.background(pid, ...)` 并立刻返回 `Command is running in background. PID: ${pid}. Initial output:\n${cumulativeOutput}`。若在延迟内就跑完了，则按普通命令返回完整结果。**这个「先跑一小会儿看会不会立刻失败」的设计很实用**——避免模型把一个启动就崩的服务当成「已在后台运行」。

2. **`list_background_processes`**（`shellBackgroundTools.ts:71-102`）：无参数，返回每行 `- [PID 123] RUNNING: \`npm run dev\` (Exit Code: 0)`。数据源是按 sessionId 隔离的内存 Map，上限 100 条、FIFO 淘汰（`shellExecutionService.ts:1450-1462`）。

3. **`read_background_output`**（`shellBackgroundTools.ts:249-292`）：参数 `pid`（必填）/ `lines`（默认 100）/ `delay_ms`。实现值得注意：
   - **先验证 pid 属于当前 session**，否则 `Access denied.`（L138-152）；
   - **只读文件尾部 64KB**（`MAX_BUFFER_LOAD_CAP_BYTES`，L22）：`position = size - readSize` 后 seek 读取，且若 `position > 0` 就丢掉第一行（可能是半行，L196-199）；
   - **用 `O_NOFOLLOW` 打开日志文件**，`ELOOP` 时返回「检测到符号链接，拒绝访问」（L165-168、L219-231）——防符号链接攻击；
   - header 明确告知截断：`Showing last ${n} of ${total} lines:`（L205-208）。

   日志文件本身是 `background()` 时创建的 write stream，路径 `<globalTempDir>/background-processes/background-<pid>.log`，目录权限 `0o700`，`flags: 'wx'`（不覆盖已有文件）（`shellExecutionService.ts:1465-1479`、L320-322）。写入前 `stripAnsi`（L324-332）。

4. **没有 kill 工具**：`ShellExecutionService.kill` 只被 UI 调用；模型侧的 grep 无 `kill_background` 之类工具。**这意味着模型只能起后台进程和读输出，不能主动收回——推断这是有意的安全取舍。**

**后台进程完成通知**：`backgroundCompletionBehavior` 三档 `'inject' | 'notify' | 'silent'`（默认 `'silent'`，`config.ts:1270-1274`）。`inject` 会把 `[Background command completed successfully. Output saved to <path>]` + 前 5000 字符输出主动注入对话（`shellExecutionService.ts:303-319`）。

**交互式命令 / stdin**：只有 PTY 路径支持。`ShellExecutionService.writeToPty(pid, input)`（L1379-1381）由 UI 组件调用（`packages/cli/src/ui/components/ShellInputPrompt.tsx:31`、`BackgroundTaskDisplay.tsx:192-198` 转发按键）。**模型没有任何工具能写 stdin**——非 PTY 路径 `stdio[0]` 直接是 `'ignore'`（L585）。PTY 是否启用取决于 `isInteractiveShellEnabled()`：需要同时满足「CLI 处于交互模式」+「未强制 child_process」+「设置开启」（`config.ts:3631-3637`）。

**流式输出**：有。工具层节流到 `OUTPUT_UPDATE_INTERVAL_MS = 1000` ms 一次（`shell.ts:61`），首个 chunk 立即刷、之后按间隔刷，并有 trailing flush 保证最后一段不丢（`flushOutput` L551-561、`scheduleTrailingFlush` L563-580）。但这是给 UI 的 `updateOutput` 回调，**不是流给模型的**——模型只在命令结束时收到一次完整回执。

## 对 zero2agent 的启发

| 维度 | Gemini 做法 | S003 建议 |
|------|------------|-----------|
| 工具名 | `run_shell_command` | 项目已定 `terminal`；名字不是重点 |
| 必填参数 | 只有 `command` | 🔑 **照抄**：只有 `command` 必填，其余可选 |
| description 声明返回字段 | 逐条列 `Output/Exit Code/Signal/...`，并注明「仅在 X 时出现」 | 🔑 **首选借鉴**，成本近乎零、收益直接：模型不用猜回执结构 |
| description 塞降噪规则 | Efficiency Guidelines（`--no-pager`、`PAGER=cat`） | ✅ **建议采纳**：一段话换来大量 token 节省 |
| 执行方式 | `spawn('bash', ['-c', cmd], { shell: false })` | 🔑 **照抄这个形态**：显式 argv 比 `shell: true` 可控 |
| PTY | node-pty 优先 + 降级 | ❌ 太重（交互式/TUI 才需要），S003 不做 |
| cwd | `resolve(targetDir, dir_path)` + `validatePathAccess` 硬拒绝 | 🔑 复用 S001 已建立的 `resolveInsideCwd` 硬拒绝 |
| stdout/stderr | 合并成单个 `Output` 字段 | 💡 教学上**分开更清晰**（`stdout` / `stderr` 两段），是有意的偏离 |
| 非零退出 | 普通回执（文本里带 `Exit Code`），非工具错误 | 🔑 **照抄**：只有 spawn 失败才算工具错误 |
| 信号 | 单独 `Signal:` 行 | ✅ 低成本，建议采纳 |
| 输出截断 | 16MB 保尾 + 明确告知模型 | ✅ 采纳**策略**（保尾 + 告知），但阈值调小（如 30–50KB，教学项目不需要塞满 context） |
| 编码 | 流式 `TextDecoder` + 结束时 flush | 🔑 **值得讲**：这是「输出乱码」bug 的正解，且只有 3 行代码 |
| 二进制检测 | 前 4KB 嗅探 + 停止累积 | ⏸️ 记 backlog，主线不做 |
| 超时语义 | **无输出超时**（inactivity），默认 5 分钟，模型不可指定 | 💡 **值得讨论**：inactivity 比总时长更贴合真实场景（`npm install` 慢但一直有输出），但实现要多一个 resetTimeout；教学上可先做总时长，把 inactivity 记 backlog 并说明理由 |
| 杀进程 | 进程组 + pgrep 枚举后代 + SIGTERM→200ms→SIGKILL | ✅ 采纳**简化版**：`detached: true` + `process.kill(-pid, 'SIGTERM')`，200ms 后 SIGKILL。递归 pgrep 太重 |
| 禁止凭据弹窗的 env | `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=''` / `DISPLAY=''` 等一整套 | 🔑 **强烈建议采纳**：几行常量，直接消灭「命令挂住不返回」这类最难排查的问题 |
| `PAGER=cat` / `TERM` | 注入环境变量 | 🔑 同上，一行换一类 bug |
| 回执包 `<untrusted_context>` | 是 | 💡 **有意思的教学点**：命令输出是外部不可信数据，一个 wrap 就能降低 prompt injection 风险 |
| 命令替换拦截 | 手写引号状态机，检测 `$()` / 反引号 / `<()` | ⚠️ **不适合 S003**：会拦掉大量正常命令（`echo $(date)`），gemini 敢这么做是因为它有 sandbox 兜底 |
| 命令解析（tree-sitter） | 提取根命令、判重定向、剥 wrapper | ❌ 太重，不学。教学上可讲「为什么正则提根命令不可靠」 |
| 黑白名单 | 28 命令白名单 + 逐 flag 深检 + 危险命令表 | ❌ 太重（`commandSafety.ts` 536 行），不做。但**「同一根命令因 flag 不同而危险」这个洞察值得写进文档** |
| ApprovalMode | 4 档 + TOML 规则引擎 + always-allow 持久化 | ⚠️ 需框架级支持，S003 主线不做；可记 backlog |
| AUTO_EDIT 不豁免 shell | 自动改文件可以，自动跑命令不行 | 💡 **值得记录的产品判断**：写文件可回滚，跑命令不可 |
| 重定向降级 | `>` 一律降级为询问 | 💡 **洞察**：「读命令带 `>` 就变成写命令」，权限判断不能只看根命令 |
| 后台执行 | `is_background` + 2 个独立工具 + PID trap wrapper | ⏸️ 这是 **S004** 的事。记录要点：先跑 `delay_ms` 观察再转后台；日志落盘 + 读尾部；只给「起/查/读」不给「杀」 |
| stdin / 交互式 | 只有 PTY 路径支持，且只由 UI 驱动，**模型无法写 stdin** | 💡 **重要参照**：连 gemini 都不给模型 stdin 能力。S003 明确「不支持交互式命令」是符合行业实践的 |

**一句话总结重量分布**：Gemini 的 shell 加起来约 4000 行，但「起进程 → 收输出 → 组装回执」这条正常路径不到 100 行。剩下的全花在 ①可选 sandbox 的权限协商与失败重试（约 shell.ts 一半）、②PTY / 跨平台 shell 差异、③基于真 parser 的命令白黑名单。zero2agent 只做正常路径的话，**该抄的是 description 契约、env 注入、编码处理、进程组杀死这四件小事**，而不是安全策略体系。
