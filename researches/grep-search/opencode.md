# OpenCode Grep/Search 工具调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| 调研 Commit | `51fcd04a70258e40f04ec1b5ca165aab6a6dfc32` |
| 最近 Tag | `v1.2.27` |
| Commit 日期 | `2026-03-16 11:29:18 +0000` |
| 调研日期 | `2026-03-16` |

## 调研目标

为 E01-S002（内容搜索）迭代提供竞品参考，重点关注：

1. **功能的应用场景** — 头部开源 Coding Agent 为什么需要内容搜索、怎么定位它
2. **核心能力** — 工具参数设计、底层技术选型、结果格式
3. **实现的特殊技巧** — 排序策略、截断策略、LLM 引导描述等

## 调研结论

1. **底层一律用 ripgrep，不手写正则遍历**。OpenCode 直接 spawn `rg` 进程，性能和功能都远超 Node.js 原生实现。且内置了 ripgrep 自动下载逻辑，保证零配置可用。

2. **搜索工具按维度拆分，各司其职**。GrepTool（内容搜索）、GlobTool（文件名搜索）、CodeSearchTool（语义搜索）三者独立，参数和返回格式各自优化，不做"大一统"搜索。

3. **结果按修改时间排序，而非路径字母序**。最近修改的文件更可能是 LLM 当前关注的上下文，这个排序策略是 OpenCode 的一个亮点。

4. **截断是必选项，不是可选项**。匹配结果上限 100 条、单行 2000 字符、通用截断框架 2000 行 / 50KB，多层防护避免 token 爆炸。

5. **工具描述文本精心设计，引导 LLM 行为**。明确告知 LLM 何时用 Grep、何时用 Bash 的 `rg`、何时委托子 agent，减少工具误用。

## 详细分析

### 一、搜索工具体系概览

OpenCode 将搜索拆为三个独立工具，每个工具有明确的定位：

| 工具 | 定位 | 搜索对象 | 底层实现 |
|------|------|----------|----------|
| GrepTool | 内容搜索 | 文件内容（正则匹配） | ripgrep 文本模式 |
| GlobTool | 文件名搜索 | 文件路径（glob 模式） | ripgrep `--files` |
| CodeSearchTool | 语义搜索 | 外部 API/SDK 文档 | Exa Code API |

这和我们在 [讨论大纲](/.discuss/2026-03-16/e01-s002-content-search/outline.md) 中确认的 S002 vs S003 边界划分一致：

- S002 = 内容搜索（Grep 维度）
- S003 = 文件集合搜索（Glob 维度）

### 二、GrepTool 工具定义

#### 参数设计

```typescript
// packages/opencode/src/tool/grep.ts#L15-L21
export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
```

三个参数，极简但够用：

- `pattern`（必填）：正则表达式，由 ripgrep 解析，支持完整正则语法
- `path`（可选）：搜索目录，缺省为项目根目录。相对路径会 resolve 到项目目录
- `include`（可选）：文件过滤 glob，映射为 ripgrep 的 `--glob` 参数

**设计取舍**：没有 `exclude` 参数。排除逻辑依赖 ripgrep 默认的 `.gitignore` 规则，不额外暴露。这减少了 LLM 的参数选择负担。

#### 工具描述（System Prompt 可见）

```text
// packages/opencode/src/tool/grep.txt
- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\s+\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match sorted by modification time
- Use this tool when you need to find files containing specific patterns
- If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use `grep`.
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
```

关键点：

- 明确告诉 LLM 结果按**修改时间排序**
- 区分使用场景：简单搜索用 GrepTool，统计匹配数用 Bash `rg`，多轮搜索用 TaskTool
- 提供了正则示例（`"log.*Error"`, `"function\s+\w+"`），降低 LLM 构造 pattern 的出错率

### 三、底层实现：ripgrep 调用

#### ripgrep 路径解析与自动下载

```typescript
// packages/opencode/src/file/ripgrep.ts#L130-L209
const state = lazy(async () => {
  const system = which("rg")
  if (system) {
    const stat = await fs.stat(system).catch(() => undefined)
    if (stat?.isFile()) return { filepath: system }
  }
  // 如果系统没有 rg，自动下载 ripgrep 14.1.1
  const filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))
  // ... 下载、解压、赋权 ...
})
```

优先用系统 `rg`，找不到则自动下载。支持 6 个平台（macOS/Linux/Windows × amd64/arm64），确保零配置可用。使用 `lazy()` 保证只初始化一次。

#### GrepTool 的 ripgrep 调用方式

