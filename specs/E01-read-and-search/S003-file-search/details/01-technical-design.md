# E01-S003: 技术设计

> ToolContext 基础设施 + find_files 工具的设计说明，重点解释结构、关键决策和实现要点。

---

## 整体结构

这次改动分两个部分，按依赖关系排列：

1. **ToolContext 基础设施**（先做）
   - 新增 `ToolContext` 接口，修改 `Tool.execute` 签名
   - Agent/Loop 层传递上下文
   - 三个现有工具适配
   - 代码入口：`types.ts`、`loop.ts`、`agent.ts`、`read-file.ts`、`list-directory.ts`、`grep-search.ts`、`cli.ts`

2. **find_files 工具**（后做）
   - 调用 `rg --files --glob`，结果排序、截断、格式化
   - 注册到工具体系
   - 代码入口：`find-files.ts`、`index.ts`

---

## ToolContext 基础设施

### 为什么需要 ToolContext

S001/S002 的三个工具在处理相对路径时，都隐式依赖 `process.cwd()`：

| 工具 | 路径处理 |
|------|---------|
| `read_file` | `filePath` 直接传给 `fs.readFile` |
| `list_directory` | `dirPath` 直接传给 `fs.readdir` |
| `grep_search` | `searchPath` 传给 `rg`，默认 `'.'` |

这意味着从非项目根目录启动 CLI 时所有工具行为都会出错，测试里也只能用 `process.chdir()` 改全局状态。

### 设计方案

核心改动是给 `Tool.execute` 加第二参数 `ctx: ToolContext`，`ToolContext` 当前只包含 `cwd: string`。

改动沿着调用链从上往下传递：

| 层 | 改动 | 说明 |
|----|------|------|
| Agent | `AgentOptions` 新增 `cwd?: string` | 入口，默认 `process.cwd()` |
| Loop | `runLoop` 构造 `ToolContext` | 传给 `executeToolCalls` |
| 工具调用 | `tool.execute(input, ctx)` | 每次工具调用都带上下文 |
| 各工具 | `path.resolve(ctx.cwd, relativePath)` | 路径解析统一基准 |
| TUI | 创建 Agent 时显式传入 `cwd` | 不再隐式依赖 |

三个现有工具的适配模式完全相同：在 `execute` 入口处用 `path.resolve(ctx.cwd, ...)` 包一层输入路径，后续逻辑不变。

---

## find_files 工具

### ripgrep 调用

底层复用 S002 已接入的 `@vscode/ripgrep`，使用 `--files` 模式（只列文件路径，不搜索内容）。

与 `grep_search` 的 rg 调用对比：

| | `grep_search` | `find_files` |
|--|--------------|-------------|
| rg 模式 | `--json`（内容搜索） | `--files`（文件列举） |
| 核心输入 | `--regexp <pattern>` | `--glob <pattern>` |
| 输出格式 | JSON Lines（结构化匹配） | 纯文本（每行一个路径） |
| `--hidden` | ✅ | ✅ |
| `.gitignore` | 自动尊重 | 自动尊重 |

`include` 和 `exclude` 参数的映射方式也和 `grep_search` 一致——分别对应 `--glob <include>` 和 `--glob !<exclude>`。

### 结果处理流程

```
rg --files 输出
    ↓
按行分割，得到路径列表
    ↓
fs.stat() 取每个文件的 mtime → 按 mtime 降序排序
    ↓
截断到 100 条
    ↓
转换为相对路径（相对于搜索根目录）
    ↓
拼接输出字符串
```

### 排序

和 `grep_search` 一致，按文件修改时间降序。对比四家竞品：

| 项目 | 排序 | 我们的取舍 |
|------|------|-----------|
| OpenCode | mtime 降序 | ✅ 采用（简单、直觉好） |
| Pi | 无排序 | 不采用（对 Agent 不友好） |
| Gemini CLI | 双档分区（24h mtime + older 字典序） | 不采用（复杂度不值） |
| Codex | 无（rg 默认） | 不采用 |

### 截断与格式化

硬截断 100 条。输出格式：首行摘要（匹配文件数 + 搜索模式），后续每行一个相对路径。超出截断时末尾追加提示。无匹配时返回 `No files found matching "..."`。

工具描述（`description`）的最后一句明确和 `grep_search` 的分工——"Use this to find files by name; use grep_search to find files by content"——帮助模型在两者间做选择。

### 错误处理

沿用 S001/S002 的原则——工具出错时返回可读错误文本，不抛异常。

| 场景 | 处理 |
|------|------|
| 搜索路径不存在 | 返回路径不存在的提示 |
| rg 执行异常 | 返回 rg 的 stderr 内容 |
| 无匹配结果 | 返回无匹配提示 |

---

## 对现有代码的影响

| 改动 | 文件 | 说明 |
|------|------|------|
| 修改 | `packages/core/src/tools/types.ts` | 新增 `ToolContext`，修改 `Tool.execute` 签名 |
| 修改 | `packages/core/src/loop.ts` | 构造 `ToolContext`，传给工具调用 |
| 修改 | `packages/core/src/agent.ts` | `AgentOptions` 新增 `cwd` |
| 修改 | `packages/core/src/tools/read-file.ts` | 用 `ctx.cwd` 解析路径 |
| 修改 | `packages/core/src/tools/list-directory.ts` | 用 `ctx.cwd` 解析路径 |
| 修改 | `packages/core/src/tools/grep-search.ts` | 用 `ctx.cwd` 解析路径 |
| 新增 | `packages/core/src/tools/find-files.ts` | find_files 工具实现 |
| 修改 | `packages/core/src/tools/index.ts` | 在 `allTools` 注册 find_files |
| 修改 | `packages/tui/src/cli.ts` | 传入 `cwd`，更新 system prompt |

---

## 设计决策记录（ADR）

### ADR-01：使用 ToolContext 注入而非闭包工厂或 process.chdir

**决策**：给 `Tool.execute` 加第二参数 `ctx: ToolContext`。

**理由**：
1. 显式传递，不依赖全局状态
2. 可测试——测试时传不同 cwd 即可
3. `ToolContext` 是天然的扩展点，后续加字段不需要再改签名

### ADR-02：ToolContext 当前只放 cwd

**决策**：`ToolContext` 只包含 `cwd: string`，不预设其他字段。

**理由**：
1. YAGNI——权限模型、截断配置等目前没有明确需求
2. 加字段只需扩展接口，成本极低
3. 教学项目，保持简洁

### ADR-03：find_files 底层复用 ripgrep

**决策**：用 `rg --files --glob`，不引入 `fd` 或 npm `glob`。

**理由**：
1. S002 已接入 `@vscode/ripgrep`，零增量依赖
2. 五维评估综合最优（详见 D01 决策文档）
3. 学生不需要理解第二套工具链

---

## 当前不做的事情

这一版明确暂不处理：

- 复杂截断（字节限、分层截断）
- 路径安全检查（限制搜索范围在项目目录内）
- 降级策略（rg 不可用时的 fallback）
- `case_sensitive`、`ignore` 等扩展参数
- `find_files` 的早停优化（达到 limit 后终止 rg）
- `ToolContext` 扩展（权限、配置等）

详细理由见 [04-backlog.md](./04-backlog.md)。
