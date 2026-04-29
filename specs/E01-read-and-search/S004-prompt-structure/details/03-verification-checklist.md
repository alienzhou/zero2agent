# E01-S004: 验收检查清单

> 开发过程中需要特别关注的检查项。

---

## 功能验收

### System Prompt Builder

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| `buildSystemPrompt()` 返回非空字符串 | P0 | 基本功能 |
| 返回内容包含 Role section | P0 | 说明 Agent 身份 |
| 返回内容包含 Scope section | P0 | 说明能力边界 |
| 返回内容包含 Tool Policy section | P0 | 说明工具使用策略 |
| 返回内容包含 Workflow section | P0 | 说明默认推进方式 |
| 返回内容包含 Output section | P0 | 说明回答格式约束 |
| 5 个 section 顺序正确 | P1 | Role → Scope → Tool Policy → Workflow → Output |
| Tool Policy 不包含工具参数详细说明 | P1 | 参数说明应在 tool schema |

### UserTask Builder

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| `buildUserTaskMessage()` 返回包含 `<user_task_context>` 标签 | P0 | 格式正确 |
| 返回内容包含 `<user_task>` 标签 | P0 | 用户原文被正确包装 |
| `cwd` 参数正确注入到 `<runtime_context>` | P0 | Runtime Context 功能 |
| `date` 参数正确注入到 `<runtime_context>` | P0 | Runtime Context 功能 |
| 用户原始输入保持原样，不被修改 | P0 | 保真原则 |
| `cwd` 和 `date` 可选，缺失时不报错 | P1 | 参数可选 |

### TUI 集成

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| `cli.ts` 不再包含内联 SYSTEM_PROMPT | P0 | 迁移完成 |
| Agent 使用 `buildSystemPrompt()` 生成的 prompt | P0 | 集成正确 |
| Agent 行为与迁移前一致 | P0 | 无功能回退 |

---

## 边界场景

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| `buildSystemPrompt()` 无参数调用正常工作 | P0 | 默认行为 |
| `buildSystemPrompt({})` 空对象调用正常工作 | P1 | 空配置 |
| `buildUserTaskMessage()` 用户输入为空字符串时正常工作 | P1 | 边界输入 |
| `buildUserTaskMessage()` 用户输入包含 XML 特殊字符时正常工作 | P2 | 特殊字符 |
| `buildUserTaskMessage()` 用户输入包含中文时正常工作 | P1 | 多语言 |

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 不支持 Instruction 加载 | AGENTS.md 等外部指令不在本 Story 实现 |
| 不支持 Mode 切换 | plan/debug/review 等模式不在本 Story 实现 |
| System message 返回 string | 不返回 string[]，未来 cache 需要时再扩展 |
| UserTaskContext 只支持 cwd 和 date | platform、repoRoot 等字段预留但不实现 |

---

## 优先级定义

- **P0** = 必须通过，不通过则不可发布
- **P1** = 应该检查，影响用户体验
- **P2** = 建议检查，边缘场景，可后续完善
