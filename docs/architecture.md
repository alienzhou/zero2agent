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
├── prompt/                   # 系统指令与任务上下文
├── tools/
│   ├── index.ts              # 八个工具的注册表
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

当前只有 `src/index.ts` 的 `VERSION` 占位导出，尚未实现通用 logger/config 模块。另有独立的 `cdp-debug` 调试包和 `e2e` 验收工作区，不属于八个 Agent 工具。

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

诊断通知与控制接口分开；观察者错误不能改变模型历史或工具结果。后台摘要和命令使用启动时的父身份。运行日志独立于会话快照，不能用于恢复进程、重放工具或判断缺失终态等于没有副作用。详见 [S005 技术设计](../specs/E03-product-foundations/S005-runtime-logging/details/01-technical-design.md)。

---

## 下一步

- 📖 [快速上手](./getting-started.md) - 先把项目跑起来
- 🗓️ [迭代日志](../CHANGELOG.md) - 查看各迭代学习要点
