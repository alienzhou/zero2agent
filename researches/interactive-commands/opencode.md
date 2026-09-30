# OpenCode：模型 bash 与独立 PTY 终端是两条能力链

## 基本信息

| 项目 | 值 |
|------|-----|
| 官方仓库 | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| 旧地址身份 | 对 `https://github.com/sst/opencode` 发出 HTTP HEAD，实际返回 301，Location 为 anomalyco/opencode |
| 调研 Commit | `ad6c72c7068812d43b31f3cfb9e413356a19d850` |
| Commit 日期 | 2026-09-28 15:46:01 +0000（北京时间 23:46:01） |
| 分支 | dev；origin/HEAD → origin/dev |
| 最近 Tag | N/A；深度 100 的本地快照中 `git describe --tags --abbrev=0` 无名称；不代表远端没有 tag |
| 调研日期 | 2026-09-28（Asia/Shanghai） |
| 观测窗口 | 主机 UTC 2026-09-28 15:53 起；日期未超过用户指定当日 |
| 旧 snapshot | `743f6410f2e5002723fc5e893039ac49fbfe0de8`，2026-07-23 18:04:46 +0000 |
| 证据等级 | S：源码、测试文本确认；未端到端运行产品或测试 |

## 调研目标

为 E02-S004 判断：模型是否可以启动命令、提前返回后继续写输入、关闭 stdin、观察增量输出，以及人是否可以接管。
重点避免把 Web/桌面终端面板的 PTY 服务误算成模型 bash 的能力。

## 调研结论

1. **模型 bash 没有会话续写契约。** V1/V2 均只有 command、workdir、timeout，实际 stdin 都是 ignore；没有模型可用的 PTY ID、write、poll、EOF 参数。
2. **独立终端面板具备真实 PTY 双向通道。** UI 键盘 → WebSocket → attachment.write → native PTY；这不是接管某次 bash 调用，而是另外创建的终端。
3. **PTY 生命周期按 Location 管理，不按模型 turn 管理。** 断开订阅不杀进程；显式删除或服务 scope 销毁才清理。退出项保留、最多 25 个，但没有观察到运行中终端总数上限。
4. **缓冲有界不代表链路全部有界。** 每 PTY 留存 2×1024×1024 个 JS 字符；订阅激活前 pending 与服务器 WebSocket outbox 没有同样的界限。
5. **旧报告两处推断须修正。** ignore 不等于必然挂到超时；默认 build agent 的 `* = allow` 也不能误写成“默认每条 shell 都 ask”。

## 能力与可达性

| 能力 | 源码存在 | 模型注册 | 配置/默认 | 本轮验证 |
|------|----------|----------|-----------|----------|
| V1 bash 一次性执行 | 是 | legacy registry 内置 | 默认 build 可用，用户权限可覆盖 | S |
| V2 bash 一次性执行 | 是 | BuiltInTools → Location 服务组合 | 独立 V2 surface；不能说全产品只接 V1 | S |
| bash 持续 stdin | 否，schema 无入口且 ignore | 无 | 无开启项 | S |
| bash 提前 yield + session ID | 未找到 | 无 | 无 | S |
| 人使用独立终端面板 | 是 | 不是模型工具 | UI 创建终端、连接服务 | S |
| PTY resize / 输入 | 是 | 仅服务/API/UI | 不依赖 bash 的参数开关 | S |
| close_stdin / EOF API | 未找到 | 无 | 可写控制字符，但不是 close API | S |
| 任意信号的模型工具 | 未找到 | 无 | bash 可运行 kill 命令不等于专门 API | S |
| PTY 输出重连回放 | 是 | 不向模型暴露 cursor | UI transport 能力 | S |
| 产品实测 | 未做 | 不适用 | 不安装、不运行外部代码 | U |

## 详细分析

### 1. 从 schema 到模型实际工具

