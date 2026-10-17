# 项目架构

> 理解 Zero2Agent 的代码组织和设计思路。

---

## 整体架构

```text
CLI（tui） → Agent / ReAct loop ↔ Anthropic SDK ↔ LLM
                    │
                    └→ 工具执行 → 工具结果回到 loop

人工交互分支：
人的键盘 ↔ CLI 宿主 ↔ PTY master/slave ↔ bash / 子程序
```

CLI 的 `--terminal` 和 `/terminal` 直接调用人工工具路径，不调用模型；模型也可以通过 `terminal({ command, interactive: true })` 请求人工接管。三种入口都先由人确认。终端正文只显示给人，只有模型发起的工具调用会把结束元信息返回模型。

---

## Package 结构

### @zero2agent/core

Agent 的核心逻辑，包含：

```text
packages/core/src/
├── index.ts                  # 公共 API
├── agent.ts                  # Agent 入口与会话
├── loop.ts                   # ReAct 循环
├── history-evidence.ts       # 原史索引、引用、来源权限目录
├── prompt/                   # 系统指令与任务上下文
├── tools/
│   ├── index.ts              # 十个工具的注册表
│   ├── read-tool-result.ts   # 存储结果的有界回读
│   ├── read-history.ts       # 当前会话的原始来源回查
│   ├── types.ts              # Tool / ToolContext
│   ├── read-file.ts          # 读取文件
│   ├── grep-search.ts        # 搜索内容
│   ├── find-files.ts         # 匹配文件名
│   ├── list-directory.ts     # 列目录
│   ├── write-file.ts         # 写文件
│   ├── delete.ts             # 删文件
│   ├── replace-in-file.ts    # 局部替换
│   ├── terminal.ts           # 普通执行与人工分流
│   ├── terminal-runtime.ts   # 宿主交互契约
│   ├── process-registry.ts   # 普通后台进程登记
│   └── shell-env.ts          # shell 环境采集
└── llm/
    ├── index.ts
    └── anthropic.ts          # Anthropic 及兼容端点
```

**核心概念：**

- **Agent**：会话入口，协调指令、模型与工具。
- **Loop**：模型请求工具、执行工具、返回结果的循环。
- **Tool**：可执行的能力单元；`ToolContext.cwd` 定义工作区。
- **Runtime hooks**：core 声明交互契约，CLI 宿主实现终端相关行为。

### @zero2agent/tui

终端入口及人工交互实现：

```text
packages/tui/src/
├── index.ts
├── cli.ts                    # 参数、REPL 与 /terminal 分流
├── setup-terminal-runtime.ts # 绑定宿主 hooks
├── human-terminal.ts         # 确认、PTY、输入独占与恢复
└── human-terminal-process.ts # 原进程组及已观察后代的清理
```

人工路径要求 POSIX 真实 TTY，目前 macOS 已实测，Linux 未实测，Windows 不支持。键盘 Ctrl-C/D 转给程序，Ctrl-] 由宿主中止；正常退出和中止都清理受管进程。详见 [S004 技术设计](../specs/E02-act-and-execute/S004-interactive-commands/details/01-technical-design.md)。

### @zero2agent/shared

当前只有 `src/index.ts` 的 `VERSION` 占位导出，尚未实现通用 logger/config 模块。另有独立的 `cdp-debug` 调试包和 `e2e` 验收工作区，不属于九个 Agent 工具。

---

## 数据流

一次完整的用户交互：

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. 用户输入                                                       │
│    "帮我创建一个 hello.ts 文件"                                    │
└──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. TUI 接收输入，传给 Agent                                        │
│    agent.run("帮我创建一个 hello.ts 文件")                         │
└──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. Agent 调用 LLM，获取响应                                        │
│    Thought: 用户想创建文件，我需要使用 write_file 工具              │
│    Action: write_file                                             │
│    Action Input: { "path": "hello.ts", "content": "..." }         │
└──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. Agent 执行 Tool                                                │
│    Observation: 文件创建成功                                       │
└──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. 继续循环或结束                                                  │
│    Final Answer: 已创建 hello.ts 文件                              │
└──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 6. TUI 展示结果给用户                                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 关键设计决策

### 为什么用 Monorepo？

- **代码共享**：`shared` 包可以被 `core` 和 `tui` 同时使用
- **独立版本**：每个包可以独立发布
- **清晰边界**：强制思考模块职责

### 为什么分三个 Package？

