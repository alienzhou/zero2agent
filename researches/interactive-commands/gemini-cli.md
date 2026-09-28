# Gemini CLI：人可向 PTY 输入，模型只有启动与后台观察

## 基本信息

| 项目 | 值 |
|------|-----|
| 官方仓库 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| 调研 Commit | `2fe7c2d3f065dc40ad573d50b2091116f8a4aa18` |
| Commit 日期 | 2026-09-25 22:50:05 +0000 |
| 分支 | main；origin/HEAD → origin/main |
| 最近 Tag | N/A；深度 100 快照中 describe 无名称，不等于远端没有发布 tag |
| 调研日期 | 2026-09-28（Asia/Shanghai） |
| 观测时间 | 主机 2026-09-28T15:53:30Z 起；快照日期未晚于用户当日 |
| 旧 snapshot | `d76d2d07422176eefbc90676d8d77a7d912a6970` |
| 证据等级 | S：固定源码与测试文本确认；未端到端运行产品、未执行测试 |

## 调研目标

服务 E02-S004 的交互式命令设计：追踪模型工具、PTY 配置、前后台输入路由、输出消费和资源回收。
重点分开“用户通过 CLI 操作终端”与“模型通过工具继续写 stdin”。

## 调研结论

1. **模型可以启动命令、后台化、列进程、读后台输出，但没有内置 stdin 续写/EOF 工具。** 人通过 ShellInputPrompt 或后台面板写 PTY，不经过模型参数。
2. **pipe 分支的 writeInput 是容易误判的空通道。** 注册回调会尝试 child.stdin.write，但 spawn 明确 stdio[0] = ignore；常规 Node 子进程下 child.stdin 为 null。
3. **交互式 PTY 是条件启用，不是所有 CLI 模式默认可用。** CLI setting 默认 true；core Config 缺省 false；最终还要求 interactive 且 ptyInfo 非 child_process。
4. **后台化 resolve 工具 promise，不等于 OS 进程退出。** 执行服务继续持有进程与日志；默认 silent，不自动向模型补送完成输出。
5. **真实变化集中于资源回收。** 相较旧 SHA，scrollback 从 300000 降至 50000，并增加 PTY FD/Windows 退出修复；没有新增模型写输入契约。

## 能力与可达性

| 能力 | 源码/注册 | 默认与前提 | 验证 |
|------|-----------|------------|------|
| run_shell_command | 内置注册，最终由 registry 输出 schema | coreTools/main-agent tools 等可限制；执行还过 policy | S |
| is_background / delay_ms | schema 中始终有字段 | 默认非后台、delay 200ms | S |
| list_background_processes | 内置注册 | 当前 session 历史范围 | S |
| read_background_output | 内置注册 | pid 必须在当前 session 历史 | S |
| 模型持续 stdin | 没有此内置工具/参数 | 无对应开关 | S |
| 人前台输入 PTY | ShellInputPrompt → writeToPty | PTY 启用且焦点在 shell | S |
| 人后台输入 PTY | BackgroundTaskDisplay → writeToPty | 选中后台任务且面板聚焦 | S |
| pipe stdin 输入 | 回调存在，实际 ignore | 不可因为回调存在就判支持 | S |
| close_stdin / signal schema | 未找到 | 控制字符/kill UI 是另外两件事 | S |
| headless 交互 | 常规 -p 令 interactive=false | 降为 child_process；ACP 有独立 interactive 判定 | S |
| E2E/跨平台实测 | 未进行 | 不安装外部依赖、不运行产品 | U |

## 详细分析

### 1. 模型到底看到哪些工具

