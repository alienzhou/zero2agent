# Gemini CLI Grep/Search 工具调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| 调研 Commit | `5acaacad96fe76d2f019885d64fab5979bd4b566` |
| 最近 Tag | N/A |
| Commit 日期 | `2026-03-19 10:45:59 +0000` |
| 调研日期 | `2026-03-19` |

## 调研目标

为 E01-S002（内容搜索）迭代提供竞品参考。Gemini CLI 是 Google 官方的 AI Agent CLI 工具，TypeScript 实现，重点关注：

1. **功能设计** — grep 工具的参数设计和搜索策略
2. **核心实现** — 三级降级策略、ripgrep/git grep/JS 的协同
3. **独特亮点** — 自动上下文丰富、双 grep 实现、与其他项目的差异

## 调研结论

1. **有两套 grep 实现，按 ripgrep 可用性分流**。`GrepTool` 是 fallback 实现（git grep → system grep → JS），`RipGrepTool` 是 ripgrep 专用实现。两者共享同一工具名 `grep_search`，但参数集不同 —— ripgrep 版本多出 `case_sensitive`、`fixed_strings`、`context`、`before`、`after`、`no_ignore` 六个参数。

2. **三级降级策略是四个项目中独有的**。`GrepTool` 按 git grep → system grep → Pure JS 依次降级，确保在任何环境下都能工作。这对跨平台兼容性很重要。

3. **自动上下文丰富（Auto Context）是最大亮点**。当匹配数 ≤ 3 时，自动为每个匹配附加 15-50 行上下文，减少 agent 后续 read_file 调用。据 Gemini CLI 注释，这个优化在 SWE-Bench 上减少了 ~10% 的 turn 数。

4. **参数数量最多（ripgrep 版本 13 个）**。在四个项目中参数设计最丰富，新增了 `exclude_pattern`（排除匹配）、`names_only`（仅返回文件名）、`max_matches_per_file`（单文件上限）、`before`/`after`（非对称上下文）等独特参数。

5. **按模型家族适配工具 schema**。有 `ToolDefinition` 机制，可以根据不同模型（如 gemini-3 vs legacy）返回不同的工具参数描述，在四个项目中是独有的。

## 详细分析

### 一、搜索工具体系

Gemini CLI 的搜索工具分三个：

| 工具 | 定位 | 底层实现 |
|------|------|----------|
| `grep_search`（GrepTool） | 内容搜索（fallback） | git grep / system grep / JS |
| `grep_search`（RipGrepTool） | 内容搜索（优先） | ripgrep JSON 模式 |
| `glob`（GlobTool） | 文件名搜索 | npm `glob` 包 |

两个 grep 实现共用同一个工具名 `grep_search`，运行时根据 ripgrep 是否可用选择注册哪个。

```typescript
// packages/core/src/tools/definitions/base-declarations.ts#L33
export const GREP_TOOL_NAME = 'grep_search';
```

### 二、GrepTool 参数设计

#### 基础版（GrepTool，无 ripgrep 时使用）

```typescript
// packages/core/src/tools/grep.ts#L45-L80
export interface GrepToolParams {
  pattern: string;              // 正则表达式
  dir_path?: string;            // 搜索目录
  include_pattern?: string;     // 文件过滤 glob
  exclude_pattern?: string;     // 排除正则
  names_only?: boolean;         // 仅返回文件路径
  max_matches_per_file?: number; // 单文件匹配上限
  total_max_matches?: number;   // 总匹配上限，默认 100
}
```

#### 增强版（RipGrepTool，有 ripgrep 时使用）

```typescript
// packages/core/src/tools/ripGrep.ts#L113-L178
export interface RipGrepToolParams {
  pattern: string;
  dir_path?: string;
  include_pattern?: string;
  exclude_pattern?: string;
  names_only?: boolean;
  case_sensitive?: boolean;      // 大小写敏感，默认 false
  fixed_strings?: boolean;       // 字面量搜索
  context?: number;              // 上下文行数（-C）
  after?: number;                // 后文行数（-A）
  before?: number;               // 前文行数（-B）
  no_ignore?: boolean;           // 忽略 .gitignore
  max_matches_per_file?: number;
  total_max_matches?: number;
}
```