```typescript
// packages/opencode/src/tool/grep.ts#L42-L53
const rgPath = await Ripgrep.filepath()
const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", params.pattern]
if (params.include) {
  args.push("--glob", params.include)
}
args.push(searchPath)

const proc = Process.spawn([rgPath, ...args], {
  stdout: "pipe",
  stderr: "pipe",
  abort: ctx.abort,
})
```

ripgrep 参数解析：

| 参数 | 作用 |
|------|------|
| `-n` | 输出行号 |
| `-H` | 输出文件路径 |
| `--hidden` | 搜索隐藏文件 |
| `--no-messages` | 抑制错误信息（如断链符号链接） |
| `--field-match-separator=\|` | 用 `\|` 作为字段分隔符，便于解析 |
| `--regexp` | 指定搜索模式为正则 |
| `--glob` | 文件过滤 |

**关键细节**：ripgrep 默认遵循 `.gitignore`，所以 `node_modules` 等目录自动排除，不需要额外配置。

#### 输出解析

```typescript
// packages/opencode/src/tool/grep.ts#L80-L101
const lines = output.trim().split(/\r?\n/)
for (const line of lines) {
  if (!line) continue
  const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
  // ...
  const stats = Filesystem.stat(filePath)
  matches.push({
    path: filePath,
    modTime: stats.mtime.getTime(),
    lineNum,
    lineText,
  })
}
```

解析流程：

1. 按行分割（兼容 `\n` 和 `\r\n`）
2. 按 `|` 分隔符拆分为文件路径、行号、行内容
3. 对每个文件调用 `stat()` 获取修改时间
4. 将匹配结果收集为结构化数组

### 四、结果排序与截断策略

#### 按修改时间排序

```typescript
// packages/opencode/src/tool/grep.ts#L104
matches.sort((a, b) => b.modTime - a.modTime)
```

最近修改的文件排在前面。这比字母序更有价值——当前正在编辑的文件通常是 LLM 最需要看到的上下文。

#### 多层截断

**第一层**：匹配条数上限（GrepTool 自行控制）

```typescript
// packages/opencode/src/tool/grep.ts#L106-L108
const limit = 100
const truncated = matches.length > limit
const finalMatches = truncated ? matches.slice(0, limit) : matches
```

**第二层**：单行长度截断

```typescript
// packages/opencode/src/tool/grep.ts#L130-L131
const truncatedLineText =
  match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
```

`MAX_LINE_LENGTH = 2000`，防止压缩文件或超长行占满 token。

**第三层**：通用截断框架（Tool.define 中自动应用）

```typescript
// packages/opencode/src/tool/truncation.ts#L52-L61
export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
  const maxLines = options.maxLines ?? MAX_LINES   // 2000
  const maxBytes = options.maxBytes ?? MAX_BYTES    // 50KB
  // ...
}
```

GrepTool 因为自己设置了 `metadata.truncated`，会跳过通用截断。但其他工具（如 BashTool）会走通用截断。

截断后的提示信息也分两种情况：
- 有 TaskTool 时：建议委托子 agent 处理完整输出
- 无 TaskTool 时：建议用 Grep/Read 分段查看

### 五、输出格式

```text
Found 15 matches (showing first 100)

/absolute/path/to/file1.ts:
  Line 42: const foo = bar
  Line 88: export function baz()

/absolute/path/to/file2.ts:
  Line 15: import { something } from './module'

(Results truncated: showing 100 of 250 matches (150 hidden). Consider using a more specific path or pattern.)
```

格式特点：

- **首行**：总匹配数 + 是否截断
- **文件分组**：每个文件路径独立一行，后跟该文件的所有匹配行
- **行格式**：`Line {行号}: {内容}`，2 空格缩进
- **末尾提示**：截断时给出优化建议
- **使用绝对路径**：方便 LLM 直接传给 ReadTool

### 六、工具注册与权限

#### 注册

```typescript
// packages/opencode/src/tool/registry.ts#L104-L126
return [
  InvalidTool,
  BashTool,
  ReadTool,
  GlobTool,
  GrepTool,    // 直接注册，无条件启用
  EditTool,
  WriteTool,
  TaskTool,
  // ...
]
```

GrepTool 作为核心工具，无条件注册，不依赖 feature flag。

#### 权限检查

```typescript
// packages/opencode/src/tool/grep.ts#L27-L36
await ctx.ask({
  permission: "grep",
  patterns: [params.pattern],
  always: ["*"],
  // ...
})
```

- `permission: "grep"` — 由权限系统统一管理
- `always: ["*"]` — 任意 pattern 都自动放行（不需要每次确认）
- 外部目录访问需要额外授权（`assertExternalDirectory`）

### 七、Ripgrep.search() — 另一种调用模式

