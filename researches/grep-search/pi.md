# Pi Mono Grep/Search 工具调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| 调研 Commit | `83378aad7e74a0e2bb8f37c007a9685fb4609d8a` |
| 最近 Tag | `v0.58.3` |
| Commit 日期 | `2026-03-15 23:40:18 +0100` |
| 调研日期 | `2026-03-16` |

## 调研目标

为 E01-S002（内容搜索）迭代提供竞品参考。Pi 是一个用 TypeScript 实现的 AI Agent 工具箱，技术栈和我们的 zero2agent 最为接近，重点关注：

1. **功能设计** — grep 工具的参数设计和应用场景
2. **核心实现** — TypeScript + ripgrep 的集成方式
3. **独特亮点** — 与 OpenCode/Codex 的差异，值得借鉴的设计

## 调研结论

1. **参数设计最丰富**。Pi 的 grep 工具有 7 个参数（pattern、path、glob、ignoreCase、literal、context、limit），远多于 OpenCode（3 个）和 Codex（4 个）。额外的 `ignoreCase`、`literal`、`context` 参数让 LLM 有更多控制力。

2. **使用 ripgrep JSON 模式 + 自建格式化层**。Pi 用 `rg --json` 获取结构化输出，然后自己回读文件构建上下文行，输出格式类似 `grep -n` 但带上下文。这是三个项目中实现最精细的。

3. **可插拔的 Operations 接口**。`GrepOperations` 接口可以被替换为远程文件系统操作（如 SSH），这种解耦设计在三个项目中是独有的。

4. **截断体系最完善**。三层截断（match limit 100 + 单行 500 字符 + 总量 50KB），每层都有独立的提示信息。

5. **find 工具用 fd 而非 ripgrep**。内容搜索用 ripgrep，文件名搜索用 fd，各用最擅长的工具。

## 详细分析

### 一、工具体系

Pi 的 coding agent 有 7 个工具：

| 工具 | 说明 | 外部依赖 |
|------|------|----------|
| `read` | 读取文件 | 无 |
| `bash` | 执行 shell 命令 | 无 |
| `edit` | 编辑文件 | 无 |
| `write` | 写入文件 | 无 |
| `grep` | 内容搜索 | ripgrep (`rg`) |
| `find` | 文件名搜索 | fd (`fd`) |
| `ls` | 列出目录 | 无 |

搜索工具被归类为 **readOnlyTools**：

```typescript
// packages/coding-agent/src/core/tools/index.ts#L84-L85
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool];
```

### 二、grep 工具参数设计

```typescript
// packages/coding-agent/src/core/tools/grep.ts#L18-L30
const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
  context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});
```

**三项目参数对比**：

| 参数 | Pi | OpenCode | Codex |
|------|-----|----------|-------|
| `pattern` | 必填 | 必填 | 必填 |
| `path` | 可选 | 可选 | 可选 |
| `glob`/`include` | 可选 | 可选 | 可选 |
| `ignoreCase` | 可选 | — | — |
| `literal` | 可选 | — | — |
| `context` | 可选 | — | — |
| `limit` | 可选（默认 100） | 硬编码 100 | 可选（默认 100） |

Pi 的独特参数：

- **`ignoreCase`**：大小写不敏感搜索，映射为 `rg --ignore-case`
- **`literal`**：字面量搜索（非正则），映射为 `rg --fixed-strings`。避免 LLM 在搜索特殊字符时出错
- **`context`**：上下文行数，类似 `grep -C N`。让 LLM 能看到匹配行周围的代码

### 三、核心实现

#### ripgrep 调用

```typescript
// packages/coding-agent/src/core/tools/grep.ts#L152-L168
const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"];

if (ignoreCase) args.push("--ignore-case");
if (literal) args.push("--fixed-strings");
if (glob) args.push("--glob", glob);

args.push(pattern, searchPath);

const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
```

关键差异：Pi 使用 **`--json` 模式**获取结构化输出，而非 OpenCode 的 `--field-match-separator` 文本模式。

#### 流式处理 + JSON Lines 解析

```typescript
// packages/coding-agent/src/core/tools/grep.ts#L169,L236-L262
const rl = createInterface({ input: child.stdout });

rl.on("line", (line) => {
  let event: any;
  try { event = JSON.parse(line); } catch { return; }
  if (event.type === "match") {
    matchCount++;
    const filePath = event.data?.path?.text;
    const lineNumber = event.data?.line_number;
    if (filePath && typeof lineNumber === "number") {
      matches.push({ filePath, lineNumber });
    }
    if (matchCount >= effectiveLimit) {
      matchLimitReached = true;
      stopChild(true);  // 达到上限直接 kill 进程
    }
  }
});
```

**关键技巧**：使用 `readline` 流式解析 JSON Lines，达到匹配上限时直接 kill ripgrep 进程，避免不必要的搜索。OpenCode 是等 ripgrep 跑完再截断，Pi 的方式更节省资源。

