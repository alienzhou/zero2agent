# E02-S002: 任务清单

> 开发任务拆解与进度跟踪。
> **Story 状态**：✅ 已完成（实现 + 单测 + 编译全部通过）

---

## 开发任务

### Step 1: replace_in_file 工具实现

- 创建 `packages/core/src/tools/replace-in-file.ts`
- 定义 `input_schema`（`path` / `old_string` / `new_string` 必填，`replace_all` 可选）
- 执行流程：边界校验 → stat 判文件 → 读全文 → 计数匹配 → 替换 → 写回
- 匹配计数与替换统一用 `split`/`join`（规避 `$` 替换占位符陷阱）
- 回执：成功报告替换处数；错误区分「文件不存在 / 是目录 / 未找到 / 不唯一 / 越界 / old_string 为空」
- 单元测试：唯一替换、replace_all 全量替换、未找到、不唯一、空 old_string、越界、删片段（空 new_string）、是目录、文件不存在

### Step 2: 工具注册与集成

- 在 `packages/core/src/tools/index.ts` 的 `allTools` 注册 `replace_in_file`
- 更新 `index.ts` 导出
- 验证 TypeScript 编译通过

### Step 3: Prompt 层适配

- `packages/core/src/prompt/system.ts`：
  - `buildScopeSection()`「你可以」增加「局部修改文件（字符串替换）」
  - `buildToolPolicySection()` 增加 replace_in_file 使用策略
- 更新 `system.test.ts` 断言覆盖新工具

### Step 4: TUI 层适配

- `packages/tui/src/cli.ts`：`summarizeToolOutput` 增加 `replace_in_file` 分支（返回首行）

### Step 5: 测试验证

- 单元测试全部通过
- 端到端手测典型场景（需 `ANTHROPIC_API_KEY`）：
  - 「把 config.ts 里超时从 30 改成 60」→ replace_in_file 唯一替换
  - 「把变量 foo 全部重命名为 bar」→ replace_all 全量替换
  - 「改一个写得太宽泛的字符串」→ 观察 Match not unique 报错

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | ✅ 已完成 | `replace-in-file.ts` 实现 |
| Step 2 | ✅ 已完成 | `index.ts` 注册与导出 |
| Step 3 | ✅ 已完成 | system prompt + 测试断言 |
| Step 4 | ✅ 已完成 | TUI summarize 分支 |
| Step 5 | ✅ 已完成 | 单测通过，全仓库编译通过 |

**状态说明**：🔜 待开始 · 🚧 进行中 · ✅ 已完成 · ⏸️ 暂停