shell declaration 只有 command 必填，另有 description、dir_path、is_background、delay_ms。
sandbox 开启才加入 additional_permissions。
没有 input、stdin、pid-for-write、close、EOF、signal 字段。
见 [packages/core/src/tools/definitions/dynamic-declaration-helpers.ts#L85-L164](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/definitions/dynamic-declaration-helpers.ts#L85-L164)。

config 使用 maybeRegister 注册 ShellTool、ListBackgroundProcessesTool、ReadBackgroundOutputTool。
coreTools 未配置时默认注册；若提供则成为筛选条件。
见 [packages/core/src/config/config.ts#L3990-L4008](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/config/config.ts#L3990-L4008)、[packages/core/src/config/config.ts#L4065-L4077](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/config/config.ts#L4065-L4077)。

注册仍不是最后一步：getFunctionDeclarations 读取 active tools，做主 agent 工具过滤、调用 getSchema(modelId)。
client 再将 functionDeclarations 交给 chat.setTools。
见 [packages/core/src/tools/tool-registry.ts#L663-L704](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/tool-registry.ts#L663-L704)、[packages/core/src/core/client.ts#L309-L320](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/core/client.ts#L309-L320)。
这条链支持“模型可见”的判断，不只是搜到某个 Tool 类名。

ShellTool.getSchema 按 runtime 状态与模型获取 declaration。
见 [packages/core/src/tools/shell.ts#L1196-L1217](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shell.ts#L1196-L1217)、[packages/core/src/tools/shell.ts#L1252-L1260](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shell.ts#L1252-L1260)。

### 2. 默认开关与 headless 不能混写

CLI settings 中 tools.shell.enableInteractiveShell 默认 true。
见 [packages/cli/src/config/settingsSchema.ts#L1591-L1613](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/cli/src/config/settingsSchema.ts#L1591-L1613)。
CLI 将该 setting 传入 Config；而独立 core Config 的 params 缺省值是 false。
因此只读 core 构造函数会误写“产品默认关闭”。

最终条件为：

```text
interactive
  && ptyInfo !== 'child_process'
  && enableInteractiveShell
```

见 [packages/core/src/config/config.ts#L3697-L3703](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/config/config.ts#L3697-L3703)。
core ptyInfo 缺省也是 child_process，必须由宿主提供实际 backend 信息。

CLI 的 -p/--prompt 进入 headless，-i 强制 interactive；ACP/experimentalAcp 也参与 interactive 的定义。
见 [packages/cli/src/config/config.ts#L782-L790](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/cli/src/config/config.ts#L782-L790)。
所以不能简单写成“只看 process.stdin.isTTY”或者“非 TUI 宿主绝不可能启用”。

getPty 优先 @lydell/node-pty，再尝试 node-pty，失败返回 null。
GEMINI_PTY_INFO=child_process 会强制不用 PTY。
见 [packages/core/src/utils/getPty.ts#L20-L40](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/utils/getPty.ts#L20-L40)。

schema 中 is_background 字段没有随着 PTY 开关消失。
变化的是 description：关闭交互后，POSIX 文案允许用 &；开启时引导使用 is_background。
这与“必须 PTY 才能后台”是两回事。

### 3. 主执行链：模型启动不等于模型输入

```text
model declaration → ShellTool.build / invocation.execute
  → command validation / cwd validation / policy
  → wrapCommandForBackgroundPIDs
  → ShellExecutionService.execute(shouldUseNodePty)
      ├─ getPty → executeWithPty → native PTY + xterm headless
      └─ childProcessFallback → spawn(stdin ignore)
  → attachExecution(pid, callbacks)
  → output events / result promise
  → tool llmContent 或 background yield
```

服务有 PTY 尝试失败后 fallback，而不是保证使用 PTY。
见 [packages/core/src/services/shellExecutionService.ts#L454-L487](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L454-L487)。

工具执行把 sessionId、环境、sandbox、完成通知偏好、tempDir 传给服务。
见 [packages/core/src/tools/shell.ts#L658-L753](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shell.ts#L658-L753)。
本轮未把复杂安全策略的全部规则重做一遍；这里的权限批准仅是进程启动前提，不会新增 stdin schema。

### 4. “pipe 上也有 writeInput”为什么不能算支持

childProcessFallback 使用：

```typescript
stdio: ['ignore', 'pipe', 'pipe']
```

之后注册 writeInput，只有 child.stdin 非空才 write。
见 [packages/core/src/services/shellExecutionService.ts#L692-L735](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L692-L735)。
这是一条真实读过的不可达输入分支，而不是根据函数命名猜能力。

writeToPty 名称本身也不保证目标是 PTY：它统一转发 ExecutionLifecycleService.writeInput。
见 [packages/core/src/services/shellExecutionService.ts#L1780-L1796](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1780-L1796)。
必须继续追到底层注册的是哪种 callback、文件描述符到底是否打开。

ignore 不等于程序一定等待：标准输入读取可立刻收到 EOF。
即便源代码含 stdin.destroy 清理，也只是防御式处理，不会把 ignore 变为 pipe。

### 5. 前台人输入路由

ShellInputPrompt 只有 focus 且 activeShellPtyId 存在时处理按键。
后台切换和 Shift+Tab 放行给上层；滚动键改变视图，其余 keyToAnsi 后提交。
见 [packages/cli/src/ui/components/ShellInputPrompt.tsx#L23-L90](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/cli/src/ui/components/ShellInputPrompt.tsx#L23-L90)。

keyToAnsi 将 Enter 映射为 CR、Backspace 映射 DEL、方向键映射 ANSI 序列。
Ctrl+A–Z 转为 1–26 控制字符，所以 Ctrl+C→0x03、Ctrl+D→0x04。
见 [packages/cli/src/ui/key/keyToAnsi.ts#L11-L55](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/cli/src/ui/key/keyToAnsi.ts#L11-L55)。

实际路径：

```text
user key → keyToAnsi → writeToPty(pid, sequence)
  → lifecycle.writeInput → active PTY callback → pty.write
```

PTY callback 先检查 isActive；Windows 优先检查 activePtys Map，避免 process.kill(pid,0) 对 ConPTY 假阴性。
见 [packages/core/src/services/shellExecutionService.ts#L1266-L1297](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1266-L1297)。

这是真实的人输入路径，但不是模型可以自行发出 write_stdin。
也没有把每次键盘输入作为新的 user message 再让模型决定的中转。

### 6. 后台人输入与控制者

BackgroundTaskDisplay 仅在面板聚焦且有 activeShell 时处理。
列表模式按键负责选择/终止；终端模式 Enter 写 CR、删除写 BS、其余写 key.sequence。
见 [packages/cli/src/ui/components/BackgroundTaskDisplay.tsx#L141-L205](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/cli/src/ui/components/BackgroundTaskDisplay.tsx#L141-L205)。

前后台处理并不完全相同：前台 keyToAnsi，后台直接 sequence 加少数特例。
不能用单个前台单测证明所有后台快捷键语义一致。

生命周期服务按执行 ID 分发 writeInput，不含 owner/session 校验参数。
UI 通过当前选中进程限制目标；未观察到独占输入租约或多客户端仲裁。
这不是“任意插件/多租户调用都安全”的证明。

### 7. 控制字符、信号、EOF 是三个接口问题

写 0x03 只是写入终端控制字符；终端驱动在相应模式下可能将其解释为 SIGINT。
写 0x04 常在 canonical 空输入时触发 EOF；raw 模式可以当普通数据。
源码没有真正关闭 PTY 输入半边的 end API。

UI kill 路径调用 ShellExecutionService.kill / ExecutionLifecycleService.kill。
最终 killProcessGroup 在 POSIX 发组信号并遍历后代；有 escalate 时 SIGTERM→200ms→SIGKILL。
Windows 结合 pty.kill 与 taskkill /f /t。
见 [packages/core/src/utils/process-utils.ts#L37-L148](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/utils/process-utils.ts#L37-L148)。

注意默认 escalate=false 时初始就是 SIGKILL；用户取消的 abort handler 则传 escalate=true。
因此“所有停止都先优雅 TERM”不是正确描述。
专门 kill tool 未注册不等于模型不能通过 shell 执行 kill；shell description 还说明如何按 PGID 发信号。

### 8. 后台化是 yield，不是退出

工具默认等待 200ms（delay_ms 可指定），若仍未完成尝试 background。
先观察短时间，避免把立即失败当成功启动。
见 [packages/core/src/tools/shell.ts#L757-L833](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shell.ts#L757-L833)。

ExecutionLifecycleService.background resolve 当前 result，标记 backgrounded，移除 pending resolver，但保留 active execution。
后续输出和最终退出继续走同一执行记录。
这是早返回的机制，不是暂停 OS 进程。

存在两种可见回执：提前返回“running in background + initial output”，或者 result.backgrounded 分支“moved to background / Ctrl+B”。
不能假设每次后台化都给模型完全相同的输出形状。

默认完成行为 silent；inject 最多带 5000 字符，notify 只给日志位置。
lifecycle 后端直接向 InjectionService 注入，UI 无需再次转发。
见 [packages/core/src/services/shellExecutionService.ts#L394-L409](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L394-L409)、[packages/core/src/services/executionLifecycleService.ts#L426-L477](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/executionLifecycleService.ts#L426-L477)。
“notify 只显示不进对话”不准确：两种非 silent 行为都通过 injection，只是内容不同。

### 9. 输出：UI 快照不是模型增量消费

pipe stdout/stderr 合流到状态，使用 UTF-8 流式 decoder。
服务层保留尾部 16MiB；二进制嗅探另发 binary 事件。
工具 UI 预览限制 100000 字符、最多约 1s 刷新一次，并有 trailing flush。
见 [packages/core/src/tools/shell.ts#L68-L86](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shell.ts#L68-L86)、[packages/core/src/tools/shell.ts#L589-L644](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shell.ts#L589-L644)。

PTY 用 xterm headless 解释控制序列，scrollback 当前为 50000 行。
UI serialization 通常取最后 2000 行，而模型完成输出来自 getFullBufferText。
见 [packages/core/src/services/shellExecutionService.ts#L64-L69](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L64-L69)、[packages/core/src/services/shellExecutionService.ts#L1575-L1618](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1575-L1618)。

PTY chunks 通过 processingChain 顺序写 xterm，render 用 68ms timer 且比较新旧画面。
见 [packages/core/src/services/shellExecutionService.ts#L1386-L1490](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1386-L1490)。
UI 接到的是 ANSI 画面结构快照，pipe 后续事件通常是文本 delta；两者不能用同一 append 规则。

正常工具等待 result 才给模型 llmContent；不是每个 onOutputEvent 都成为模型消息。
后台 read 工具读日志尾部，也不是自动维护 cursor 的增量消费器。

### 10. 超时语义还有一层“事件”差异

默认 inactivity timeout 为 300 秒，模型 schema 无 timeout。
工具收到服务 event 就 resetTimeout，不只针对纯文本 data。
见 [packages/core/src/config/config.ts#L1312-L1313](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/config/config.ts#L1312-L1313)、[packages/core/src/tools/shell.ts#L647-L666](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shell.ts#L647-L666)。

因此严格语义是“工具回调未收到事件的时长”，并非保证等同 OS 没有写任何字节。
PTY 重复刷新相同画面会被 equality 去重；UI 视图事件与 raw output 的对应关系也需实测。
不能把它当硬总时长上限：持续事件会不断延长运行。

后台返回后的 finally 清理 timer，并解除原始 signal 的组合监听。
见 [packages/core/src/tools/shell.ts#L1156-L1176](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shell.ts#L1156-L1176)。
因此不能宣称前台超时或当前 turn 取消仍自动约束已后台化进程。

### 11. session 所有权、历史淘汰与日志读取

后台历史以 sessionId→Map<pid, record> 分组，最多 100 项，FIFO 删最老记录。
注意这是历史条数限制，不是进程数量限制：淘汰代码没有 kill 老进程。
见 [packages/core/src/services/shellExecutionService.ts#L1833-L1896](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1833-L1896)。

read_background_output 先在当前 session 历史验证 pid，再打开日志。
跨 session 返回 Access denied；这是工具层边界，不是底层 writeInput/kill 的 owner-bound API。
见 [packages/core/src/tools/shellBackgroundTools.ts#L137-L155](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shellBackgroundTools.ts#L137-L155)。

读取只加载最后 64KB，默认取最后 100 行，使用 O_NOFOLLOW 防 symlink。
如果读取从文件中段开始，丢弃第一条可能不完整行。
见 [packages/core/src/tools/shellBackgroundTools.ts#L173-L218](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shellBackgroundTools.ts#L173-L218)。

重要缺口：header 的总行数来自加载片段，不是整个文件；还可能写“Full Log Output”。
所以旧报告“header 明确告知截断”只能适用于已加载片段内的行数裁剪，不能代表告知了 64KB 上游裁剪。
这是旧实现已存在的语义问题，非本轮新回归。

delay_ms 的等待忽略传入 abortSignal；后台日志正在写时没有快照锁。
未验证取消延迟、UTF-8 截断边界、PID 重用和历史被淘汰后的恢复可观测性。

### 12. 正常结束、取消、宿主退出

pipe close 处理解码 flush、清 listener、destroy stream、更新历史与清日志 writer。
PTY 退出先 destroy native PTY，再等待 processingChain（或 abort）完成最终输出，dispose terminal/listeners，清 activePtys。
见 [packages/core/src/services/shellExecutionService.ts#L922-L1010](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L922-L1010)、[packages/core/src/services/shellExecutionService.ts#L1520-L1654](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1520-L1654)。

后台 tempDir 所有权交给 service，退出时关闭日志 writer 并删除运行期 tempDir。
这不等于删除后台日志文件；历史输出仍可读取。
见 [packages/core/src/services/shellExecutionService.ts#L425-L442](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L425-L442)。

交互式 AppContainer 注册 cleanup，遍历 backgroundTasksRef，调用 ShellExecutionService.kill。
见 [packages/cli/src/ui/AppContainer.tsx#L514-L540](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/cli/src/ui/AppContainer.tsx#L514-L540)。
这是正常 UI unmount/cleanup 的证据，不能推广为 headless、宿主 SIGKILL、所有漏登记任务的清理保证。

lifecycle 的 kill 可先结算逻辑状态，底层 callback 内 killProcessGroup 是异步 fire-and-forget。
“await kill 返回”不应未经实测被解释成进程树已经消失。

### 13. 秘密、输入日志与权限边界

环境先 sanitizeEnvironment，再加入执行标记、pager、Git 配置覆盖。
GIT_TERMINAL_PROMPT=0、GIT_ASKPASS 空、SSH_ASKPASS 空、GH_PROMPT_DISABLED 等会主动抑制部分认证提示。
见 [packages/core/src/services/shellExecutionService.ts#L580-L639](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L580-L639)。
这说明“启用交互式 shell”不等于“所有登录命令可交互成功”。

writeInput 不主动记录每次输入，但 PTY echo 会变成输出。
后台输出去 ANSI 后写日志；这不是秘密过滤。
日志目录 mode 0700、文件 wx 防覆盖，不等于输出无凭据。
见 [packages/core/src/services/shellExecutionService.ts#L1898-L1918](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1898-L1918)。

模型启动 command、最终输出、read_background_output、非 silent 注入都可能携带秘密。
主 shell 回执 wrapUntrusted 是内容信任标记，不是保密机制。
未验证密码 ECHO、shell history、日志轮转或崩溃报告，因此不能推荐用此机制自动填写真实凭据。

### 14. Windows 与 macOS 的特殊成本

POSIX 主要走 bash -c；Windows shell 解析选择 PowerShell/pwsh，PTY 受 ConPTY 生命周期影响。
当前代码专门访问 Windows native agent 内部状态，处理退出事件未到与迟到 resize。
150ms native-exit fallback 尝试在数据管道关闭异常时最终结算。
见 [packages/core/src/services/shellExecutionService.ts#L154-L181](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L154-L181)、[packages/core/src/services/shellExecutionService.ts#L1655-L1689](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1655-L1689)。

macOS 新增同步扫描 master FD 附近的 orphan slave FD，核对设备/路径后 close。
见 [packages/core/src/services/shellExecutionService.ts#L1046-L1126](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.ts#L1046-L1126)。
这是跨平台 PTY 集成成本的具体证据，不能简化成“换 spawn 为 node-pty 就完成交互”。

### 15. 与旧 snapshot 对照

本轮 fetch 旧完整 SHA，执行具体路径 Git diff：

| 项目 | 证据结果 | 应怎样描述 |
|------|----------|------------|
| dynamic-declaration-helpers.ts | 无 diff | 没有新模型 stdin schema |
| ShellInputPrompt.tsx | 无 diff | 人输入路由原已存在 |
| scrollback | 300000 → 50000 | 真实代码变化，控制 heap |
| Windows 内部状态/退出 fallback | diff 新增 | 真实资源/兼容修复 |
| macOS orphan slave FD | diff 新增 | 真实清理修复 |
| tempDir 所有权与后台清理 | diff 新增字段与回收逻辑 | 真实生命周期加强 |
| executionLifecycleService | 33 行新增集中在 resetForTest | 不能称为首次增加后台生命周期服务 |
| “无 kill tool 所以模型不能终止” | shell description 已允许 kill PGID | 旧报告过度推断 |
| “所有截断都会告知” | 64KB 尾读 header 不一定揭示上游裁剪 | 旧报告结论过强 |

既有后台/list/read 不应以本轮观察日期写成“新上线”。
本轮不推断发布时间、是否所有发布包包含该 HEAD。

### 16. 测试证据与明确未验证项

仅阅读：

- shellExecutionService.test.ts 的 PTY interaction mock：writeToPty 调用 native write。
- shellBackgroundTools.test.ts：跨 session 拒绝、symlink 拒绝、尾读。
- PTY FD integration：需 GEMINI_PTY_INTEGRATION_TESTS=1 且 darwin/linux，连续 64 次。
- Windows integration：仅 Windows 运行，覆盖 node -e 引号传递，不等于覆盖人输入焦点与 EOF。

见 [packages/core/src/services/shellExecutionService.test.ts#L505-L539](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.test.ts#L505-L539)、[packages/core/src/tools/shellBackgroundTools.test.ts#L168-L191](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/tools/shellBackgroundTools.test.ts#L168-L191)、[packages/core/src/services/shellExecutionService.pty.integration.test.ts#L12-L60](https://github.com/google-gemini/gemini-cli/blob/2fe7c2d3f065dc40ad573d50b2091116f8a4aa18/packages/core/src/services/shellExecutionService.pty.integration.test.ts#L12-L60)。

未验证清单：真实 terminal 上 Ctrl+C/Ctrl+D、raw mode、前后台焦点切换、超大输出背压、同时读写、后台取消、headless 宿主退出、PID 重用、跨会话插件调用、秘密脱敏、Windows EOF 与 native FD 压力。
单测断言存在不表示本轮通过；产品能力均为 S，而非 E。

## 对 E02-S004 的选择启发

Gemini 可作为“模型发起、用户交互”的参照，但不是“模型能持续写 stdin”的现成答案。

建议：

1. 明确选择模型续写还是人接管；若两者都要，设计 owner/焦点/租约，而不是只加 writeToPty。
2. schema 按实际 transport 宣告 writable；pipe 没打开就返回明确能力错误，不静默吞输入。
3. session ID 不直接用 PID；历史淘汰与进程终止分离。
4. background/yield 返回 running 状态与后续观察方式；不要把早返回当完成。
5. read 返回 cursor、实际区间、字节/行裁剪标志，避免局部片段叫 Full Log。
6. close_stdin、控制字节、signal、terminate 分开设计并测试。
7. 清理保证写到宿主层，覆盖 headless；不只依靠一个 UI 组件 cleanup。
8. 若教学主线先选 pipe，应说明它不能提供 TTY 语义；若选 PTY，应预算平台和 FD 测试。

## 关键源码引用

正文 permalink 均使用完整 HEAD，覆盖模型 schema→注册→runtime→输入输出→后台→清理。
文件路径均为仓库内相对路径，不以本地 checkout 当证据链接。

## 参考资料与复现

- [旧终端调研](../terminal/gemini-cli.md)
- [话题说明与证据分级](./README.md)

```sh
git clone --depth 100 https://github.com/google-gemini/gemini-cli.git <checkout>
git -C <checkout> rev-parse HEAD
git -C <checkout> log -1 --format='%H %ci %D'
git -C <checkout> describe --tags --abbrev=0
git -C <checkout> fetch --depth 1 origin d76d2d07422176eefbc90676d8d77a7d912a6970
git -C <checkout> diff d76d2d07422176eefbc90676d8d77a7d912a6970 2fe7c2d3f065dc40ad573d50b2091116f8a4aa18 -- packages/core/src/services/shellExecutionService.ts packages/core/src/services/executionLifecycleService.ts packages/core/src/tools/definitions/dynamic-declaration-helpers.ts
```

复核必须使用固定 SHA；当前远端 HEAD 可能在本报告完成后继续变化。