#### 自建上下文格式化

```typescript
// packages/coding-agent/src/core/tools/grep.ts#L200-L231
const formatBlock = async (filePath: string, lineNumber: number): Promise<string[]> => {
  const relativePath = formatPath(filePath);
  const lines = await getFileLines(filePath);  // 读取完整文件
  const block: string[] = [];
  const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
  const end = contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;
  for (let current = start; current <= end; current++) {
    const isMatchLine = current === lineNumber;
    const { text: truncatedText } = truncateLine(sanitized);
    if (isMatchLine) {
      block.push(`${relativePath}:${current}: ${truncatedText}`);   // 匹配行
    } else {
      block.push(`${relativePath}-${current}- ${truncatedText}`);   // 上下文行
    }
  }
  return block;
};
```

Pi 不依赖 ripgrep 的 `-C` 参数，而是拿到匹配位置后**自己回读文件**构建上下文行。这允许通过 `GrepOperations` 对接远程文件系统。

输出格式使用 `:` 和 `-` 区分匹配行和上下文行（与 grep 传统格式一致）：

```
path/to/file.ts-41- // previous line (context)
path/to/file.ts:42: const x = "match"  (match)
path/to/file.ts-43- // next line (context)
```

#### 文件缓存

```typescript
// packages/coding-agent/src/core/tools/grep.ts#L137-L150
const fileCache = new Map<string, string[]>();
const getFileLines = async (filePath: string): Promise<string[]> => {
  let lines = fileCache.get(filePath);
  if (!lines) {
    const content = await ops.readFile(filePath);
    lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    fileCache.set(filePath, lines);
  }
  return lines;
};
```

同一文件多次匹配时，只读一次文件。

### 四、可插拔的 Operations 接口

```typescript
// packages/coding-agent/src/core/tools/grep.ts#L46-L51
export interface GrepOperations {
  isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
  readFile: (absolutePath: string) => Promise<string> | string;
}
```

**这是三个项目中的独有设计**。通过 `GrepOperations` 接口，grep 工具可以被替换为远程文件系统操作。Pi 的 `mom`（Slack Bot）包使用了不同的工具实现，这个接口支撑了多环境复用。

同样，`FindOperations` 接口支持自定义 `glob` 实现：

```typescript
// packages/coding-agent/src/core/tools/find.ts#L36-L41
export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]> | string[];
}
```

### 五、截断体系

Pi 的截断是三个项目中最完善的，有三层独立截断，每层都有对应的提示信息：

#### 第一层：匹配数限制

```typescript
// packages/coding-agent/src/core/tools/grep.ts#L34
const DEFAULT_LIMIT = 100;
// 达到上限时 kill ripgrep 进程
if (matchCount >= effectiveLimit) {
  matchLimitReached = true;
  stopChild(true);
}
```

提示：`"100 matches limit reached. Use limit=200 for more, or refine pattern"`

#### 第二层：单行长度截断

```typescript
// packages/coding-agent/src/core/tools/truncate.ts#L13
export const GREP_MAX_LINE_LENGTH = 500;  // 比 OpenCode 的 2000 更短
```

提示：`"Some lines truncated to 500 chars. Use read tool to see full lines"`

引导 LLM 对长行使用 read 工具查看完整内容。

#### 第三层：总量截断

```typescript
// packages/coding-agent/src/core/tools/truncate.ts#L11-L12
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
```

提示：`"50.0KB limit reached"`

#### 截断工具的精细设计

`truncate.ts` 提供了 `TruncationResult` 结构化结果，包含详细的截断元数据：

```typescript
// packages/coding-agent/src/core/tools/truncate.ts#L15-L38
export interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  lastLinePartial: boolean;
  firstLineExceedsLimit: boolean;
  maxLines: number;
  maxBytes: number;
}
```

还提供了 `truncateHead`（从头保留）和 `truncateTail`（从尾保留）两种截断方向，`grep` 用 `truncateHead`，`bash` 用 `truncateTail`（因为 bash 的错误信息通常在最后）。

### 六、工具二进制管理

```typescript
// packages/coding-agent/src/utils/tools-manager.ts
// 支持两个外部工具
const TOOLS: Record<string, ToolConfig> = {
  fd: { repo: "sharkdp/fd", ... },
  rg: { repo: "BurntSushi/ripgrep", ... },
};
```

- 优先检查本地工具目录，再检查 PATH
- 缺失时从 GitHub Releases 下载**最新版本**（非固定版本）
- 支持 darwin/linux/win32 × arm64/x86_64
- 支持 `PI_OFFLINE` 离线模式
- Android/Termux 提示用 `pkg install` 安装
- fd 和 rg 下载可并发（使用唯一临时目录避免竞争）

### 七、find 工具实现（对比参考）

