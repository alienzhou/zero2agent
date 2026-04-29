# E01-S004: 任务清单

> 开发任务拆解与进度跟踪。  
> **Story 状态**：🔜 待开始

---

## 开发任务

### Step 1: 创建 Prompt 模块结构

- [ ] 创建 `packages/core/src/prompt/` 目录
- [ ] 创建 `packages/core/src/prompt/types.ts`，定义 `SystemPromptOptions` 和 `UserTaskOptions` 接口
- [ ] 创建 `packages/core/src/prompt/index.ts`，导出模块入口

### Step 2: 实现 System Prompt Builder

- [ ] 创建 `packages/core/src/prompt/system.ts`
- [ ] 实现 `buildRoleSection()` 函数
- [ ] 实现 `buildScopeSection()` 函数
- [ ] 实现 `buildToolPolicySection()` 函数
- [ ] 实现 `buildWorkflowSection()` 函数
- [ ] 实现 `buildOutputSection()` 函数
- [ ] 实现 `buildSystemPrompt(options)` 主函数，组装 5 个 section
- [ ] 在 `index.ts` 中导出 `buildSystemPrompt`

### Step 3: 实现 UserTask Builder

- [ ] 创建 `packages/core/src/prompt/user-task.ts`
- [ ] 实现 `buildRuntimeContext(options)` 辅助函数
- [ ] 实现 `buildUserTaskMessage(options)` 主函数
- [ ] 在 `index.ts` 中导出 `buildUserTaskMessage`

### Step 4: 更新 Core 导出

- [ ] 在 `packages/core/src/index.ts` 中导出 prompt 模块

### Step 5: 集成到 TUI

- [ ] 修改 `packages/tui/src/cli.ts`，移除内联 `SYSTEM_PROMPT` 常量
- [ ] 导入并调用 `buildSystemPrompt()` 生成 System Prompt
- [ ] 可选：使用 `buildUserTaskMessage()` 包装用户输入

### Step 6: 测试与验证

- [ ] 创建 `packages/core/src/prompt/__tests__/system.test.ts`
- [ ] 测试 `buildSystemPrompt()` 返回包含 5 个 section 的字符串
- [ ] 测试各 section 内容符合预期
- [ ] 创建 `packages/core/src/prompt/__tests__/user-task.test.ts`
- [ ] 测试 `buildUserTaskMessage()` 输出格式正确
- [ ] 测试 Runtime Context 字段可选
- [ ] 手动测试：运行 CLI，验证 Agent 行为与之前一致

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | 🔜 待开始 | 模块结构 |
| Step 2 | 🔜 待开始 | System Prompt Builder |
| Step 3 | 🔜 待开始 | UserTask Builder |
| Step 4 | 🔜 待开始 | Core 导出 |
| Step 5 | 🔜 待开始 | TUI 集成 |
| Step 6 | 🔜 待开始 | 测试验证 |

**状态说明**：🔜 待开始 · 🚧 进行中 · ✅ 已完成 · ⏸️ 暂停