| Package | 职责 | 可以独立使用吗？ |
|---------|------|------------------|
| `core` | Agent 逻辑 | 可以嵌入其他应用；交互工具需宿主 hooks |
| `tui` | CLI 界面 | 依赖 core，实现真实终端接管 |
| `shared` | 共享包预留 | 当前只有 VERSION 占位导出 |

这样设计，未来可以轻松添加 Web 界面、API Server 等，只需要依赖 `core`。

### 为什么选 TypeScript？

- **类型安全**：Agent 的数据流复杂，类型帮助减少错误
- **开发体验**：IDE 补全、重构支持
- **教学友好**：类型就是文档

---

## 运行诊断与本地追查

Core 的 `DiagnosticEmitter` 创建操作和请求身份，在实际 SDK 调用、权限与工具边界报告白名单元信息。宿主 `RunJournal` 负责工作区隔离、独占 JSONL、有界串行写入、flush 与可见降级；读取器只读验证版本和完整行，再交给 TUI 或 CLI 展示。

请求开始的 `model` 与完整响应的可选 `responseModel` 分别记录发送名称和服务自报名称，按 requestId 关联。名称经过有界白名单校验及落盘凭据过滤；失败、取消、计数和缺字段不猜测返回名称。服务自报不等于身份验证，也不回填旧记录。

诊断通知与控制接口分开；观察者错误不能改变模型历史或工具结果。后台摘要和命令使用启动时的父身份。运行日志独立于会话快照，不能用于恢复进程、重放工具或判断缺失终态等于没有副作用。详见 [S005 技术设计](../specs/E03-product-foundations/S005-runtime-logging/details/01-technical-design.md)。

---

## 文件副作用与恢复

Core 的 `FileMutationHandler` 是可等待的控制接口：工具权限通过并完成路径边界校验后，宿主先持久化 before/pending，再调用执行闭包，最后保存实际 after。`Tool.checkpointPaths` 来自受信任注册元数据，不能由模型自行扩展；裸 SDK 未配置该接口时保持原执行行为。

TUI 宿主的 `CheckpointStore` 只读取声明目标，内容定义分块后按 SHA-256 压缩去重，独立版本清单引用块。锁、容量预算、引用回收和完整内容校验构成保存边界。回退先验证所有文件和确认令牌，再保存 from/to 意图、逐文件替换；部分完成可以按磁盘状态恢复，完成后新增一条反向记录。

文件历史、对话快照、诊断日志分别保存各自证据。交互会话回退后追加恢复事实并要求重新读取文件，保留旧工具调用/结果对。普通 shell、人工终端和外部系统未进入此保护范围。详见 [S006 技术设计](../specs/E03-product-foundations/S006-file-checkpoints/details/01-technical-design.md)。

---

## 下一步

- 📖 [快速上手](./getting-started.md) - 先把项目跑起来
- 🗓️ [迭代日志](../CHANGELOG.md) - 查看各迭代学习要点

## 大工具结果

Session 持有 ResultStore。新工具结果在进入历史前转换为引用；ContextManager 为旧历史复用同一存储，只改变发送视图。正文按 SHA-256 保存，快照只保存版本化来源和目录身份。read_tool_result 按当前权限和预算读取有限字节，并流式验证正文；终端复用现有文件封存，后台输出保持未封存状态。容量包含活跃输出预留，详情见 [E04-S002](../specs/E04-reliability-and-context/S002-result-references/README.md)。

## 摘要与原史来源（S003）

ContextManager 将自由文本交接与宿主从原史计算的有界索引放入发送视图，多次压缩时重新引入原始节选。read_history 按字面检索用户原话或列举来源身份，按带哈希引用读取有限字节。工具来源路径在执行前绑定、结果结算后关联到原消息；恢复先校验整个目录，新读取再经过当前权限。摘要或引用不提供新的授权，原有历史也不会因当前权限收紧而被删除。

Core 另提供按回合显式 runWithContract：调用方声明 JSON 结构与可选字段含义，正常完成时在当前权限和原预算内读取实际文件，最多一个修复阶段。反馈只存在于发送视图，旧契约不随恢复自动启用；拒绝、取消及失败/未知效果阻止自动修复。结构检查不认证语义。

内置 read_tool_result 的参数错误会在本回合登记未解决引用；只有同引用的有效正文页或真实空正文才能清除。正常结束前至多进入一次读取纠错阶段，仍未解决则返回 EvidenceReadIncompleteError；当前权限、取消和原预算继续生效，旧命令不重放。状态与反馈不作为控制指令持久化。

