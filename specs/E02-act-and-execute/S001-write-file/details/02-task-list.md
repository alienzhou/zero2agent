# E02-S001: 任务清单

> 开发任务拆解与进度跟踪。
> **Story 状态**：✅ 已完成（实现 + 单测 + 编译全部通过）

---

## 开发任务

### Step 1: 共享路径边界校验

- 在 `packages/core/src/tools/` 下实现 `resolveInsideCwd(cwd, relPath)` 辅助（可放独立文件如 `path-guard.ts`，或各自内联）
- 逻辑：`path.resolve` 解析 → `path.relative` 判断是否以 `..` 开头 / 为绝对路径 → 越界抛出可识别错误或返回哨兵
- 单元测试：`../` 逃逸、绝对路径逃逸、cwd 内正常路径、cwd 自身

### Step 2: write_file 工具

- 创建 `packages/core/src/tools/write-file.ts`
- 定义 `input_schema`（`path` + `content`，均必填）
- 执行流程：边界校验 → `fs.access` 探测存在性 → `fs.mkdir(recursive)` 建父目录 → `fs.writeFile`
- 回执区分新建 / 覆盖，含字节数（`Buffer.byteLength`）
- 错误处理：越界 / 目标是目录 / 权限不足 / 其他 IO 错误
- 单元测试：新建、覆盖、自动建父目录、越界拒绝、写到目录路径报错

### Step 3: delete 工具

- 创建 `packages/core/src/tools/delete.ts`
- 定义 `input_schema`（`paths: string[]`，必填）
- 执行流程：对每个 path 逐个「尽力删」（边界校验 → stat 判断存在/是否目录 → `fs.rm`）
- 汇总：`succeeded` / `failed`，按方案 B 拼回执（全成功 / 全失败 `Error:` / 部分成功）
- 单元测试：全成功、部分失败（含不存在、是目录、越界）、全失败、空数组

### Step 4: 工具注册与集成

- 在 `packages/core/src/tools/index.ts` 的 `allTools` 中注册 `write_file` 和 `delete`
- 更新 `index.ts` 导出
- 验证 TypeScript 编译通过

### Step 5: TUI 层适配

- `packages/tui/src/cli.ts`：更新 system prompt，加入两个写工具的说明（若有工具清单/能力描述）
- 端到端验证：启动 CLI，让 Agent 新建文件、覆盖文件、批量删文件

### Step 6: 测试验证

- 单元测试全部通过
- 端到端手测三个典型场景：
  - 「在 src/ 下新建 config.ts」→ 观察 write_file 新建回执
  - 「把 config.ts 内容替换掉」→ 观察 write_file 覆盖回执
  - 「删掉 a.txt 和不存在的 b.txt」→ 观察 delete 部分失败逐条汇总
- 安全验证：让 Agent 尝试写/删 `../` 之外的路径 → 观察硬拒绝

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | ✅ 已完成 | `path-guard.ts` resolveInsideCwd |
| Step 2 | ✅ 已完成 | `write-file.ts` 实现 |
| Step 3 | ✅ 已完成 | `delete.ts` 实现（方案 B） |
| Step 4 | ✅ 已完成 | `index.ts` 注册与导出 |
| Step 5 | ✅ 已完成 | system prompt + TUI 适配 |
| Step 6 | ✅ 已完成 | 29 个单测通过，全仓库编译通过 |

**状态说明**：🔜 待开始 · 🚧 进行中 · ✅ 已完成 · ⏸️ 暂停
