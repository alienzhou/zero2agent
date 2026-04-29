# E01-S004: 技术设计

> Prompt / Message 结构整理的设计说明，重点解释消息分层、builder 归属、Default System section、UserTaskContext 和实现边界。

---

## 整体结构

S004 的设计分三层落地：

1. **System Prompt Builder**
  - 新增 core 侧 `buildSystemPrompt()`
  - 内部按 5 个 section 组织，最终仍返回单个 `string`
  - 代码入口建议：`packages/core/src/prompt/system.ts`
2. **User Task Message Builder**
  - 将用户原始输入与 Runtime Context 组合成 user message
  - 目标格式采用 XML-like tags
  - 代码入口建议：`packages/core/src/prompt/user-task.ts`
3. **Agent / TUI 集成**
  - `Agent` / `runLoop` 使用 core builder 构造 system 与 user message
  - `packages/tui` 不再维护 `SYSTEM_PROMPT` 文案，只负责收集用户输入并传入 `cwd`

建议目录：

```text
packages/core/src/
  prompt/
    system.ts
    user-task.ts
    index.ts
  agent.ts
  loop.ts

packages/tui/src/
  cli.ts
```

---

## Message Layer Map

S004 先建立完整消息地图，再只实现最小闭环。

| 层级 | 定义 | S004 是否实现 | 说明 |
|------|------|--------------|------|
| System | 长期稳定的 agent 身份、能力边界、全局工作方式 | ✅ 实现 | `buildSystemPrompt()` |
| Instruction | AGENTS.md、项目规则、用户偏好、skills | ❌ 不实现 | 只定义优先级和位置 |
| User Task | 用户原始输入及当前任务上下文 | ✅ 实现或至少固定格式 | `buildUserTaskMessage()` |
| Task Mode | plan/debug/review 等模式 | ❌ 不实现 | 只预留 Mode System Fragment/Profile |
| Tool | 工具 schema、工具策略、tool response | 部分实现 | schema 写描述，System 写策略 |
| Response | 最终回答契约 | ✅ 实现 | 放在 Output Contract section |

### Instruction 优先级

S004 不实现 AGENTS.md loader，但文档中固定优先级原则：

```text
System > Project Instruction > User Preference > Task
```

这条原则用于后续实现 Instruction loader 时判断冲突关系。当前 Story 不读取、解析、合并任何 AGENTS.md 或 skills 文件。

---

## Default System Builder

### Section 顺序

Default System 固定为 5 个静态 section：

```text
Role / Identity
→ Scope / Capability
→ Tool Policy
→ Workflow
→ Output Contract
```

### Section 职责

| Section | 写什么 | 不写什么 |
|---------|--------|----------|
| Role / Identity | 你是 Zero2Agent 的只读 Agent Harness 演示 | 不写具体任务 |
| Scope / Capability | 能读文件、看目录、搜内容、找文件；不能编辑或执行 shell | 不写工具参数 |
| Tool Policy | 何时使用 `find_files`、`grep_search`、`read_file`、`list_directory`，如何组合 | 不重复 schema 中的完整工具描述 |
| Workflow | 默认推进方式：先定位，再精读，再回答 | 不写 plan/debug/review 模式 |
| Output Contract | 中文、简洁、必要时引用路径 | 不写某次任务的具体格式要求 |

### 推荐文案骨架

实现不必逐字照抄，但语义应保持稳定：

```text
你是 Zero2Agent 课程配套的只读文件 Agent Harness 演示，运行在宿主进程中，负责通过模型和工具协作帮助用户理解当前工作区。

你只能查看和搜索文件内容，不能编辑文件，不能执行 shell 命令，也不能访问工作区之外的资源。

工具完整参数以 tool schema 为准。查找文件名或路径时优先使用 find_files；查找文件内容时使用 grep_search；定位到目标文件后再用 read_file 精读；需要理解目录结构时使用 list_directory。

默认工作流：先缩小目标范围，再读取必要内容，避免一次性读取无关文件；如果信息不足，说明缺口，而不是编造。

用中文回答。保持简洁；涉及代码或文件时引用相对路径。
```

### 为什么 Workflow 要保留

Workflow 不是 mode，也不是 plan。它是普通任务下的默认推进方式，回答“用户没有指定方法时，Agent 应该怎样自然推进”。

竞品里基本都有类似段落：

| 项目 | 类似 section |
|------|--------------|
| Codex | How you work / Planning / Editing constraints |
| Gemini CLI | PlanningWorkflow / PrimaryWorkflows |
| OpenCode | Doing tasks / Task Management |
| Aider | 编辑流程约束 |
| Pi Mono | Guidelines |

因此 S004 保留 Workflow，但只写默认只读流程，不写 plan/debug/review 等 mode-specific 规则。

---

## UserTaskContext Builder

### 结构

S004 阶段 UserTask 与 UserMessage 合并理解：用户原始输入就是当前任务。但真正传给模型的 user message 可以由两段组成：

```text
UserMessage
  ├─ UserTaskContext
  │   └─ Runtime Context
  └─ UserTask
      └─ 用户原始输入
```

### 目标格式

采用 XML-like tags：