固定集完整真实验证为任务及关键项 56/56、普通事实 63/63；原 728 份失败与成绩保留。此前基线/候选 54/55 是历史同输入对照，不能将差异全部归因于纠错。确定性 HTTP/SDK 前后对照另证实提前完成被阻止，见 [S003 验收与限制](../specs/E04-reliability-and-context/S003-summary-quality/details/03-verification-checklist.md)。

## 逐工具执行恢复（E04-S004）

Core 的 ExecutionPersistence 是等待完成的控制接口。在本轮输入、完整模型响应、当前工具执行标记和真实回执处，宿主把原史、摘要、来源目录、结果引用与恢复控制一起发布为完整 generation。执行标记写入后却缺少回执的调用归为未知，恢复时只装载数据；配对占位明确标为宿主中断记录。

Conversations 复用 SessionStore 并升级含恢复状态的会话格式为 version=2，旧读取器拒绝读取，新读取器继续支持旧 version=1。保存冲突、损坏或容量超限阻止新工作，最高版本不会自动回退。单份 32 MiB、单会话 512 MiB/2048 份；结果正文仍有独立生命周期。

`/recovery` 查看进度，`/recovery continue 指令` 或 `--resume-task` 明确开启新预算；原契约、未解决读取及已用修复机会继续保留。旧工具不重放，新调用使用当前权限。文件核对与回退仍由 CheckpointStore 负责。详见 [S004 协议](../specs/E04-reliability-and-context/S004-safe-resume/details/01-technical-design.md)。

## 项目指令覆盖层（E05-S001）

Agent 持有易失的 ProjectInstructions。沿显式根、cwd 和可信工具目标的祖先链读取 AGENTS.md，PermissionController 在正文读取前授权。overlay 把带来源、目录和哈希的 Markdown 加入用户级请求；固定优先说明进入 system，整个请求仍由 ContextBudget 计量。

runTurnLoop 对模型整批调用先 prepareBatch。若发现尚未见过或已经变更的适用规则，批次全部配对为未执行，并有限重规划。卸载不相关目录不额外重规划。每个 execute 前再次解析目标路径，规则在审批或批中发生变化则停止剩余调用，保留已完成效果。

规则正文和读取批准不进入会话快照；恢复/压缩使用当前文件与当前权限。Conversations 向 CLI/plain/TUI 提供统一的查看、刷新、开关，元信息明确区分已读取与已发送。协议和容量见 [S001 技术设计](../specs/E05-extensibility/S001-project-instructions/details/01-technical-design.md)。


## Skills 覆盖层（E05-S002）

Skills 控制器将发现摘要、激活正文和资源页分开。扫描默认或显式根时只建立有限目录；用户选择或模型的 load_skill 通过当前读取权限加载正文，回执仅包含元信息。正文由独立 user 覆盖层进入下一次请求，预算计数和压缩走同一个发送视图。read_skill_resource 返回带 SHA-256 与范围的有限资源页，不执行其中代码。

加载与业务调用混批时整批未执行并重新规划。模型响应期间当前技能版本改变时，也在副作用前重新规划；审批或批中变化停止剩余调用，保留已发生效果。工具配对、原工具/请求预算和有限重规划继续生效；技能声明不能改变 PermissionController。

SessionSnapshot.skills 字段只存来源身份、路径与旧内容版本；原消息与资源结果仍按历史保存。磁盘格式含技能选择时升为 version=3；普通历史仍兼容原格式。恢复使用当前根、读取权限与文件版本，不恢复正文缓存、授权或进程。无技能的普通会话保持原请求；停用保留历史事实，当前覆盖层不再激活该技能。历史 read_history/read_tool_result 仍使用各自原有的权限语义，收紧 read_file 不会删除历史文本。边界和失败行为见 [S002 设计](../specs/E05-extensibility/S002-skills/details/01-technical-design.md)。

## MCP 外部工具

E05-S003 的 `mcp/client.ts` 将显式启用的本地 stdio 服务映射到 Tool；`mcp/stdio.ts` 限制帧、累计字节并等待子进程组关闭，`mcp/schema.ts` 严格校验有界 Schema 子集。Agent 每轮固定工具表，原权限控制器和预算处理所有实际调用，服务 annotations 不授予本地权限。

结果与历史来源目录携带不含配置凭据的 ExternalSource，正文回读检查当前服务身份与原工具权限。发出调用后的断线/取消/超时或无法解释的结果停止本轮，沿用配对的 unknown/not-started 恢复记录，必须显式核对后继续；业务调用不会自动重试。磁盘会话 v4 保存外部来源，兼容普通 v1/v2/v3。

配置和限制、SDK/CLI 入口见 [MCP 跟练](../specs/E05-extensibility/S003-mcp/follow-along.md)。