V1 的名称仍是 `bash`，内部实现称 ShellTool。
schema 完整字段是 command、timeout、workdir；没有 stdin、background、session_id。
见 [packages/opencode/src/tool/shell/prompt.ts#L15-L23](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/tool/shell/prompt.ts#L15-L23)。

legacy registry 初始化 ShellTool，并无条件放入 builtin 列表；其他工具有各自 feature 条件，但 shell 不在这些条件后面。
见 [packages/opencode/src/tool/registry.ts#L207-L249](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/tool/registry.ts#L207-L249)。
因此“源码里存在”在这里可以进一步升级为“legacy 内置注册存在”，但最终权限仍要看 agent/user。

V2 不是一份绝对不可达的备用文本。
`BuiltInTools.node` 包含 BashTool，`location-services.ts` 又包含 BuiltInTools。
见 [packages/core/src/tool/builtins.ts#L31-L47](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/tool/builtins.ts#L31-L47)、[packages/core/src/location-services.ts#L65-L78](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/location-services.ts#L65-L78)。
V2 registry 的 materialize 会生成 definitions，并剔除 whollyDisabled 的工具；执行再 settle。
见 [packages/core/src/tool/registry.ts#L101-L124](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/tool/registry.ts#L101-L124)。

V2 Input 同样只有 command、workdir、timeout，默认 120000ms，最大 600000ms。
其返回另有 exit/truncated/timeout 结构信息，并用文本明确说明退出码。
见 [packages/core/src/tool/bash.ts#L18-L57](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/tool/bash.ts#L18-L57)。
两套调用链都不因为 PTY 服务存在而自动获得输入能力。

### 2. 权限“默认值”不能只读 evaluate 的最后一行

V1 shell 先 tree-sitter 解析命令、收集权限 pattern，再调用 ctx.ask。
路径逃出工作目录时加 external_directory；命令权限键仍是 bash。
见 [packages/opencode/src/tool/shell.ts#L263-L291](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/tool/shell.ts#L263-L291)。

但 ctx.ask 不是“必定弹窗”：规则评估可能直接 allow。
默认 agent 配置明确 `"*": "allow"`，external_directory 默认为 ask，之后与用户配置合并。
见 [packages/opencode/src/agent/agent.ts#L119-L153](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/agent/agent.ts#L119-L153)。
旧 snapshot 的相同代码已核实，故旧报告“默认动作 ask”只描述引擎未匹配兜底，不能代表默认 build 产品行为。

PTY API 的创建也不是复用这条 shell ctx.ask。
其信任边界在宿主 HTTP 授权、origin/ticket 与 Location 服务访问，而非逐条模型命令确认。

### 3. 模型 bash 的完整执行链

```text
legacy ToolRegistry → ShellTool schema/execute
  → resolve cwd / shell → collect permissions → ctx.ask
  → cmd(command, stdin="ignore")
  → ChildProcessSpawner / cross-spawn
  → stdout+stderr stream → UI metadata / bounded tail / file
  → exit | abort | timeout → 一次性工具 output → model message
```

POSIX cmd 设置 shell 与 detached；Windows PowerShell 使用 -NonInteractive。
两个分支都设置 stdin ignore。
见 [packages/opencode/src/tool/shell.ts#L293-L312](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/tool/shell.ts#L293-L312)。

因此不是“有一个 pipe 可以稍后打开”。
模型既没获得 writable 句柄，也没拿到服务会话 ID。
输入重定向、here-document 等可由启动命令本身构造，但属于一次性 shell 文本，不是跨工具轮次续写协议。

进程运行时通过 forkScoped 消费合并输出。
metadata 的实时更新给 UI 看；工具最终结果才进入模型。
见 [packages/opencode/src/tool/shell.ts#L428-L559](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/tool/shell.ts#L428-L559)、[packages/opencode/src/session/message-v2.ts#L292-L320](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/session/message-v2.ts#L292-L320)。

### 4. EOF、信号与退出不能混为一谈

ignore 通常为子进程提供关闭式/空输入源。
读取标准输入的 cat/read 可能立即遇到 EOF；试图从控制终端读、重试输入、或运行不相关长任务的程序行为不同。
不能从 ignore 单独推导“所有交互程序都会挂到超时”。

V1 超时/用户 abort 都调用 handle.kill，默认 SIGTERM，三秒后升级 SIGKILL。
POSIX 优先向进程组 -pid 发信号；Windows taskkill /T /F。
见 [packages/core/src/cross-spawn-spawner.ts#L292-L312](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/cross-spawn-spawner.ts#L292-L312)、[packages/core/src/cross-spawn-spawner.ts#L427-L438](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/cross-spawn-spawner.ts#L427-L438)。

此路径没有模型“发送 Ctrl+C”的参数，也没有 close_stdin。
自然结束、工具取消、关闭输入是不同状态变化，不能统称“停止会话”。

正常退出后 scope finalizer 对已完成进程有条件处理；成功退出并不无条件再杀整个进程组。
见 [packages/core/src/cross-spawn-spawner.ts#L382-L402](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/cross-spawn-spawner.ts#L382-L402)。
因此启动文本中自行 `&` 出来的后代，不应被描述为有可靠托管的后台任务。

### 5. 模型输出与缓冲限制

V1 默认限制 2000 行/50KB，滚动内存保留约 2×maxBytes，最终取尾部。
超过阈值将全量输出转写文件，并在结果标明文件路径。
输出 metadata 另截取末尾预览。
实现见 [packages/opencode/src/tool/shell.ts#L438-L529](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/tool/shell.ts#L438-L529)。

精确边界需注意：循环至少留一个 chunk，单个极大 chunk 可以超过 keep；它不是绝对逐字节硬上限。
sink.write 的返回值没有用来等待 drain，因此“存在落盘”也不等于所有缓冲都有背压保护。
模型仍是完成后收一次 result，没有 poll offset 协议。

V2 用 AppProcess.run + combineOutput + 1MiB capture 上限，stdin 同样 ignore。
见 [packages/core/src/tool/bash.ts#L149-L195](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/tool/bash.ts#L149-L195)。
其 TODO 明确要求未来后台能力先补 owner-bound get/wait/cancel、完成投递和恢复，不是今天已经支持。
见 [packages/core/src/tool/bash.ts#L63-L77](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/tool/bash.ts#L63-L77)。

### 6. 独立 PTY：从人输入到操作系统

```text
terminal context.create → sdk.pty.create → HTTP handler
  → Location-scoped Pty.create → native spawn
terminal widget.onData → WebSocket.send
  → socket.runRaw → decodeInput → attachment.write → proc.write
proc.onData → retained buffer + subscribers
  → single websocket writer → terminal widget
```

UI context 支持 legacy 与 canonical API 两套表面。
见 [packages/app/src/context/terminal.tsx#L317-L337](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/app/src/context/terminal.tsx#L317-L337)。
实际键盘输入走 terminal.onData 后 ws.send，不是把用户输入变成 assistant tool call。
见 [packages/app/src/components/terminal.tsx#L481-L488](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/app/src/components/terminal.tsx#L481-L488)。

默认 command 取 Shell.preferred，login shell 加 -l，cwd 默认 Location.directory。
环境继承宿主、叠加调用输入，再设置 TERM 与 OPENCODE_TERMINAL；Windows 设置 UTF-8 locale。
见 [packages/core/src/pty.ts#L165-L202](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty.ts#L165-L202)。
node 后端用 @lydell/node-pty，Windows 指定 useConptyDll。
见 [packages/core/src/pty/pty.node.ts#L1-L29](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty/pty.node.ts#L1-L29)。

PTY Proc 接口只有 write、resize、kill 等，没有 end/closeStdin。
输入帧是 UTF-8 文本或可解码二进制；非法 UTF-8 被丢弃。
见 [packages/core/src/pty/protocol.ts#L1-L35](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty/protocol.ts#L1-L35)。

### 7. 人接管、控制字符与多写者

attachment.write 原样调用 process.write，既不自动加换行，也不判断“这是密码”。
UI 可以发送 \x03、\x04 等控制字符，但由终端驱动和当前应用模式决定其效果。
Ctrl+D 在 canonical 空行下常触发 EOF，不是关闭 PTY master；raw 模式可把它当普通字节。

测试确实以 cat + \u0004 验证退出通知，属于有条件的 EOF 示例。
见 [packages/core/test/pty/pty-session.test.ts#L186-L205](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/test/pty/pty-session.test.ts#L186-L205)。
不能推广为通用 close_stdin 契约。

同一 PTY 可以有多个 attachment；每个都有 write。
源码没有独占控制者、输入租约或“人/模型谁拥有输入”的仲裁。
这是终端共享设计，不是 S004 可直接照搬的人机接管协议。

### 8. 输出 cursor、并发与重放

每个 session 保存 buffer、bufferCursor、cursor、subscribers。
cursor 按 JS string.length 增加，不是 UTF-8 字节偏移；回放窗口也是字符串索引。
见 [packages/core/src/pty.ts#L203-L222](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty.ts#L203-L222)。

attach 先注册未激活订阅，计算 replay/cursor，期间新输出放 pending。
调用方排入 replay 与 cursor metadata 后 activate，冲刷 pending。
见 [packages/core/src/pty.ts#L259-L309](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty.ts#L259-L309)。

WebSocket outbound 用单写者队列确保 replay → cursor → live → close 的顺序。
输入与输出并发进行；断连只 detach。
见 [packages/server/src/handlers/pty.ts#L176-L218](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/server/src/handlers/pty.ts#L176-L218)。

但 Queue.unbounded 与未激活 pending 说明慢客户端的积压仍值得单独压测。
保留窗口过期时回放从最早可用位置开始，协议没有单独的 lost-bytes 字段。
这对 S004 的“读输出游标”设计尤其重要：应返回实际起点、下一游标和丢失说明。

### 9. 所有权、上限与退出清理

session Map 位于 Location-scoped service，含 PTY ID 而非对话 sessionID/turnID。
因此相同 Location 的终端不是天然按模型对话隔离。
见 [packages/core/src/pty.ts#L92-L102](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty.ts#L92-L102)、[packages/core/src/pty.ts#L316-L318](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty.ts#L316-L318)。

运行中终端没有此文件内的数量上限；退出项按 exitOrder 保留最多 25 个。
BUFFER_LIMIT 是约 2M JS 字符，不是精确 2MiB 内存。
见 [packages/core/src/pty.ts#L14-L17](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty.ts#L14-L17)、[packages/core/src/pty.ts#L223-L238](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty.ts#L223-L238)。

退出后 canonical service 可 get/list 状态，但 attach 拒绝 exited。
旧 API 明确过滤 exited 以保持旧表面行为。
见 [packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts#L36-L76](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts#L36-L76)。
保留 buffer 不代表今天有一个 exited-output HTTP 下载接口。

remove 删除记录、dispose listener、kill 仍运行进程，通知订阅结束。
scope finalizer 对所有 session teardown；模型 turn 结束不触发这套终端销毁。
见 [packages/core/src/pty.ts#L116-L154](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty.ts#L116-L154)。
PTY kill 直接调用 native kill；不能把 bash 的三秒升级策略套用到这里。

canonical WebSocket handler 仍留 graceful-shutdown socket tracking TODO。
legacy handler 已接 WebSocketTracker；这是两个表面的差异，不是全产品都没有关闭追踪。

### 10. 授权与秘密边界

ticket 为随机 UUID、60 秒 TTL、容量 10000，绑定 ptyID/directory/workspaceID，消费一次失效。
见 [packages/core/src/pty/ticket.ts#L9-L48](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/src/pty/ticket.ts#L9-L48)。
ticket 接口要求自定义 header/origin，连接时验证并消费。
无 ticket 的连接可由通常的服务器认证处理，不应断言“每次必需 ticket”。

授权中间件在配置要求认证时校验凭据；带 ticket 的连接交由 handler 验证。
见 [packages/server/src/middleware/authorization.ts#L38-L58](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/server/src/middleware/authorization.ts#L38-L58)。

人输入没有专门逐键审计日志，但 PTY 回显会进入 retained output，shell history 也可能保存命令。
bash 本身的 command 与输出会进入工具记录。
所以“人输入不经模型工具参数”不等于“密码绝不进入输出/日志”。
未验证 ECHO 关闭、应用自行打印、远端日志、崩溃日志等秘密泄露边界。

### 11. 与旧 snapshot 的真实比较

本轮额外 fetch 旧完整 SHA，再用 Git 比较具体文件，而非根据报告日期猜变化。

| 项目 | 结果 | 分类 |
|------|------|------|
| V1 shell.ts | 两 SHA 内容无 diff | 核心执行能力未变 |
| V2 tool/bash.ts | 两 SHA 内容无 diff | 不能称为本轮新加 V2 |
| core/pty.ts、pty/ticket.ts | 两 SHA 内容无 diff | 本轮补齐旧报告未追到底的证据 |
| 默认 build 的 * allow | 旧 SHA 已存在 | 旧报告默认权限推断不完整 |
| ignore 必然挂住 | 源码不能推出 | 旧报告语义推断错误 |
| V2 是否注册 | 当前 BuiltInTools/Location 已核实；本轮未做全应用入口迁移史 | 不声称“刚切到 V2” |

旧文“pty 可能给 TUI 面板”在本轮被具体 UI→API→runtime 证据替代。
这些发现不能包装为 September 新发布能力。

### 12. 测试证据与未覆盖问题

仅阅读测试，未执行：

- PTY session：不存在 ID、退出保留、回放与 live、detach 后不再投递、两 PTY 输出隔离、Ctrl+D 后退出。
- ticket：单次消费、不同 directory、不同 workspace、TTL。
- shell：已有 timeout、非零退出、metadata、截断测试文本，但没有把 UI PTY 变成模型输入的测试。
- PTY live 测试在 Windows 跳过；不能从 POSIX 测试推出 ConPTY 行为。

测试入口：[packages/core/test/pty/pty-session.test.ts#L25-L28](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/test/pty/pty-session.test.ts#L25-L28)、[packages/core/test/pty/pty-session.test.ts#L94-L205](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/test/pty/pty-session.test.ts#L94-L205)、[packages/core/test/pty/ticket.test.ts#L16-L62](https://github.com/anomalyco/opencode/blob/ad6c72c7068812d43b31f3cfb9e413356a19d850/packages/core/test/pty/ticket.test.ts#L16-L62)。

仍未验证：多浏览器同时输入、慢订阅持续积压、极大单 chunk、退出瞬间最终输出 drain、POSIX 孙进程逃组、宿主 SIGKILL、Windows 终端退出、密码/原始模式 EOF。
本轮没有产品端到端结果，所有正向能力仍为 S。

## 对 E02-S004 的选择启发

建议将“模型可交互进程”与“人用终端”分成两套契约，再决定是否提供显式接管桥梁。
不要把现成 PTY service 直接注册给模型就认为任务完成。

最小模型契约应明确：

1. session ID 绑定对话 owner，不能只凭 PID 或工作目录访问。
2. start/read/write/close-input/terminate 分开；write 明示不自动附加换行。
3. read 返回实际区间与 truncated/gap，而不是只有 cursor。
4. 允许谁写必须有仲裁；断开 UI 不等于进程退出。
5. running 上限、exited 保留上限、日志上限分别定义。
6. turn 完成、用户取消、宿主正常退出、异常退出分别列清理保证。

OpenCode 最值得借鉴的是 replay→activate 的无缝衔接和服务 scope 清理。
不宜照搬的是无输入 owner 仲裁、无界下游队列，以及把产品默认权限误读为引擎兜底。

## 关键源码引用

正文已按固定完整 SHA 提供 schema、注册、权限、spawn、输入、输出、ticket、清理、测试的 permalink。
同名文件均明确区分 `packages/opencode` legacy 与 `packages/core` V2。

## 参考资料与复现

- [旧终端调研](../terminal/opencode.md)
- [本话题证据分级](./README.md)
- 官方身份由旧 GitHub 地址的 301 和目标仓库源码确认，不依赖第三方介绍。

```sh
git clone --depth 100 https://github.com/anomalyco/opencode.git <checkout>
git -C <checkout> rev-parse HEAD
git -C <checkout> log -1 --format='%H %ci %D'
git -C <checkout> describe --tags --abbrev=0
git -C <checkout> fetch --depth 1 origin 743f6410f2e5002723fc5e893039ac49fbfe0de8
git -C <checkout> diff 743f6410f2e5002723fc5e893039ac49fbfe0de8 ad6c72c7068812d43b31f3cfb9e413356a19d850 -- packages/core/src/pty.ts packages/opencode/src/tool/shell.ts packages/core/src/tool/bash.ts
```

当前远端可能继续前进；复核本文必须读取上述固定 SHA，而不是把新 HEAD 当作同一版本。
