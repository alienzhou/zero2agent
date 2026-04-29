# Message Layer Map

> 本笔记把「Prompt Structure」从单一 system prompt 扩展为完整的 message assembly 设计范围：System / Instruction / User / Task / Tool / Response。目标是完整覆盖，但每轮只深入一层，避免一次性展开过多问题。

## 0. 核心观点

Prompt structure 不是一段文本的排版问题，而是 **模型调用前后消息如何被构造、注入、排序、缓存、解释** 的协议问题。

因此我们先把信息分成六层。经过 2026-04-29 的讨论，**User 与 Task 在 S004 早期可以合并理解为 UserTask**：用户原始输入就是当前任务消息，不做独立 task extraction；Runtime Context 放入 UserTaskContext，而不是 Default System。

1. **System**：长期稳定的 agent 身份与硬约束。
2. **Instruction**：来自项目、组织、用户偏好的外部指令。
3. **User Task**：用户原始输入及当前任务上下文，强调保真；S004 不做独立 task extraction。
4. **Task Mode（未来）**：从用户输入中抽象出的模式，如 plan / debug / review。
5. **Tool**：工具 schema、工具调用策略与 tool response。
6. **Response**：最终回答给用户的呈现契约。

这六层不是都要在 S004 实现，但都应该在设计里占有位置。

## 1. System

**定义**：模型最稳定、最高优先级的行为约束。

放这里的信息：

- Agent 是谁：Zero2Agent 课程里的只读 Agent Harness。
- 能力边界：查看文件、搜索内容、解释结果；当前不编辑、不执行 shell。
- 全局行为：按需调用工具、中文回答、简洁、引用路径。
- 不随每轮用户输入变化的工作流：先定位再精读。

不应放这里的信息：

- 用户本轮具体任务。
- 工具执行结果。
- 项目临时状态。
- 每个工具的完整参数说明（应在 tool schema）。

S004 适合落地：

- `buildSystemPrompt(options)`。
- 固定 section 顺序。
- Runtime Context 不进入 Default System，改由 UserTaskContext 承载。

## 2. Instruction

**定义**：来自 system 之外、但会影响 agent 行为的外部规则。

来源：

- `AGENTS.md` 或未来类似文件。
- 用户自定义偏好。
- 工作区配置。
- skills 或课程材料中特定章节的约束。

关键问题：

- Instruction 是拼进 system，还是作为独立 channel？
- 多个 instruction 冲突时优先级如何排？
- 是否按 cwd / 文件路径作用域生效？

S004 建议：

- 只定义原则，不实现 AGENTS.md 加载。
- 原则：System > Project Instruction > User Preference > Task。

## 3. User

**定义**：用户原始输入本身。

原则：

- 尽量保真，不在进入模型前过度改写。
- 若要加工，应产生一个独立 Task 层，而不是覆盖原始 user message。
- 后续中断/追加消息可以包成 reminder，但不能丢失用户原话。

关键问题：

- user message 中的路径、文件名、自然语言需求是否需要结构化？
- 多轮追加消息是否作为普通 user message，还是 system reminder？

S004 建议：

- 在 S004 语境下，将 UserMessage 视为 **UserTask**：它既是用户原文，也是当前任务入口。
- UserMessage 可以由多个 section 组成：UserTaskContext + UserTask。
- UserTaskContext 中先放 Runtime Context，后续可扩展 task mode、focused files、conversation summary 等。
- 在 spec 中说明：未来若引入 task extraction，不应替代原始 user message。

概念结构：

```text
UserMessage
  ├─ UserTaskContext
  │   └─ Runtime Context
  └─ UserTask
      └─ 用户原始输入
```

## 4. Task / Mode（未来）

**定义**：从用户输入和会话状态中抽象出的任务模式或执行框架。S004 不把它作为独立消息层实现。

例子：

- 普通问答：回答一个问题。
- 只读代码定位：找文件、读文件、解释。
- Plan 模式：先讨论方案，不执行。
- Debug 模式：先证据后修复。
- Review 模式：优先找问题而不是总结。

关键问题：

- Task 是 system prompt 的一段，还是 user message 之后的额外上下文？
- mode 是否属于 Task？
- task 是否应该结构化成 `{ mode, goal, constraints }`？

S004 建议：

- 只保留普通只读任务，不实现 mode。
- UserTask 等同于当前 user message，不做独立 task extraction。
- 但在设计中预留 `taskMode?: "default"` 这样的概念空间，避免后续 plan/debug/review 都来改 system 字符串。

## 5. Tool

**定义**：模型可调用能力及其输入输出契约。

包含三件事：

1. Tool schema：工具名、description、参数 JSON Schema。
2. Tool policy：什么时候用、如何组合。
3. Tool response：执行结果、错误、hint。

关键问题：

- 工具完整描述是否只在 schema？
- system 是否需要列工具名？
- tool 失败时的 hint 是工具 response 的一部分，还是额外 system reminder？
- 工具输出是否需要统一 envelope？

S004 建议：

- 工具完整说明归 tool schema。
- system 只写工具组合策略，不手写每个工具参数。
- tool response hint 进入后续 Story；当前只在 spec 中作为未来方向。

## 6. Response

**定义**：agent 最终面向用户的输出契约。

内容：

- 回答语言。
- 是否引用文件路径。
- 简洁程度。
- 是否总结工具过程。
- 出错时如何解释。

关键问题：

- Response 规则放 system 里，还是按 task/mode 动态注入？
- 中文回答是全局规则，还是用户偏好？
- 是否需要结构化输出？

S004 建议：

- 保留在 system 的 Output section。
- 当前只约束中文、简洁、必要时引用路径。

## 7. 推荐推进顺序

完整范围覆盖六层，但讨论顺序不应同时展开：

1. **System**：先定义最小 section 与 builder。
2. **Tool**：决定 tool description 是否 schema-only。
3. **Instruction**：定义 AGENTS.md / 用户偏好的未来位置。
4. **User + Task**：定义 task extraction 是否进入未来路线。
5. **Response**：定义输出契约。
6. **Runtime / Cache / Mode**：回头检查动态性与扩展点。

## 8. 对 S004 的范围建议

S004 最合适的边界：

- **设计覆盖六层**：文档里把 System / Instruction / User / Task / Tool / Response 都讲清楚。
- **实现只落 System + 部分 Tool Policy + Response**：也就是 `buildSystemPrompt(options)`。
- **Instruction / Task / Tool Response / Mode / Skills 进入 backlog**：不在本 Story 一次实现。

这样既不丢掉完整设计视野，又不会把一个课程 Story 做成整个 Agent Runtime 重构。