**四项目参数对比**：

| 参数 | Gemini CLI (ripgrep) | Pi | OpenCode | Codex |
|------|---------------------|-----|----------|-------|
| `pattern` | 必填 | 必填 | 必填 | 必填 |
| `path`/`dir_path` | 可选 | 可选 | 可选 | 可选 |
| `include`/`glob` | 可选 | 可选 | 可选 | 可选 |
| `exclude_pattern` | 可选 | — | — | — |
| `names_only` | 可选 | — | — | — |
| `case_sensitive` | 可选 | 可选(`ignoreCase`) | — | — |
| `fixed_strings`/`literal` | 可选 | 可选 | — | — |
| `context` | 可选 | 可选 | — | — |
| `before` | 可选 | — | — | — |
| `after` | 可选 | — | — | — |
| `no_ignore` | 可选 | — | — | — |
| `max_matches_per_file` | 可选 | — | — | — |
| `total_max_matches`/`limit` | 可选（默认 100） | 可选（默认 100） | 硬编码 100 | 可选（默认 100） |
| **总参数数** | **13** | **7** | **3** | **4** |

Gemini CLI 独有参数：
- **`exclude_pattern`**：正则排除匹配行，应用层做二次过滤
- **`names_only`**：仅返回文件路径列表，类似 Codex 的 `--files-with-matches`
- **`max_matches_per_file`**：单文件匹配上限，映射为 `--max-count`
- **`before`/`after`**：非对称上下文（如只看匹配后 5 行），Pi 只有对称的 `context`
- **`no_ignore`**：忽略 .gitignore 规则，方便搜索 build 产物

### 三、三级降级策略（GrepTool）

`GrepTool` 的 `performGrepSearch` 方法实现了三级降级：

```
Strategy 1: git grep  (Git 仓库 + git 可用)
    ↓ 失败
Strategy 2: system grep  (grep 命令可用)
    ↓ 失败
Strategy 3: Pure JavaScript  (使用 glob + RegExp)
```

#### Strategy 1: git grep

```typescript
// packages/core/src/tools/grep.ts#L388-L434
const gitArgs = [
  'grep',
  '--untracked',   // 搜索未追踪文件
  '-n',            // 输出行号
  '-E',            // 扩展正则
  '--ignore-case', // 大小写不敏感
  pattern,
];
if (max_matches_per_file) {
  gitArgs.push('--max-count', max_matches_per_file.toString());
}
if (include_pattern) {
  gitArgs.push('--', include_pattern);
}
```

优先使用 `git grep` 是因为它天然遵守 `.gitignore`，且在 Git 仓库中性能极好。`--untracked` 确保新文件也能被搜到。

#### Strategy 2: system grep

```typescript
// packages/core/src/tools/grep.ts#L441-L511
const grepArgs = ['-r', '-n', '-H', '-E', '-I'];
// 从 fileExclusions 提取目录名作为 --exclude-dir
commonExcludes.forEach((dir) => grepArgs.push(`--exclude-dir=${dir}`));
```

使用系统 `grep` 命令，通过 `--exclude-dir` 排除常见目录（node_modules、.git 等）。

#### Strategy 3: Pure JavaScript Fallback

```typescript
// packages/core/src/tools/grep.ts#L517-L583
const filesStream = globStream(globPattern, {
  cwd: absolutePath,
  dot: true,
  ignore: ignorePatterns,
  absolute: true,
  nodir: true,
  signal: options.signal,
});

const regex = new RegExp(pattern, 'i');
for await (const filePath of filesStream) {
  const content = await fsPromises.readFile(fileAbsolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (regex.test(lines[index])) {
      allMatches.push({ ... });
    }
  }
}
```

纯 JS 实现，使用 `glob` 包的流式 API 遍历文件，逐行正则匹配。性能最差但跨平台兼容性最好。

**与其他项目对比**：
- OpenCode、Pi：只有 ripgrep 一条路径
- Codex：ripgrep + shell 两条路径（但让 agent 自己选）
- Gemini CLI：三级自动降级，无需用户干预

### 四、RipGrepTool 实现

#### ripgrep 获取策略

