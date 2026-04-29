# E01-S004: 任务清单

> 开发任务拆解与进度跟踪。  
> **Story 状态**：🔜 待开始

---

## 开发任务

### Step 1: Prompt 模块骨架

- [ ] 创建 `packages/core/src/prompt/` 目录
- [ ] 创建 `packages/core/src/prompt/system.ts`
- [ ] 创建 `packages/core/src/prompt/user-task.ts`
- [ ] 创建 `packages/core/src/prompt/index.ts`
- [ ] 在 `packages/core/src/index.ts` 导出 prompt builder 或相关类型

### Step 2: Default System Builder

- [ ] 在 `system.ts` 中实现 `buildSystemPrompt()`
- [ ] 按固定顺序组织 5 个 section：Role / Scope / Tool Policy / Workflow / Output Contract
- [ ] 从 System Prompt 中移除逐工具完整描述，只保留工具组合策略
- [ ] 确认 Runtime Context 不进入 Default System
- [ ] 保持返回值为单个 `string`

### Step 3: UserTaskContext Builder

- [ ] 在 `user-task.ts` 中实现 `buildUserTaskMessage(rawUserMessage, context)`
- [ ] 使用 XML-like tags 包裹 `user_task_context` 和 `user_task`
- [ ] Runtime Context 第一版包含 `cwd` 和 `date`
- [ ] 保持用户原始输入保真，不做改写或 task extraction
- [ ] 支持测试传入固定 date，避免测试依赖真实时间

### Step 4: Agent / Loop 集成

- [ ] 在 `Agent` 或 `runLoop` 入口处使用 `buildSystemPrompt()`
- [ ] 使用 `buildUserTaskMessage()` 构造第一条 user message
- [ ] 保留必要的 `systemPrompt` override 能力时，明确其优先级和用途
- [ ] 确认 `ToolContext.cwd` 与 UserTaskContext 中的 `cwd` 使用同一来源
- [ ] 确认 tool response 仍沿用现有 Anthropic `tool_result` 格式

### Step 5: TUI / Example 清理

- [ ] 删除 `packages/tui/src/cli.ts` 中的内联 `SYSTEM_PROMPT`
- [ ] TUI 创建 `Agent` 时只传入用户输入、事件回调和 `cwd`
- [ ] 更新 `examples/simple-agent.ts`，避免继续复制旧 `SYSTEM_PROMPT`
- [ ] 确认 TUI 输出行为不变

### Step 6: 测试与回归

- [ ] 增加 `buildSystemPrompt()` 单元测试：section 顺序、关键规则、无 Runtime Context
- [ ] 增加 `buildUserTaskMessage()` 单元测试：XML-like tags、cwd/date、用户原文保真
- [ ] 回归现有工具测试，确认工具调用不受影响
- [ ] 运行 `pnpm build`
- [ ] 运行 `pnpm test`

### Step 7: 文档与收尾

- [ ] 实现完成后更新本任务清单状态
- [ ] 如实现中调整了设计，回写 `01-technical-design.md`
- [ ] 更新 `CHANGELOG.md`
- [ ] 创建复盘文档 `retros/E01-S004-prompt-structure.md`
- [ ] 按项目规范准备 tag：`E01-S004-prompt-structure`

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | 🔜 待开始 | Prompt 模块骨架 |
| Step 2 | 🔜 待开始 | Default System Builder |
| Step 3 | 🔜 待开始 | UserTaskContext Builder |
| Step 4 | 🔜 待开始 | Agent / Loop 集成 |
| Step 5 | 🔜 待开始 | TUI / Example 清理 |
| Step 6 | 🔜 待开始 | 测试与回归 |
| Step 7 | 🔜 待开始 | 文档与收尾 |

**状态说明**：🔜 待开始 · 🚧 进行中 · ✅ 已完成 · ⏸️ 暂停