```xml
<user_task_context>
  <runtime_context>
    <cwd>{cwd}</cwd>
    <date>{date}</date>
  </runtime_context>
</user_task_context>

<user_task>
{rawUserMessage}
</user_task>
```

### 为什么不用 Markdown section

| 格式 | 结论 | 原因 |
|------|------|------|
| Markdown section | 不优先采用 | 用户原文也可能包含 Markdown 标题，边界不够强 |
| XML-like tags | 采用 | 机器注入上下文和用户原文边界清晰，后续容易扩展 |
| JSON/YAML block | 不采用 | 多行用户原文转义更麻烦，课程阅读体验也较差 |

### Runtime Context 第一版字段

| 字段 | 来源 | 说明 |
|------|------|------|
| `cwd` | host 传入或 core 默认 `process.cwd()` | 当前工作目录，和 S003 的 `ToolContext.cwd` 对齐 |
| `date` | core 默认生成，也可由测试传入 | 当前日期，避免模型在时间相关问题上脱节 |

暂不加入 `platform`、`git status`、`repo root`、`sandbox`。这些属于未来扩展。

### 用户原文保真

`buildUserTaskMessage()` 不能改写用户原文，只能包裹：

- 不要重写用户意图
- 不要抽取 task object 后替代原文
- 不要把 runtime context 插到用户原文内部

未来如果引入 task extraction，也应新增 Task 层，而不是覆盖原始 user message。

---

## 业务操作流程

S004 完成后的单轮调用流程应是：

```text
用户在 TUI 输入问题
    ↓
TUI 收集 rawUserMessage 和 cwd
    ↓
Agent/core 补齐 runtime context（cwd/date）
    ↓
core 调用 buildSystemPrompt()
    ↓
core 调用 buildUserTaskMessage(rawUserMessage, context)
    ↓
runLoop 把 system + user message + tools 发送给模型
    ↓
模型按 tool schema 发起工具调用
    ↓
工具用 ToolContext.cwd 执行，只返回结果文本
    ↓
模型继续推理并按 Output Contract 用中文回答
```

这个流程里有两个边界必须保持清楚：

| 边界 | 约定 |
|------|------|
| TUI / core | TUI 不持有 System Prompt；core 负责 agent 行为和消息装配 |
| System / UserTask | Default System 放长期规则；Runtime Context 和用户原文放 user message |

---

## 对现有代码的影响

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/core/src/prompt/system.ts` | `buildSystemPrompt()`，Default System 5 段 |
| 新增 | `packages/core/src/prompt/user-task.ts` | `buildUserTaskMessage()`，XML-like UserTaskContext |
| 新增 | `packages/core/src/prompt/index.ts` | prompt builder 统一导出 |
| 修改 | `packages/core/src/agent.ts` | 默认使用 core builder；保留必要 override 能力时需谨慎 |
| 修改 | `packages/core/src/loop.ts` | 接收已构造的 system / user message，或在入口处构造 |
| 修改 | `packages/core/src/index.ts` | 导出 prompt builder 或相关类型 |
| 修改 | `packages/tui/src/cli.ts` | 删除内联 `SYSTEM_PROMPT`，只传用户输入和 cwd |
| 修改 | `examples/simple-agent.ts` | 与 TUI 一致使用 core builder，避免示例继续复制旧 prompt |

---

## 设计决策记录（ADR）

### ADR-01：Prompt Builder 归属 core

**决策**：`buildSystemPrompt()` 和未来的 `buildUserTaskMessage()` 归属 `packages/core`。

**理由**：

1. System Prompt 描述的是 agent 行为，不是 UI 行为。
2. 未来接入非 TUI host 时不应复制 prompt。
3. core 已经拥有 loop、tools、ToolContext，更适合拥有消息装配规则。

### ADR-02：Default System 保持静态

**决策**：Default System 不包含 cwd/date/platform/git 等 Runtime Context。

**理由**：

1. 动态事实会破坏 System 的稳定性。
2. 后续 prompt cache 需要静态/动态边界。
3. Runtime Context 与当前 user task 更绑定。

### ADR-03：工具描述走 schema

**决策**：工具完整说明只放 tool schema，System 只写 Tool Policy。

**理由**：

1. 避免 `SYSTEM_PROMPT` 和 tool schema 双写漂移。
2. 工具 schema 是模型决定工具调用时最直接的契约。
3. System 更应该描述组合策略，而不是重复参数说明。

### ADR-04：S004 仍返回 string，但内部按 section 组织

**决策**：`buildSystemPrompt()` 当前返回 `string`，不立刻暴露 `SystemFragment[]`。

**理由**：

1. 当前只有默认只读 agent，不需要 fragment registry。
2. 直接上 `string[]` / cache-control 会让课程复杂度跳得太快。
3. 内部按 section 组织已经足够为未来 fragment 演进留空间。

---

## 当前不做的事情

这一版明确暂不处理：

- AGENTS.md / Instruction loader
- skills discovery / loading / permission
- plan/debug/review/compact/promotion 具体模式
- 多模型 prompt profile
- custom prompt replace / append API
- prompt cache 和 `cache_control`
- tool response hint envelope
- 结构化 task extraction

详细理由见 [04-backlog.md](./04-backlog.md)。
