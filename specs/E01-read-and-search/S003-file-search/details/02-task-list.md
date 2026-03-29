# E01-S003: 任务清单

> 开发任务拆解与进度跟踪。  
> **Story 状态**：🔜 待开始

---

## 开发任务

### Step 1: ToolContext 基础设施

- [ ] 在 `packages/core/src/tools/types.ts` 中新增 `ToolContext` 接口（`{ cwd: string }`）
- [ ] 修改 `Tool` 接口的 `execute` 签名为 `(input, ctx: ToolContext) => Promise<string>`
- [ ] 在 `packages/core/src/agent.ts` 的 `AgentOptions` 中新增 `cwd?: string`
- [ ] 在 `packages/core/src/loop.ts` 的 `RunLoopOptions` 中新增 `cwd?: string`
- [ ] 在 `runLoop` 中构造 `ToolContext`（`cwd` 默认 `process.cwd()`）
- [ ] 修改 `executeToolCalls` 接受并传递 `ToolContext`
- [ ] 验证 TypeScript 编译通过（此时现有工具会报类型错误，进入 Step 2 修复）

### Step 2: 现有工具适配

- [ ] `read-file.ts`：`execute` 接收 `ctx`，用 `path.resolve(ctx.cwd, filePath)` 解析路径
- [ ] `list-directory.ts`：`execute` 接收 `ctx`，用 `path.resolve(ctx.cwd, dirPath)` 解析路径
- [ ] `grep-search.ts`：`execute` 接收 `ctx`，用 `path.resolve(ctx.cwd, searchPath)` 解析路径；`formatOutput` 的 `basePath` 也改为基于 `ctx.cwd`
- [ ] 验证 TypeScript 编译通过
- [ ] 验证现有工具行为不变（手动测试 `read_file`、`list_directory`、`grep_search`）

### Step 3: TUI 层适配

- [ ] `packages/tui/src/cli.ts`：创建 Agent 时传入 `cwd: process.cwd()`
- [ ] 更新 system prompt，增加 `find_files` 工具说明
- [ ] 端到端验证：启动 CLI，使用 `grep_search` 确认行为正常

### Step 4: find_files 工具实现

- [ ] 创建 `packages/core/src/tools/find-files.ts`
- [ ] 实现 rg 命令构造（`--files`、`--hidden`、`--glob` 参数映射）
- [ ] 实现 `child_process.spawn` 调用 ripgrep
- [ ] 实现结果解析（按行分割 stdout）
- [ ] 实现 mtime 排序（`fs.stat` 取 mtime，降序）
- [ ] 实现 100 条截断
- [ ] 实现输出格式化（首行摘要 + 相对路径列表 + 截断提示）
- [ ] 实现错误处理（路径不存在、rg 异常、无匹配）

### Step 5: 工具注册与集成

- [ ] 在 `packages/core/src/tools/index.ts` 的 `allTools` 中注册 `find_files`
- [ ] 更新 `index.ts` 导出
- [ ] 验证 TypeScript 编译通过

### Step 6: 测试验证

- [ ] 端到端测试："帮我找一下项目里所有的测试文件"
- [ ] 测试 include 过滤："找 src 目录下的 .ts 文件"
- [ ] 测试 exclude 排除："找所有配置文件，排除 node_modules"
- [ ] 测试 path 参数："在 packages/core 目录下找所有 .ts 文件"
- [ ] 测试 `find_files → read_file` 工具链
- [ ] 测试 `find_files → grep_search` 工具链
- [ ] 测试 `list_directory` 行为不受影响

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | 🔜 待开始 | ToolContext 基础设施 |
| Step 2 | 🔜 待开始 | 现有工具适配 |
| Step 3 | 🔜 待开始 | TUI 层适配 |
| Step 4 | 🔜 待开始 | find_files 实现 |
| Step 5 | 🔜 待开始 | 注册与集成 |
| Step 6 | 🔜 待开始 | 测试验证 |

**状态说明**：🔜 待开始 · 🚧 进行中 · ✅ 已完成 · ⏸️ 暂停
