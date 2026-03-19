# E01-S002: 技术设计

> grep_search 工具的设计说明，重点解释结构、关键决策和实现要点。

---

## 1. 整体结构

这次新增的内容可以拆成三个部分：

1. **ripgrep 集成层**
   - 负责获取 ripgrep 路径、构造命令参数、执行搜索
   - 通过 `@vscode/ripgrep` npm 包获取二进制

2. **结果处理层**
   - 解析 ripgrep 输出
   - 按修改时间排序
   - 截断和格式化

3. **工具定义层**
   - 实现 `Tool` 接口
   - 注册到 `allTools`

当前最值得看的代码入口：

- `packages/core/src/tools/grep-search.ts`（工具实现）
- `packages/core/src/tools/index.ts`（注册入口）

---

## 2. ripgrep 集成

### 2.1 为什么选 ripgrep

四家头部 Coding Agent（OpenCode / Codex / Pi / Gemini CLI）底层都用了 ripgrep。原因很直接：

- 搜索性能远超 Node.js 原生 `fs` + `RegExp`
- 天然遵守 `.gitignore`，不需要自己实现排除逻辑
- 正则语法完整，LLM 生成的 pattern 大概率能用

### 2.2 ripgrep 获取方式

通过 `@vscode/ripgrep` npm 包：

```typescript
import { rgPath } from '@vscode/ripgrep'
```

这个包在 `pnpm install` 时自动下载对应平台的 ripgrep 二进制，运行时零网络依赖。

### 2.3 ripgrep 调用参数

```typescript
const args = [
  '--json',           // JSON Lines 输出，便于结构化解析
  '--line-number',    // 输出行号
  '--color=never',    // 关闭颜色
  '--hidden',         // 搜索隐藏文件
  '--no-messages',    // 抑制错误信息
]

if (include) args.push('--glob', include)
if (exclude) args.push('--glob', `!${exclude}`)
if (context > 0) args.push('--context', String(context))

args.push('--regexp', pattern, searchPath)
```

使用 `--json` 模式获取结构化输出（与 Pi / Gemini CLI 一致），而非文本模式。JSON Lines 中每行是一个 JSON 对象，`type` 字段区分 `match`（匹配行）和 `context`（上下文行）。

---

## 3. 结果处理

### 3.1 解析流程

1. 执行 ripgrep，获取 stdout
2. 按行分割，解析 JSON Lines
3. 提取 `match` 和 `context` 类型的条目
4. 收集文件路径、行号、行内容、是否上下文行

### 3.2 排序

按文件修改时间降序排列：

```typescript
// 对每个匹配文件取 stat().mtime
// 最近修改的文件排在前面
matches.sort((a, b) => b.mtime - a.mtime)
```

理由：最近修改的文件更可能是 Agent 当前关注的上下文。OpenCode 和 Codex 都采用了这个策略。

### 3.3 截断

当前只做最简单的截断：匹配总数超过 100 条时截断，末尾附提示信息。

```
(Results truncated: showing 100 of N matches. Consider narrowing your search pattern or path.)
```

更精细的截断（单行长度、总量限制、早停等）留给后续迭代。

### 3.4 格式化输出

```
Found {matchCount} matches for "{pattern}" in {fileCount} files
---
File: {relativePath}
L{lineNumber}: {lineContent}          // 匹配行
L{lineNumber}- {lineContent}          // 上下文行（context > 0 时）
---
```

关键设计点：

- **相对路径**：节省 token
- **`L行号:` 格式**：简洁，匹配行用 `:`，上下文行用 `-`
- **`---` 分隔文件块**：结构清晰
- **首行摘要**：让 Agent 快速判断结果质量

---

## 4. 工具定义

### 4.1 参数设计推导

按"如何从零设计 Agent 工具"方法论的 Q2（使用者需要控制什么）推导：

类比 VS Code 全局搜索（Ctrl+Shift+F）的界面：

| VS Code UI | 对应参数 |
|------------|---------|
| 搜索词输入框 | `pattern` |
| files to include | `include` |
| files to exclude | `exclude` |
| 搜索范围 | `path` |

再加上 `context`（上下文行数），总计 5 个参数。

自动化的部分（不暴露参数）：
- `.gitignore` 排除 — ripgrep 默认行为
- 结果截断 — 工具内部处理
- 排序方式 — 固定按修改时间降序

