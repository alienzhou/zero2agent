# E01-S003: 验收检查清单

> 开发过程中需要特别关注的检查项。

---

## 功能验收

### ToolContext 基础设施

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| `ToolContext` 接口包含 `cwd: string` | P0 | Types |
| `Tool.execute` 签名接受 `ctx: ToolContext` | P0 | Types |
| `AgentOptions` 支持 `cwd` 选项 | P0 | Agent |
| `runLoop` 正确构造并传递 `ToolContext` | P0 | Loop |
| `cwd` 未提供时默认为 `process.cwd()` | P0 | Loop |

### 现有工具不退化

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| `read_file` 用 `ctx.cwd` 解析路径，行为不变 | P0 | Tools |
| `list_directory` 用 `ctx.cwd` 解析路径，行为不变 | P0 | Tools |
| `grep_search` 用 `ctx.cwd` 解析路径，行为不变 | P0 | Tools |

### find_files 基础功能

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| 能按 glob 模式找到文件（如 `**/*.ts`） | P0 | Tools |
| 返回结果为相对路径 | P0 | Tools |
| 结果按文件修改时间降序排列 | P0 | Tools |
| 超过 100 条时截断并提示 | P0 | Tools |
| 工具正确注册到 allTools | P0 | Tools |
| Agent 循环能正确调用 find_files | P0 | Loop |

### find_files 参数

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| `pattern` 支持 glob 语法（`**`、`*`、`{a,b}`） | P0 | Tools |
| `path` 缺省时搜索 `ctx.cwd` | P0 | Tools |
| `path` 指定时搜索对应子目录 | P1 | Tools |
| `include` 能做额外过滤 | P1 | Tools |
| `exclude` 能排除文件 | P1 | Tools |
| `.gitignore` 中的文件被自动排除 | P0 | Tools |

### 输出格式

| 检查项 | 优先级 | 模块 |
|--------|--------|------|
| 首行包含匹配文件数和搜索模式 | P1 | Tools |
| 每行一个相对路径 | P1 | Tools |
| 使用 POSIX 路径分隔符 | P1 | Tools |

---

## 工具链验收

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| `find_files → read_file` 链路通畅 | P0 | 找到文件后直接精读 |
| `find_files → grep_search` 链路通畅 | P1 | 找到文件范围后在其中搜内容 |
| Agent 能从 find_files 输出中提取路径传给 read_file | P0 | 输出格式对 LLM 可用 |

---

## 边界场景

### 输入边界

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| 空 pattern 处理 | P1 | `find_files({ pattern: "" })` |
| 不存在的搜索路径 | P1 | `path: "/nonexistent"` |
| 无匹配结果 | P0 | 返回 `No files found matching "..."` |

### 状态边界

| 检查项 | 优先级 | 说明 |
|--------|--------|------|
| ripgrep 可用性 | P0 | `@vscode/ripgrep` 正常安装 |
| 大目录搜索 | P2 | 结果量大时截断正常工作 |

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 无复杂截断 | 只做匹配条数截断，无字节限制 |
| 无早停优化 | 达到 100 条上限后 rg 仍会继续跑 |
| 无路径安全检查 | 可以搜索 cwd 之外的路径 |
| 无降级策略 | ripgrep 不可用时无 fallback |
| ToolContext 最简 | 只有 cwd，无权限、配置等 |

---

## 优先级定义

- **P0** = 必须通过，不通过则不可发布
- **P1** = 应该检查，影响用户体验
- **P2** = 建议检查，边缘场景，可后续完善