```typescript
// packages/core/src/tools/ripGrep.ts#L56-L90
// 不使用系统 PATH 上的 rg，只用自己下载的
// 原因：还未做 checksum 校验，不信任外部二进制
async function ensureRipgrepAvailable(): Promise<string | null> {
  const existingPath = await resolveExistingRgPath();
  if (existingPath) return existingPath;
  // 首次使用时自动下载
  await downloadRipGrep(Storage.getGlobalBinDir());
  return await resolveExistingRgPath();
}
```

**关键决策**：Gemini CLI 有意**不使用系统 rg**，只信任自己下载的版本。原因是安全考虑——外部二进制可能被篡改，需要 checksum 校验才能放心使用。这是四个项目中安全意识最强的。

#### ripgrep 调用

```typescript
// packages/core/src/tools/ripGrep.ts#L414-L471
const rgArgs = ['--json'];
if (!case_sensitive) rgArgs.push('--ignore-case');
if (fixed_strings) rgArgs.push('--fixed-strings');
rgArgs.push('--regexp', pattern);
if (context) rgArgs.push('--context', context.toString());
if (after) rgArgs.push('--after-context', after.toString());
if (before) rgArgs.push('--before-context', before.toString());
if (no_ignore) rgArgs.push('--no-ignore');
if (max_matches_per_file) rgArgs.push('--max-count', max_matches_per_file.toString());
if (include_pattern) rgArgs.push('--glob', include_pattern);
// 排除模式
excludes.forEach((exclude) => rgArgs.push('--glob', `!${exclude}`));
// .geminiignore 支持
for (const ignorePath of geminiIgnorePaths) {
  rgArgs.push('--ignore-file', ignorePath);
}
rgArgs.push('--threads', '4');
```

关键特点：
- 使用 `--json` 模式（与 Pi 相同，与 OpenCode 不同）
- 默认大小写不敏感（`--ignore-case`）
- 限制线程数为 4（`--threads 4`），避免在大仓库中占满 CPU
- 支持 `.geminiignore` 自定义忽略文件

#### JSON Lines 解析

```typescript
// packages/core/src/tools/ripGrep.ts#L514-L559
private parseRipgrepJsonLine(line: string, basePath: string): GrepMatch | null {
  const json = JSON.parse(line);
  if (json.type === 'match' || json.type === 'context') {
    const data = json.data;
    if (data.path?.text && data.lines?.text) {
      return {
        absolutePath: path.resolve(basePath, data.path.text),
        filePath: path.relative(basePath, absoluteFilePath),
        lineNumber: data.line_number,
        line: data.lines.text.trimEnd(),
        isContext: json.type === 'context',
      };
    }
  }
  return null;
}
```

ripgrep `--json` 输出的 `type` 字段可以是 `match`（匹配行）或 `context`（上下文行）。Gemini CLI 同时处理两种类型，用 `isContext` 标记区分。

### 五、自动上下文丰富（Auto Context）

这是 Gemini CLI 最独特的设计，在四个项目中独有：

```typescript
// packages/core/src/tools/grep-utils.ts#L65-L133
export async function enrichWithAutoContext(
  matchesByFile, matchCount, params,
): Promise<void> {
  // 条件：1-3 个匹配 且 用户没有指定 context/before/after
  if (matchCount >= 1 && matchCount <= 3 && !names_only
      && context === undefined && before === undefined && after === undefined) {
    // 1 个匹配：50 行上下文
    // 2-3 个匹配：15 行上下文
    const contextLines = matchCount === 1 ? 50 : 15;
    // 回读文件，添加上下文行
    for (const filePath in matchesByFile) {
      const fileLines = await readFileLines(fileMatches[0].absolutePath);
      // ...构建上下文
    }
  }
}
```

```typescript
// packages/core/src/tools/grep-utils.ts#L167-L168
// 据注释：这个优化在 SWE-Bench 上减少了 ~10% 的 turn 数
await enrichWithAutoContext(matchesByFile, matchCount, params);
```

**设计思路**：当搜索结果很少时，agent 大概率会接着用 `read_file` 查看匹配上下文。与其让 agent 多一次工具调用，不如直接在 grep 结果中附带上下文。

RipGrepTool 更进一步，Auto Context 直接用 ripgrep 的 `--context` 参数重新搜索：