除了 GrepTool 中的文本模式，`ripgrep.ts` 还提供了 JSON 模式的搜索 API：

```typescript
// packages/opencode/src/file/ripgrep.ts#L335-L375
export async function search(input: {
  cwd: string
  pattern: string
  glob?: string[]
  limit?: number
  follow?: boolean
}) {
  const args = [`${await filepath()}`, "--json", "--hidden", "--glob=!.git/*"]
  // ...
  args.push("--")
  args.push(input.pattern)
  // 解析 JSON Lines，只保留 type === "match" 的条目
}
```

这种模式使用 `--json` 输出，ripgrep 返回结构化的 JSON Lines，包含 `path`、`line_number`、`submatches`（精确到子匹配位置）等信息。用于服务端 HTTP API（`GET /find?pattern=xxx`）。

两种模式对比：

| 维度 | GrepTool（文本模式） | Ripgrep.search()（JSON 模式） |
|------|---------------------|------------------------------|
| 输出格式 | 文本，手动解析 | JSON Lines，结构化 |
| 用途 | LLM 工具调用 | 内部 API / 服务端 |
| 精确度 | 行级别 | 子匹配级别（含 offset） |
| 性能 | 更快（少 JSON 开销） | 略慢但更精确 |

### 八、GlobTool 的搜索实现（对比参考）

```typescript
// packages/opencode/src/tool/glob.ts#L10-L20
export const GlobTool = Tool.define("glob", {
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z.string().optional().describe("The directory to search in..."),
  }),
```

GlobTool 底层也用 ripgrep，但使用 `rg --files --glob=<pattern>` 列出匹配文件，而非搜索文件内容。参数更简单（只有 `pattern` 和 `path`），结果也更简单（只返回文件路径列表）。

同样按修改时间排序，同样 100 条上限。

## 关键源码引用

| 文件 | 说明 |
|------|------|
| `packages/opencode/src/tool/grep.ts` | GrepTool 完整实现（参数定义、执行逻辑、结果格式化） |
| `packages/opencode/src/tool/grep.txt` | GrepTool 描述文本（LLM 可见的工具说明） |
| `packages/opencode/src/file/ripgrep.ts` | ripgrep 封装（路径解析、自动下载、files/search/tree API） |
| `packages/opencode/src/tool/tool.ts` | Tool.define 框架（参数校验、通用截断包装） |
| `packages/opencode/src/tool/truncation.ts` | 通用截断框架（行数/字节限制、临时文件保存） |
| `packages/opencode/src/tool/registry.ts` | 工具注册表（内置工具 + 自定义工具加载） |
| `packages/opencode/src/tool/glob.ts` | GlobTool 实现（文件名搜索，对比参考） |
| `packages/opencode/src/tool/codesearch.ts` | CodeSearchTool（语义搜索，对比参考） |
| `packages/opencode/src/tool/external-directory.ts` | 外部目录权限检查 |
| `packages/opencode/test/tool/grep.test.ts` | GrepTool 测试用例 |

## 对 E01-S002 的设计参考

基于本次调研，以下是对我们 S002 实现的关键参考点：

### 技术选型

- **推荐 ripgrep**：性能和功能远超 Node.js 原生，且 OpenCode 的自动下载逻辑证明了零配置可行
- **备选**：如果学习项目要降低外部依赖，可先用 Node.js `child_process` 调用系统 `grep`，但功能和性能都打折

### 参数设计

- **核心三参数**：`pattern`（正则）+ `path`（搜索目录）+ `include`（文件过滤）已足够覆盖常见场景
- **不需要 exclude**：依赖 ripgrep 的 `.gitignore` 自动排除即可
- **path 缺省值**：项目根目录，与 S001 的 `read_file` / `list_directory` 保持一致

### 结果格式

- **按修改时间排序**：对 LLM 更有价值，值得借鉴
- **文件分组 + 行号 + 内容**：OpenCode 的格式简洁有效
- **绝对路径**：方便 LLM 直接传给 read_file

### 截断策略

- **必须有截断**：匹配条数上限（如 100 条）+ 单行长度上限（如 2000 字符）
- **截断提示**：告知 LLM 结果被截断，建议缩小搜索范围

### 工具描述

- **需要精心设计**：明确告知 LLM 使用场景、不同搜索工具的边界
- **提供正则示例**：降低 LLM 构造 pattern 的出错率

## 参考资料

- [OpenCode 仓库](https://github.com/anomalyco/opencode)
- [OpenCode 工具文档](https://opencode.ai/docs/tools)
- [ripgrep 项目](https://github.com/BurntSushi/ripgrep)
- [E01-S002 讨论大纲](/.discuss/2026-03-16/e01-s002-content-search/outline.md)
