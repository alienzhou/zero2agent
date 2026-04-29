# Remaining Decisions Checkpoint

> 本笔记用于回答：进入 Spec 前还有什么需要讨论确定？目标是把讨论从发散转向收敛。

## 1. 已确认

| 决策 | 内容 | 是否阻塞 S004 |
|------|------|---------------|
| D06 | Instruction / AGENTS.md：S004 只定义优先级和位置，不实现加载 | 不阻塞 |
| D09 | Mode-specific 内容属于 System Prompt Fragment/Profile，但不进入 Default System；S004 只预留扩展点 | 不阻塞 |
| D10 | Default System 固定为 Role / Scope / Tool Policy / Workflow / Output Contract | 不阻塞 |
| D11 | Tool schema 写完整 description；Default System 只写 Tool Policy | 不阻塞 |
| D12 | Runtime Context 放入 UserTaskContext，不放 Default System | 不阻塞 |
| D13 | S004 阶段 UserTask = UserMessage，但可包含独立 Task Context section | 不阻塞 |
| D14 | Prompt builder 归属 core，TUI 只传 UserTask | 不阻塞 |
| D15 | S004 实现仍返回 string，设计预留 SystemFragment/string[] | 不阻塞 |

## 2. 已收敛的阻塞项

### B01：Default System 的 section 顺序

已确认：

```text
Role / Identity
→ Scope / Capability
→ Tool Policy
→ Workflow
→ Output Contract
```

补充：

- Runtime Context 明确不属于 Default System。
- Safety 不单独成段，S004 并入 Scope / Capability 的只读边界。
- Workflow 保留，因为竞品普遍存在类似段落：Codex 的 How you work / Planning、Gemini CLI 的 PlanningWorkflow / PrimaryWorkflows、OpenCode 的 Doing tasks、Aider 的编辑流程约束。

### B02：Tool 描述策略

已确认：

```text
Tool schema 写完整 description；
Default System 只写 Tool Policy（如何组合工具），不逐个重复工具说明。
```

补充：

- System 可以写工具组合策略。
- 不在 System 中逐个重复完整工具说明。

### B03：Runtime Context 的位置

已确认：

```text
Runtime Context 放入 User Task Context，不放 Default System。
```

理由：

- cwd / date / platform / git 等是每轮动态事实。
- 放 User Task 更贴近当前任务，也避免污染静态 Default System。
- 未来若支持 `string[] system` 或 developer channel，再考虑独立 dynamic system/env 段。

具体格式另见 `notes/user-task-context-format.md`，当前推荐 XML-like tags，仍待最终拍板。

### B04：User Task 的定义

已确认：

```text
S004 阶段 User Task = User Message；
不做独立 task extraction。
```

补充：

- UserMessage 可以包含 UserTaskContext 与 UserTask 两个 section。
- plan/debug/review 等模式出现后，再从 UserMessage 派生结构化 Task/Mode。

### B05：Prompt 存储形态与代码归属

已确认：

```text
packages/core 拥有 buildSystemPrompt()；
packages/tui 不再拥有 prompt 文案，只传入 User Task / Runtime Context。
先用 TypeScript builder，不引入模板文件。
```

理由：

- core 才是 agent 行为归属。
- TUI 是交互外壳，不应拥有 agent 的系统规则。
- TS builder 比 `.md` 模板更适合当前课程阶段，可测试、可组合。
- Runtime Context 可由 core 补默认值，也可由 TUI/host 传入 host 才知道的信息。

### B06：System message 类型

已确认：

```text
S004 实现仍可返回 string；
设计上预留 string[] / SystemFragment[]。
```

理由：

- 当前功能不需要立刻改完整 host message 抽象。
- 但竞品中 OpenCode / Claude Code 都说明多段 system 是合理方向。

## 3. 新的待确认点

现在剩下的不是 B01-B06 这种进入 Spec 前的大方向阻塞项，而是 UserTaskContext 的具体格式与实现深度：

| 编号 | 问题 | 当前推荐 |
|------|------|----------|
| F01 | UserTaskContext 用 Markdown section、XML-like tags 还是 JSON/YAML？ | XML-like tags |
| F02 | S004 是否实现 `buildUserTaskMessage()`？ | 可先在 spec 固定格式，若实现成本低再落地 |
| F03 | Runtime Context 第一版注入哪些字段？ | `cwd` + `date`，其它字段预留 |

## 4. 不阻塞 S004，但应进入 backlog

| 事项 | 所属层级 | 备注 |
|------|----------|------|
| 多模型 prompt profile | Prompt lifecycle | 后续引入多模型时做 |
| plan / debug / review / compact / promotion | Mode System Fragment/Profile | D09 已预留 |
| AGENTS.md / Instruction loader | Instruction | D06 已预留 |
| skills discovery / loading / permission | Instruction / Skills layer | 不进入 Default System |
| custom prompt replace / append | Customization | 后续配置能力 |
| tool response hint envelope | Tool | 需要独立输出契约 |
| prompt cache / static-dynamic section control | Prompt lifecycle | 后续优化 |

## 5. 建议的下一步

已沉淀为以下决策文档：

- D10：Default System section order
- D11：Tool description strategy
- D12：Runtime Context belongs to User Task
- D13：User Task equals User Message in S004
- D14：Prompt builder ownership in core
- D15：System stays string for S004 but reserves fragments

接下来只需确认 UserTaskContext 格式，即可进入 Spec 编写阶段。