```typescript
// packages/core/src/tools/ripGrep.ts#L329-L378
private async enrichWithRipgrepAutoContext(...) {
  if (matchCount >= 1 && matchCount <= 3 && ...) {
    const contextLines = matchCount === 1 ? 50 : 15;
    // 用 ripgrep --context 重新搜索，只搜已匹配的文件
    let enrichedMatches = await this.performRipgrepSearch({
      pattern: this.params.pattern,
      path: uniqueFiles,  // 只搜匹配过的文件
      context: contextLines,
      ...
    });
    return enrichedMatches;
  }
}
```

这比 GrepTool 的 JS 回读方式更高效——直接让 ripgrep 在已匹配文件上带 context 重跑一次。

### 六、超时与中断机制

```typescript
// packages/core/src/tools/constants.ts
export const DEFAULT_TOTAL_MAX_MATCHES = 100;
export const DEFAULT_SEARCH_TIMEOUT_MS = 30000;  // 30 秒
```

```typescript
// packages/core/src/tools/grep.ts#L217-L228
const timeoutController = new AbortController();
const timeoutId = setTimeout(() => {
  timeoutController.abort();
}, DEFAULT_SEARCH_TIMEOUT_MS);

// 链接外部 signal 和超时 controller
const onAbort = () => timeoutController.abort();
signal.addEventListener('abort', onAbort, { once: true });
```

30 秒超时，与 Codex 一致。使用 `AbortController` 链式传递——既支持外部取消，也支持超时自动取消。

流式处理时达到匹配上限直接 break（与 Pi 的 kill 进程类似）：

```typescript
// packages/core/src/tools/ripGrep.ts#L490-L505
for await (const line of generator) {
  const match = this.parseRipgrepJsonLine(line, parseBasePath);
  if (match) {
    results.push(match);
    if (!match.isContext) matchesFound++;
    if (matchesFound >= maxMatches) break;
  }
}
```

### 七、截断与输出格式

#### 单行截断

```typescript
// packages/core/src/utils/constants.ts#L11
export const MAX_LINE_LENGTH_TEXT_FILE = 2000;
```

```typescript
// packages/core/src/tools/grep-utils.ts#L203-L208
const graphemes = Array.from(lineContent);
if (graphemes.length > MAX_LINE_LENGTH_TEXT_FILE) {
  lineContent = graphemes.slice(0, MAX_LINE_LENGTH_TEXT_FILE).join('') + '... [truncated]';
}
```

使用 grapheme 计数而非 `string.length`（处理 emoji 等多码位字符），2000 字符截断。

#### 输出格式

```text
Found 15 matches for pattern "import.*React" in path "." (filter: "*.tsx"):
---
File: src/components/App.tsx
L1: import React from 'react'
L5- const App = () => {      (上下文行用 - 分隔)
L6: import { useState } from 'react'
---
File: src/pages/Home.tsx
L3: import React, { useEffect } from 'react'
---
```

格式特点：
- **首行**：总匹配数 + 搜索路径 + 过滤器 + 是否截断
- **文件分组**：`File: <相对路径>`，用 `---` 分隔
- **行格式**：`L{行号}: {内容}`（匹配行）或 `L{行号}- {内容}`（上下文行）
- **使用相对路径**：与 OpenCode 的绝对路径不同

#### names_only 模式

```typescript
// packages/core/src/tools/grep-utils.ts#L172-L186
if (names_only) {
  const filePaths = Object.keys(matchesByFile).sort();
  let llmContent = `Found ${filePaths.length} files with matches...`;
  llmContent += filePaths.join('\n');
  return { llmContent, returnDisplay: `Found ${filePaths.length} files` };
}
```

类似 Codex 的 `--files-with-matches`，但作为可选参数而非默认行为。

### 八、安全与路径验证

```typescript
// packages/core/src/tools/grep.ts#L149-L152
const validationError = this.config.validatePathAccess(searchDirAbs, 'read');
if (validationError) {
  return { llmContent: validationError, ... };
}
```

路径验证是必须的——确保搜索目录在 workspace 范围内。还有路径穿越检查：