Pi 的 find 工具使用 [fd](https://github.com/sharkdp/fd) 而非 ripgrep：

```typescript
// packages/coding-agent/src/core/tools/find.ts#L151-L157
const args: string[] = [
  "--glob",
  "--color=never",
  "--hidden",
  "--max-results", String(effectiveLimit),
];
```

**独特设计**：find 工具会主动收集目录中的所有 `.gitignore` 文件（包括嵌套的），传给 fd 的 `--ignore-file` 参数。这确保了搜索结果遵守项目的忽略规则。

### 八、工具描述设计

```typescript
// packages/coding-agent/src/core/tools/grep.ts#L69
description: `Search file contents for a pattern. Returns matching lines with file paths
and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches
or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to
${GREP_MAX_LINE_LENGTH} chars.`
```

描述中直接嵌入了截断参数值（用模板字符串），确保描述和实际行为一致。如果改了常量，描述自动更新。

## 关键源码引用

| 文件 | 说明 |
|------|------|
| `packages/coding-agent/src/core/tools/grep.ts` | grep 工具完整实现 |
| `packages/coding-agent/src/core/tools/find.ts` | find 工具完整实现 |
| `packages/coding-agent/src/core/tools/index.ts` | 工具注册与导出 |
| `packages/coding-agent/src/core/tools/truncate.ts` | 截断工具（truncateHead/truncateTail/truncateLine） |
| `packages/coding-agent/src/core/tools/path-utils.ts` | 路径解析工具 |
| `packages/coding-agent/src/utils/tools-manager.ts` | rg/fd 二进制下载管理 |
| `packages/agent/src/types.ts` | AgentTool 接口定义 |

## 三项目横向对比

| 维度 | Pi | OpenCode | Codex |
|------|-----|----------|-------|
| **语言** | TypeScript | TypeScript | Rust |
| **参数数量** | 7 | 3 | 4 |
| **返回内容** | 匹配行 + 上下文行 | 匹配行 | 仅文件路径 |
| **ripgrep 模式** | `--json`（JSON Lines） | `--field-match-separator` | `--files-with-matches` |
| **上下文行** | 支持（`context` 参数） | 不支持 | 不支持 |
| **大小写控制** | 支持（`ignoreCase`） | 不支持 | 不支持 |
| **字面量搜索** | 支持（`literal`） | 不支持 | 不支持 |
| **排序** | 无排序 | 按修改时间降序 | 按修改时间降序 |
| **达到上限时** | kill 进程 | 等待完成再截断 | ripgrep 自然截断 |
| **单行截断** | 500 字符 | 2000 字符 | 不适用 |
| **总量截断** | 50KB | 50KB | 无 |
| **匹配上限** | 100（LLM 可调） | 100（硬编码） | 100（LLM 可调，上限 2000） |
| **工具描述** | 模板字符串，嵌入截断参数 | 独立 .txt 文件 | 硬编码字符串 |
| **可扩展性** | Operations 接口 | 无 | 无 |
| **文件名搜索** | fd | ripgrep `--files` | 无独立工具 |
| **二进制版本** | 最新版（动态获取） | 14.1.1（固定） | 15.1.0（固定） |

## 对 E01-S002 的设计参考

### 1. 参数设计的取舍

Pi 提供了最多的参数（7 个），但对教学项目来说，核心三参数（`pattern` + `path` + `include`）足够。可以考虑后续迭代加入：
- **`literal`**：避免 LLM 搜索特殊字符时正则出错，教学价值高
- **`context`**：查看匹配上下文，帮助 LLM 理解代码结构

### 2. 流式处理 + 早停

Pi 在达到匹配上限时直接 kill ripgrep 进程，比 OpenCode 的"等跑完再截断"更高效。对于大仓库搜索，这个优化有实际意义。Node.js 中用 `child.kill()` 即可实现。

### 3. 截断工具的复用

Pi 的 `truncate.ts` 设计值得借鉴：
- `truncateHead` / `truncateTail` 区分不同工具场景
- `TruncationResult` 提供完整元数据
- `truncateLine` 用于单行截断
- 常量集中管理，工具描述用模板字符串引用

### 4. Operations 接口

对于教学项目，先做本地文件系统即可。但 Operations 接口的解耦思路值得了解，后续如果要支持远程项目或容器化环境会用到。

### 5. 工具描述中嵌入参数

```typescript
description: `...truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB...`
```

比硬编码字符串更不容易出现描述和实现不一致的问题。

## 参考资料

- [Pi Mono 仓库](https://github.com/badlogic/pi-mono)
- [fd 项目](https://github.com/sharkdp/fd)
- [ripgrep 项目](https://github.com/BurntSushi/ripgrep)
- [OpenCode Grep 调研](/researches/grep-search/opencode.md)
- [Codex Grep 调研](/researches/grep-search/codex.md)
- [E01-S002 讨论大纲](/.discuss/2026-03-16/e01-s002-content-search/outline.md)
