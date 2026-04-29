# E01-S004: 验收检查清单

> 开发过程中需要特别关注的检查项。

---

## 功能验收

### Default System Builder

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| `buildSystemPrompt()` 位于 `packages/core`，而不是 TUI | P0 | Core |
| Default System 按 Role / Scope / Tool Policy / Workflow / Output Contract 顺序输出 | P0 | Prompt |
| Default System 不包含 `cwd`、`date`、platform、git status 等 Runtime Context | P0 | Prompt |
| Default System 不逐个重复工具完整参数说明 | P0 | Prompt |
| Tool Policy 能说明 `find_files`、`grep_search`、`read_file`、`list_directory` 的组合方式 | P0 | Prompt |
| Output Contract 明确中文、简洁、必要时引用路径 | P1 | Prompt |

### UserTaskContext Builder

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| `buildUserTaskMessage()` 使用 XML-like tags 包裹上下文与用户任务 | P0 | Prompt |
| UserTaskContext 中包含 `cwd` | P0 | Prompt |
| UserTaskContext 中包含 `date` | P1 | Prompt |
| 用户原始输入放入 `<user_task>`，不被改写或覆盖 | P0 | Prompt |
| 用户原始输入包含 Markdown 标题、XML-like 文本或多行内容时仍保持保真 | P0 | Prompt |
| 测试可传入固定 date，避免快照随日期变化 | P1 | Prompt |

### Agent / TUI 集成

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| `packages/tui/src/cli.ts` 不再持有内联 `SYSTEM_PROMPT` | P0 | TUI |
| `examples/simple-agent.ts` 不再复制旧 prompt | P1 | Example |
| `Agent` / `runLoop` 仍能发送 system prompt 和第一条 user message | P0 | Core |
| `ToolContext.cwd` 与 UserTaskContext 的 `cwd` 来源一致 | P0 | Core |
| 现有工具调用链不退化 | P0 | Loop / Tools |

### Tool 描述策略

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| 工具完整能力说明仍保留在 tool `description` 中 | P0 | Tools |
| tool `input_schema` 未因 prompt 重构被弱化 | P0 | Tools |
| System Prompt 只写工具策略，不再维护第二份完整工具说明 | P0 | Prompt |
| `find_files → read_file` 和 `find_files → grep_search` 的组合提示仍可见 | P1 | Prompt |

---

## 业务流程验收

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| TUI 输入用户问题后，core 能构造 system + user task message | P0 | prompt/message 构造流程正确 |
| Runtime Context 出现在 user message 中，而不是 system 中 | P0 | 静态/动态边界正确 |
| 模型收到的第一条 user message 同时包含 context 和用户原文 | P0 | UserTaskContext 生效 |
| 工具执行仍使用 `ToolContext.cwd` 解析路径 | P0 | 与 S003 路径契约一致 |
| 最终回答仍遵循中文输出 | P1 | Output Contract 生效 |

---

## 边界场景

### 输入边界

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| 用户输入为空字符串时不构造无意义任务 | P1 | TUI 现有空输入过滤应保持 |
| 用户输入包含 `<user_task>` 等标签文本时仍保真 | P0 | 不能把用户文本误认为系统注入段 |
| 用户输入包含多行 Markdown / 代码块时保持原格式 | P0 | 避免破坏代码问题 |
| `cwd` 未传入时默认使用 `process.cwd()` | P0 | 与现有 AgentOptions 行为一致 |

### 状态边界

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| 无自定义 `systemPrompt` 时使用默认 builder | P0 | 默认路径可用 |
| 如保留 `systemPrompt` override，优先级清晰且有测试 | P1 | 避免默认 builder 被意外绕过 |
| 运行多轮工具调用时，后续 tool result 消息格式不变 | P0 | 不影响 ReAct 循环 |

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 不实现 AGENTS.md loader | S004 只定义 Instruction 层位置和优先级 |
| 不实现 skills 加载 | skills 归入 Instruction / Skills layer，后续单独做 |
| 不实现 plan/debug/review 模式 | 只预留 Mode System Fragment/Profile |
| 不实现 prompt cache | 只通过静态 System / 动态 UserTaskContext 分离为未来 cache 留边界 |
| 不实现 tool response hint envelope | 工具失败 hint 属于后续 Tool Response 契约 |
| 不做 task extraction | S004 阶段 UserTask = UserMessage，用户原文保真优先 |

---

## 优先级定义

- **P0** = 必须通过，不通过则不可发布
- **P1** = 应该检查，影响用户体验或后续扩展
- **P2** = 建议检查，边缘场景，可后续完善