```typescript
// packages/core/src/tools/grep.ts#L120-L127
const relativeCheck = path.relative(basePath, absoluteFilePath);
if (relativeCheck === '..' || relativeCheck.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeCheck)) {
  return null;
}
```

### 九、模型适配的工具 schema

```typescript
// packages/core/src/tools/definitions/coreTools.ts#L103-L113
export function getToolSet(modelId?: string): CoreToolSet {
  const family = getToolFamily(modelId);
  switch (family) {
    case 'gemini-3': return GEMINI_3_SET;
    case 'default-legacy':
    default: return DEFAULT_LEGACY_SET;
  }
}
```

不同模型可能收到不同的工具描述和参数。比如 legacy 模型的 grep 描述更简单（`'Max 100 matches.'`），而 ripgrep 版本的描述更详细（提到 Rust regex、`\b` 边界匹配等）。

### 十、GlobTool 实现

```typescript
// packages/core/src/tools/glob.ts#L42-L65
export function sortFileEntries(entries, nowTimestamp, recencyThresholdMs) {
  // 24 小时内修改的文件按时间倒序排在前面
  // 更早的文件按路径字母序排在后面
  sortedEntries.sort((a, b) => {
    const aIsRecent = nowTimestamp - mtimeA < recencyThresholdMs;
    const bIsRecent = nowTimestamp - mtimeB < recencyThresholdMs;
    if (aIsRecent && bIsRecent) return mtimeB - mtimeA;
    else if (aIsRecent) return -1;
    else if (bIsRecent) return 1;
    else return a.fullpath().localeCompare(b.fullpath());
  });
}
```

GlobTool 的排序策略很独特——**混合排序**：最近 24 小时内修改的文件按时间倒序排前面，更早的文件按字母序排后面。这比 OpenCode/Codex 的纯时间排序更合理。

GlobTool 使用 npm `glob` 包而非 ripgrep `--files`。支持 `.geminiignore` 和 `.gitignore`。

## 关键源码引用

| 文件 | 说明 |
|------|------|
| `packages/core/src/tools/grep.ts` | GrepTool 完整实现（三级降级策略） |
| `packages/core/src/tools/ripGrep.ts` | RipGrepTool 实现（ripgrep 专用路径） |
| `packages/core/src/tools/grep-utils.ts` | 共享的结果格式化和自动上下文丰富逻辑 |
| `packages/core/src/tools/glob.ts` | GlobTool 实现（文件名搜索） |
| `packages/core/src/tools/constants.ts` | 搜索常量（默认上限 100、超时 30s） |
| `packages/core/src/tools/tool-names.ts` | 工具名常量和别名机制 |
| `packages/core/src/tools/definitions/base-declarations.ts` | 工具名和参数名常量注册表 |
| `packages/core/src/tools/definitions/model-family-sets/default-legacy.ts` | 工具 Schema 定义（含 grep_search 和 grep_search_ripgrep） |
| `packages/core/src/tools/definitions/coreTools.ts` | 工具定义编排层（按模型家族解析） |
| `packages/core/src/utils/ignorePatterns.ts` | 文件排除模式管理 |
| `packages/core/src/utils/shell-utils.ts#L795` | `execStreaming` 流式命令执行 |
| `packages/core/src/utils/constants.ts#L11` | 单行截断常量（2000 字符） |

## 四项目横向对比

