# Gemini CLI `glob` 工具调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| 调研 Commit | `da8c841ef4c887eea844b02187dbb38ed1dc57b1` |
| 最近 Tag | N/A |
| Commit 日期 | `2026-03-29 02:47:05 +0000` |
| 调研日期 | `2026-03-29` |

## 调研目标

为 E01-S003 提供竞品参考：Gemini CLI 的 glob 工具参数、排序策略、ignore 体系、多根目录行为、安全校验、以及测试覆盖。

## 调研结论

1. **参数最丰富（5 个），四家中唯一支持 ignore 控制。** `pattern`、`dir_path?`、`case_sensitive?`（默认 false）、`respect_git_ignore?`（默认 true）、`respect_gemini_ignore?`（默认 true）。模型可以按需关闭某一类 ignore。

2. **底层使用 npm `glob` 包（不是 rg/fd）。** 调用 `glob(pattern, { cwd, withFileTypes: true, stat: true, nocase, dot: true, … })`。这是四家中唯一纯 Node 实现、不依赖外部二进制的。

3. **排序策略是四家中最精细的——双档分区排序：** 24 小时内修改的文件（recent）按 mtime 降序放前面；更老的文件按路径字典序放后面。不像 OpenCode 全部按 mtime 排。

4. **ignore 是两次过滤：** 第一次在 `glob()` 调用时传 `ignore: config.getFileExclusions().getGlobExcludes()`；第二次在结果上跑 `fileDiscovery.filterFilesWithReport()`，应用 `.gitignore` 和 `.geminiignore`，并报告 `ignoredCount`。

5. **字面路径 escape 防护：** 如果 `path.join(searchDir, pattern)` 指向一个实际存在的文件，会先 `escape(pattern)`，防止字面路径名里的 `[]()` 等字符被当 glob 元字符解析。

6. **无硬编码条数上限：** 不像 OpenCode（100）或 Pi（1000），结果条数由实际匹配和过滤决定。

## 详细分析

### A. `sortFileEntries` 排序算法

```typescript
export function sortFileEntries(entries, nowTimestamp, recencyThresholdMs) {
  sortedEntries.sort((a, b) => {
    const aIsRecent = nowTimestamp - (a.mtimeMs ?? 0) < recencyThresholdMs;
    const bIsRecent = nowTimestamp - (b.mtimeMs ?? 0) < recencyThresholdMs;
    if (aIsRecent && bIsRecent) return mtimeB - mtimeA;  // 都 recent → 新的在前
    if (aIsRecent) return -1;                             // a recent → a 在前
    if (bIsRecent) return 1;                              // b recent → b 在前
    return a.fullpath().localeCompare(b.fullpath());      // 都老 → 字典序
  });
}
```

**recencyThresholdMs = 24 小时。** 这意味着：
- 今天改过的文件按 mtime 排（最新在前）
- 更早的文件按路径排（稳定、可预测）

测试覆盖了：混合排序、纯 recent、纯 older、空数组、mtimeMs 缺失、自定义阈值。

### B. Ignore 体系（三层）

1. **`config.getFileExclusions().getGlobExcludes()`**：传给 `glob()` 的 `ignore` 参数，排除匹配的路径不进入候选。

2. **`fileDiscovery.filterFilesWithReport()`**：对 glob 结果二次过滤，应用：
   - `.gitignore`（`respect_git_ignore` 参数控制，默认 true）
   - `.geminiignore`（`respect_gemini_ignore` 参数控制，默认 true）
   - 返回 `{ filteredPaths, ignoredCount }`

3. **全局 `COMMON_IGNORE_PATTERNS`**：`ignorePatterns.ts` 中定义 `node_modules`、`.git`、`bower_components`、`.svn`、`.hg`——供各工具通用。

**与 OpenCode 的对比：** OpenCode 的 ignore 全部在 rg 层（`--glob=!.git/*`），没有应用层二次过滤。Gemini CLI 分两层，灵活度更高但复杂度也更高。

### C. 多工作区根目录

```typescript
if (this.params.dir_path) {
  searchDirectories = [resolve(targetDir, dir_path)];  // 指定了就用指定的
} else {
  searchDirectories = workspaceContext.getDirectories(); // 没指定就搜所有根
}
```

对每个根目录分别跑 `glob()`，结果合并到 `allEntries`，再统一过滤和排序。输出中会注明 `across N workspace directories`。

### D. 字面路径 escape 逻辑

```typescript
const fullPath = path.join(searchDir, pattern);
if (fs.existsSync(fullPath)) {
  pattern = escape(pattern);
}
```

**场景：** 用户传入 `src/app/[test]/(dashboard)/components/code.tsx`——这既是合法 glob（`[]` 是字符类），也是一个实际文件路径。如果文件存在，用 `glob.escape()` 把 `[` `]` `(` `)` 转义，确保精确匹配。

