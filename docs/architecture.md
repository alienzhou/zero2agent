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
