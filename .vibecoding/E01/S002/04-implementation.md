# 04 - 代码实现

> Thread: 基于 Spec 实现 grep_search + 流式输出
> 日期: 2026-03-19

---

## 背景

基于前序讨论输出的 Spec（`specs/E01-read-and-search/S002-content-search/`），开始实现 E01-S002 内容搜索工具。

---

## Round 1: 启动实现

**🧑 User:**

> 开始实现

**🤖 Agent:**

读取 Spec 任务清单与技术设计，确认实现路径：

1. 安装 `@vscode/ripgrep` 依赖
2. 创建 `grep-search.ts`（ripgrep 封装 + 结果处理 + 工具定义）
3. 注册到 `allTools`
4. 构建与端到端验证

实现要点：`--json` 模式解析、按 mtime 排序、100 条截断、Gemini CLI 风格输出。

---

## Round 2: 补充测试用例

**🧑 User:**

> 补充测试用例

**🤖 Agent:**

参考现有 `read_file` / `list_directory` 测试模式（临时目录 + 真实文件），新增 16 个 grep_search 测试：

| 分类 | 用例 |
|------|------|
| 基本搜索 | Gemini CLI 格式、行内容正确、跨多文件 |
| 参数功能 | path / include / exclude / context / context=0 |
| 排序 | 按 mtime 降序（`utimes` 控制） |
| 正则支持 | `function\s+\w+\(` 等 |
| 错误处理 | 路径不存在、无匹配、无效正则 |
| 工具定义 | name / schema / description |

---

## Round 3: System Prompt 更新

**🧑 User:**

> add（指在 cli.ts 的 SYSTEM_PROMPT 中添加 grep_search）

**🤖 Agent:**

在 `packages/tui/src/cli.ts` 的 system prompt 中补充 grep_search 工具说明。

---

## Round 4: 优化 Tool Output 展示

**🧑 User:**

> 优化展示 tool output

**🤖 Agent:**

当前问题：`loop.ts` 中 `console.log` 直接输出原始 JSON，TUI 无法控制展示。

方案：core 层加事件回调接口，替代硬编码 `console.log`；TUI 层实现格式化展示。

---

## Round 5: 支持流式打印

**🧑 User:**

> 支持流式打印内容

**🤖 Agent:**

实现流式输出 + 事件回调：

**core 层**：
- `client.messages.create()` → `client.messages.stream()`
- 新增 `LoopEventHandlers`（`onText` / `onToolStart` / `onToolEnd` / `onToolError`）
- 移除所有 `console.log`，改为事件回调

**TUI 层**：
- `onText` — 实时打印（`process.stdout.write`）
- `onToolStart` — `⚡ grep_search(pattern: "runLoop")`
- `onToolEnd` — `✓ Found 32 matches in 10 files (120ms)`
- `onToolError` — `✗ Error: ...`

测试：mock 从 `messages.create` 切换为 `messages.stream`，新增 3 个事件回调相关用例。

---

## Round 6: 同步更新文档

**🧑 User:**

> 记得同步更新对应的文档

**🤖 Agent:**

更新 4 个文档：

| 文档 | 更新内容 |
|------|----------|
| `details/02-task-list.md` | 全部 Step 标记 ✅，新增 Bonus 流式输出 |
| `details/01-technical-design.md` | 新增「流式输出与事件回调」节，更新影响评估 |
| `CHANGELOG.md` | 新增 E01-S002 条目，进度表标记 Done |

---

## Round 7: 类型修复

**🧑 User:**

> Fix it（TextBlock 缺少 `citations` 属性）

**🤖 Agent:**

Anthropic SDK v0.52.0 的 `TextBlock` 新增必填 `citations` 字段。测试 mock 中所有 `{ type: 'text', text: '...' }` 补上 `citations: null`。

---

## 产出总结

**改动文件**：
- 新增 `packages/core/src/tools/grep-search.ts`
- 修改 `packages/core/src/tools/index.ts`
- 修改 `packages/core/package.json`（`@vscode/ripgrep`）
- 修改 `packages/core/src/loop.ts`（流式 API + 事件回调）
- 修改 `packages/core/src/agent.ts`（透传 events）
- 修改 `packages/tui/src/cli.ts`（流式展示 + 工具格式化）
- 新增 `packages/core/src/__tests__/grep-search.test.ts`

**VibeCoding 技巧**：
- 实现前先读 Spec 任务清单，按 Step 推进
- 流式改造：mock 需从 `create` 切换为 `stream`，保持测试覆盖
- SDK 升级后及时检查类型变更（如 `citations`）