测试用例：`src/app/[test]/(dashboard)/testing/components/code.tsx` 能正确找到。

### E. 参数校验与安全

**`validateToolParamValues()`：**
1. `validatePathAccess(searchDir, 'read')`——路径必须在 workspace 内
2. `fs.existsSync(targetDir)` + `fs.statSync().isDirectory()`——路径必须存在且为目录
3. `pattern` 非空、非空白

**`getPolicyUpdateOptions()`：** 返回 `{ argsPattern: buildPatternArgsPattern(pattern) }`，将 glob pattern 纳入权限策略学习。

### F. 错误处理

- `glob()` 抛异常 → catch → 返回 `ToolErrorType.GLOB_EXECUTION_ERROR`，包含原始错误消息。
- 路径越界 → `ToolErrorType.PATH_NOT_IN_WORKSPACE`。
- 输出区分 `llmContent`（给模型看的）和 `returnDisplay`（给 UI 看的）。

### G. 测试覆盖（最完善）

24 个测试用例，涵盖：

**功能类：** 简单 pattern、case sensitive/insensitive、子目录 pattern、`dir_path` 相对路径、`**/*.log` globstar、零匹配、特殊字符 `[]`、mtime 排序。

**安全类：** 路径越界（`/etc`、`../`、`/`）、workspace 子目录合法。

**校验类：** 空 pattern、空白 pattern、非字符串 dir_path、非布尔 case_sensitive、不存在的路径、非目录路径。

**ignore 类：** `.gitignore` 生效/关闭、`.geminiignore` 生效/关闭。

**排序类：** `sortFileEntries` 独立 6 个测试。

## 横向对比总表

| 维度 | OpenCode | Codex | Pi | Gemini CLI |
|------|----------|-------|-----|-----------|
| **工具名** | `glob` | 无（shell rg） | `find` | `glob` |
| **底层** | rg `--files` | rg（in shell） | fd | npm `glob` |
| **参数数** | 2 | N/A | 3 | 5 |
| **case_sensitive** | 无 | N/A | 无 | 有（默认 false）|
| **ignore 控制** | 无 | N/A | 无 | 有（git + gemini）|
| **limit** | 100（硬编码） | N/A | 1000（默认） | 无上限 |
| **排序** | mtime 降序 | N/A | 无 | 双档分区 |
| **输出路径** | 绝对 | N/A | 相对（POSIX） | 绝对 |
| **可插拔后端** | 否 | 否 | 是（FindOps） | 否 |
| **测试用例数** | 无独立测试 | 10+（file_search） | 2 | 24 |

## 关键源码引用

- `packages/core/src/tools/glob.ts#L42-L64`：`sortFileEntries` 双档排序
- `packages/core/src/tools/glob.ts#L70-L95`：`GlobToolParams`（5 个参数）
- `packages/core/src/tools/glob.ts#L132-L260`：`GlobToolInvocation.execute()`（glob 调用、多目录、escape、fileDiscovery 过滤、排序、输出）
- `packages/core/src/tools/glob.ts#L300-L340`：参数校验（路径、pattern、目录存在性）
- `packages/core/src/tools/glob.test.ts#L1-L515`：24 个测试用例
- `packages/core/src/utils/ignorePatterns.ts#L15-L50`：`COMMON_IGNORE_PATTERNS` + `BINARY_FILE_PATTERNS`
- `packages/core/src/tools/definitions/coreTools.ts`：glob 工具声明注册

## zero2agent 设计参考

基于本调研，Gemini CLI 对 zero2agent `find_files` 工具设计的影响：

| 维度 | Gemini CLI 做法 | zero2agent 取舍 |
|------|----------------|----------------|
| **输出路径** | 绝对路径 | 采用**相对路径**（Pi 路线，省 token） |
| **排序** | 双档分区（24h mtime + older 字典序） | 采用 mtime 降序（简单优先，双档排序增加复杂度但收益有限） |
| **参数** | 5 个（含 case_sensitive、ignore 控制） | 4 个（`pattern`、`path?`、`include?`、`exclude?`），ignore 控制留后续 |
| **limit** | 无上限 | 默认 100（token 可控） |
| **ignore** | 三层过滤 | 依赖 rg 默认 `.gitignore` 感知（简单够用） |
| **字面路径 escape** | `glob.escape()` 防止 `[]()` 误解析 | 底层走 rg `--glob`，glob 语义由 rg 处理，无需额外 escape |

**关键借鉴：** Gemini CLI 的双档排序策略设计精巧，如果后续发现纯 mtime 排序不够好，可以回来参考。其 24 个测试用例的覆盖范围也是测试设计的好模板。横向对比总表（上方）是选型决策的核心依据。

## 参考资料

- [OpenCode Glob 调研](./opencode.md)
- [Codex 调研](./codex.md)
- [Pi find 调研](./pi.md)