### 4.2 工具描述

使用模板字符串，将截断参数嵌入 description，确保描述和实际行为自动同步：

```typescript
const MAX_MATCHES = 100

const description = `Search file contents using regex patterns. Returns matching lines with file paths and line numbers, sorted by file modification time. Results are truncated to ${MAX_MATCHES} matches. Respects .gitignore rules.`
```

### 4.3 错误处理

沿用 S001 的原则：工具出错时返回可读的错误文本，不抛异常。

典型错误场景：
- 正则语法无效 → 返回 ripgrep 的错误信息
- 搜索路径不存在 → 返回路径不存在的提示
- 无匹配结果 → 返回 "No matches found"

---

## 5. 流式输出与事件回调

实现 grep_search 的同时，顺带解决了一个体验问题：原来 `loop.ts` 里硬编码了 `console.log` 输出日志，TUI 层无法控制展示。

### 5.1 流式 API

将 `client.messages.create()` 切换为 `client.messages.stream()`，文本可以逐片段输出：

```typescript
const stream = client.messages.stream({ model, max_tokens, tools, messages, system })
stream.on('text', (text) => events?.onText?.(text))
const response = await stream.finalMessage()
```

### 5.2 事件回调

新增 `LoopEventHandlers` 接口，core 层通过回调暴露工具执行过程，TUI 层决定如何展示：

```typescript
interface LoopEventHandlers {
  onText?: (text: string) => void
  onToolStart?: (toolName: string, input: Record<string, unknown>) => void
  onToolEnd?: (toolName: string, output: string, durationMs: number) => void
  onToolError?: (toolName: string, error: string) => void
}
```

TUI 的展示效果：

```
  ⚡ grep_search(pattern: "runLoop")
  ✓ Found 32 matches in 10 files (89ms)

我找到了 32 个调用...（流式逐字输出）
```

---

## 6. 对现有代码的影响

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/core/src/tools/grep-search.ts` | grep_search 工具实现 |
| 修改 | `packages/core/src/tools/index.ts` | 在 `allTools` 加一项 |
| 修改 | `packages/core/src/loop.ts` | 流式 API + LoopEventHandlers 回调 |
| 修改 | `packages/core/src/agent.ts` | AgentOptions 透传 events |
| 修改 | `packages/tui/src/cli.ts` | 流式展示 + 工具调用格式化 |
| 新增 | `@vscode/ripgrep` 依赖 | `pnpm add` 到 core 包 |

现有的 `Tool` 接口、`read_file`、`list_directory` 不需要改动。

---

## 7. 设计决策记录（ADR）

### ADR-01：使用 ripgrep 而非 Node.js 原生

**决策**：底层搜索用 ripgrep。

**理由**：
1. 性能远超 `fs` + `RegExp` 遍历
2. 天然支持 `.gitignore`
3. 四家竞品都选了 ripgrep

### ADR-02：通过 @vscode/ripgrep 获取二进制

**决策**：用 npm 包分发 ripgrep，不做运行时下载。

**理由**：
1. install 时下载，避免运行时网络问题
2. VS Code 团队维护，可靠性有保障
3. 不需要自己管理多平台二进制

### ADR-03：使用 --json 模式解析输出

**决策**：用 ripgrep 的 JSON Lines 输出模式。

**理由**：
1. 结构化数据，解析可靠
2. 能区分 `match` 和 `context` 行
3. 包含精确的行号和文件路径

### ADR-04：按修改时间排序

**决策**：结果按文件修改时间降序排列。

**理由**：
1. 最近修改的文件更可能是当前关注的上下文
2. OpenCode 和 Codex 都采用了这个策略
3. 应用层 `stat()` 实现简单可靠

### ADR-05：输出用相对路径

**决策**：格式化输出使用相对路径而非绝对路径。

**理由**：
1. 节省 token
2. 结果更紧凑可读
3. Agent 使用 `read_file` 时可以直接用相对路径

---

## 8. 当前不做的事情

这一版明确暂不处理：

- 复杂截断策略（单行长度、总量限制、早停）
- 超时机制
- 降级策略（ripgrep 不可用时的 fallback）
- 自动上下文丰富（匹配少时自动附加上下文）
- `literal` / `case_sensitive` 等扩展参数
- 路径安全检查

这些在 [04-backlog.md](./04-backlog.md) 中有详细记录。