| 维度 | Gemini CLI | Pi | OpenCode | Codex |
|------|-----------|-----|----------|-------|
| **语言** | TypeScript | TypeScript | TypeScript | Rust |
| **参数数量** | 13 (ripgrep) / 7 (fallback) | 7 | 3 | 4 |
| **返回内容** | 匹配行 + 自动上下文 | 匹配行 + 上下文行 | 匹配行 | 仅文件路径 |
| **ripgrep 模式** | `--json` | `--json` | `--field-match-separator` | `--files-with-matches` |
| **降级策略** | git grep → grep → JS | 无 | 无 | 无 |
| **上下文行** | 自动 + 手动（-C/-A/-B） | 手动（-C） | 不支持 | 不支持 |
| **自动上下文丰富** | ≤3 匹配时自动附加 | 无 | 无 | 无 |
| **大小写控制** | 默认不敏感，可切换 | `ignoreCase` 参数 | 不支持 | 不支持 |
| **字面量搜索** | `fixed_strings` | `literal` | 不支持 | 不支持 |
| **排除匹配** | `exclude_pattern` 正则 | 无 | 无 | 无 |
| **仅文件名模式** | `names_only` 参数 | 无 | 无 | 默认行为 |
| **单文件上限** | `max_matches_per_file` | 无 | 无 | 无 |
| **排序** | 无显式排序 | 无排序 | 按修改时间降序 | 按修改时间降序 |
| **达到上限时** | break 流式迭代 | kill 进程 | 等待完成再截断 | ripgrep 自然截断 |
| **单行截断** | 2000 字符（grapheme） | 500 字符 | 2000 字符 | 不适用 |
| **超时** | 30 秒 | 无 | 无 | 30 秒 |
| **匹配上限** | 100（LLM 可调） | 100（LLM 可调） | 100（硬编码） | 100（LLM 可调，上限 2000） |
| **路径格式** | 相对路径 | 相对路径 | 绝对路径 | 绝对路径 |
| **ripgrep 来源** | 自动下载，不信任系统 rg | 优先系统，fallback 下载 | 优先系统，fallback 下载 | DotSlash 分发 |
| **文件名搜索** | npm `glob` 包 | fd | ripgrep `--files` | 无独立工具 |
| **模型适配 schema** | 按模型家族切换 | 无 | 无 | 无 |
| **安全策略** | 路径验证 + 不信任系统二进制 | Operations 接口 | 权限系统 | 命令解析 + 参数拦截 |

## 对 E01-S002 的设计参考

### 1. 降级策略

Gemini CLI 的三级降级是最可靠的跨平台方案。对教学项目来说，可以简化为两级：
- 优先：系统 `rg`（大部分开发者都有 ripgrep）
- 降级：Node.js `child_process` 调用 `grep` 或纯 JS 实现

但对于 MVP 来说，可以先只做 ripgrep 路径，后续再加降级。

### 2. 自动上下文丰富

这是本次调研最有价值的发现。当匹配数很少时自动附加上下文，可以减少 agent 的工具调用轮次。实现也不复杂——只需在格式化结果前判断匹配数，然后回读文件添加上下文行。

**对我们的启示**：值得在 S002 或后续迭代中实现。可以先不做，但设计上预留扩展空间（比如在输出格式中区分匹配行和上下文行）。

### 3. exclude_pattern 和 names_only

`exclude_pattern` 可以在应用层做二次过滤，避免返回噪音结果。`names_only` 提供了一个轻量搜索模式。

**对我们的启示**：S002 可以先不做，但知道这些参数的价值有助于后续迭代。

### 4. 输出格式的选择

Gemini CLI 使用相对路径而非绝对路径。结合我们项目的上下文：
- 绝对路径：方便 LLM 直接传给 read_file（OpenCode 风格）
- 相对路径：更紧凑，节省 token（Gemini CLI 风格）

**对我们的启示**：绝对路径更适合初期，避免路径解析错误。

### 5. grapheme 级别的截断

Gemini CLI 用 `Array.from(lineContent)` 做 grapheme 级截断，而非 `string.substring`。这对包含 emoji 或非 BMP 字符的代码更准确。

**对我们的启示**：可以作为细节优化，初期用 `substring` 足够。

### 6. 不排序 vs 按修改时间排序

有趣的是，Gemini CLI 的 grep 结果**不做排序**（按 ripgrep 自然输出顺序），而 glob 结果按混合策略排序。OpenCode/Codex 的 grep 都按修改时间排序。

**对我们的启示**：按修改时间排序仍然是更好的默认选择（OpenCode 风格），但不排序也不是大问题。

## 参考资料

- [Gemini CLI 仓库](https://github.com/google-gemini/gemini-cli)
- [ripgrep 项目](https://github.com/BurntSushi/ripgrep)
- [OpenCode Grep 调研](/researches/grep-search/opencode.md)
- [Codex Grep 调研](/researches/grep-search/codex.md)
- [Pi Grep 调研](/researches/grep-search/pi.md)
- [E01-S002 讨论大纲](/.discuss/2026-03-16/e01-s002-content-search/outline.md)
