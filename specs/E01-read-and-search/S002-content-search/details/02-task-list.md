# E01-S002: 任务清单

> 开发任务拆解与进度跟踪。  
> **Story 状态**：✅ 已完成（Step 1–6 已与 E01-S002 交付对齐。）

---

## 开发任务

### Step 1: 依赖准备

- [x] 在 `packages/core` 安装 `@vscode/ripgrep`
- [x] 验证 `import { rgPath } from '@vscode/ripgrep'` 能正确获取 rg 路径
- [x] 验证 rg 能在当前平台正常执行

### Step 2: ripgrep 调用封装

- [x] 创建 `packages/core/src/tools/grep-search.ts`
- [x] 实现 ripgrep 命令构造（`--json`、`--glob`、`--context` 等参数映射）
- [x] 实现 `child_process.spawn` 调用 ripgrep
- [x] 实现 JSON Lines 输出解析（区分 match 和 context 类型）

### Step 3: 结果处理

- [x] 实现按文件修改时间降序排序（`fs.stat` 取 mtime）
- [x] 实现 100 条匹配上限截断
- [x] 实现输出格式化（Gemini CLI 风格：File 标签 + L行号 + --- 分隔）
- [x] 实现截断提示信息

### Step 4: 工具定义与注册

- [x] 实现 `Tool` 接口（name、description、input_schema、execute）
- [x] 工具描述使用模板字符串嵌入截断参数
- [x] 在 `packages/core/src/tools/index.ts` 的 `allTools` 中注册
- [x] 更新 `index.ts` 导出

### Step 5: 错误处理

- [x] 正则语法无效时返回友好错误信息
- [x] 搜索路径不存在时返回提示
- [x] 无匹配结果时返回 "No matches found"
- [x] ripgrep 执行异常时的兜底

### Step 6: 测试验证

- [x] 端到端测试："帮我找一下项目里哪里调用了 runLoop"
- [x] 测试 include 过滤："只搜 .ts 文件"
- [x] 测试 exclude 排除："排除测试文件"
- [x] 测试 context 参数："搜的时候带 3 行上下文"
- [x] 测试 grep_search → read_file 工具链

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | ✅ 已完成 | S002 交付 |
| Step 2 | ✅ 已完成 | S002 交付 |
| Step 3 | ✅ 已完成 | S002 交付 |
| Step 4 | ✅ 已完成 | S002 交付 |
| Step 5 | ✅ 已完成 | S002 交付 |
| Step 6 | ✅ 已完成 | S002 交付 |

**状态说明**：
- 🔜 待开始
- 🚧 进行中
- ✅ 已完成
- ⏸️ 暂停
