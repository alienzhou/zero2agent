# Pi Mono `find` 工具（Glob 找文件）调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| 调研 Commit | `7d4faa080dd07676806db0f653ef3e08a0c0081f` |
| 最近 Tag | `v0.63.1` |
| Commit 日期 | `2026-03-28 22:25:06 +0100` |
| 调研日期 | `2026-03-29` |

## 调研目标

为 E01-S003 提供参考：与 zero2agent 技术栈最接近的 TypeScript Agent 如何实现「按 glob 列文件」、底层选型、接口可插拔性、截断策略、以及与 grep 的协作。

## 调研结论

1. **工具名为 `find`（不是 `glob`），底层用 `fd`（不是 rg）。** 这是四家中唯一使用 `fd` 作为底层二进制的。Schema 参数：`pattern`（必填 glob）、`path?`、`limit?`（默认 **1000**，是 OpenCode 的 10 倍）。

2. **可插拔 Operations 接口：** `FindOperations` 定义了 `exists()` + `glob()` 两个方法。若调用方注入自定义 `operations`，完全绕过 fd，走注入的 `glob()` 方法。这个设计是为 Remote/SSH 场景准备的。

3. **`.gitignore` 多级感知：** 先用 `globSync("**/.gitignore")` 收集整棵树内所有 `.gitignore` 文件路径，对每个追加 `--ignore-file`。同时硬编码排除 `node_modules` 和 `.git`。

4. **截断体系两层并行：** 条数 limit（默认 1000）+ 字节 `truncateHead`（默认 50KB）。命中任一层都会在输出末尾追加 notice。

5. **与 grep 的 `--glob` 参数是不同的能力：** grep 工具的 `glob` 参数是传给 `rg --glob`，用于**限定内容搜索的文件范围**（"在 `*.ts` 文件里搜 `pattern`"）。find 工具是**纯路径搜索**（"找所有 `*.ts` 文件"）。两者独立。

## 详细分析

### A. `fd` 调用的完整参数形状

```
fd --glob --color=never --hidden --max-results <limit> [--ignore-file <path>]... <pattern> <searchPath>
```

- `--glob`：告诉 fd 把 pattern 当 glob 而非正则。
- `--hidden`：搜索隐藏文件。
- `--max-results`：硬限制输出条数。
- 无 `--follow`（不跟踪符号链接）。

**`fd` 获取方式：** `ensureTool("fd", true)`，与 rg 类似的懒加载下载机制。

### B. 可插拔 `FindOperations` 接口

```typescript
export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]> | string[];
}
```

当 `customOps?.glob` 存在时，完全走自定义路径：
1. `ops.exists(searchPath)` 检查路径
2. `ops.glob(pattern, searchPath, { ignore, limit })` 执行搜索
3. 路径相对化 + POSIX 化 + 截断

当没有自定义 ops 时走 fd。

**设计意义：** 远程开发场景（SSH、Docker 内）不需要在远端装 fd，只需实现两个方法。

### C. 截断框架深入（`truncate.ts`）

这套截断基础设施被 find、grep、read、bash 共享：

- **两个独立限度：** `maxLines`（默认 2000）和 `maxBytes`（默认 50KB），先到先停。
- **不返回半行：** 截断时按完整行计算字节，如果第一行就超字节限，返回空 + `firstLineExceedsLimit: true`。
- **方向区分：** `truncateHead`（保留前 N 行，适合 find/read）和 `truncateTail`（保留后 N 行，适合 bash 输出）。
- **详细元数据：** 返回 `TruncationResult` 包含 `totalLines`、`totalBytes`、`outputLines`、`outputBytes`、`truncatedBy`（"lines" 或 "bytes"）。

find 工具使用 `truncateHead`，并把 `maxLines` 设为 `Number.MAX_SAFE_INTEGER`（不限行数），只关心字节上限。

### D. 输出格式

- **相对于搜索根的 POSIX 路径**（`/` 分隔），不是绝对路径（与 OpenCode 不同）。
- `toPosixPath()` 把 Windows `\` 转 `/`。
- 保留尾 `/` 标记（如果原始 fd 输出有的话）。

### E. 测试覆盖

`test/tools.test.ts` 中有两个测试：
1. **隐藏文件可见：** `.secret/hidden.txt` 能被 `**/*.txt` 找到。
2. **`.gitignore` 尊重：** 被 ignore 的文件不出现在结果中。

测试不多，但覆盖了两个核心 edge case。

### F. 与 grep 工具的协作关系

| 维度 | `find` | `grep` |
|------|--------|--------|
| 场景 | 按文件名/路径模式找文件 | 按文件内容搜关键词 |
| 底层 | fd | rg |
| pattern 语义 | glob（文件路径） | regex（文件内容） |
| `glob` 参数 | 就是主 pattern | 是 rg `--glob`，限定搜索范围 |
| 结果 | 路径列表 | 匹配行（带行号、上下文） |
| 常见链式用法 | 先 find → 再 read 具体文件 | 先 grep → 再 read 定位上下文 |

## 关键源码引用

- `packages/coding-agent/src/core/tools/find.ts#L20-L26`：Schema 定义（pattern、path、limit）
- `packages/coding-agent/src/core/tools/find.ts#L40-L51`：`FindOperations` 接口 + 默认实现
- `packages/coding-agent/src/core/tools/find.ts#L130-L155`：自定义 glob ops 分支（完全绕过 fd）
- `packages/coding-agent/src/core/tools/find.ts#L194-L227`：fd 参数组装 + `.gitignore` 收集
- `packages/coding-agent/src/core/tools/find.ts#L250-L285`：结果 relativize + 截断 + notice
- `packages/coding-agent/src/core/tools/truncate.ts#L1-L265`：共享截断框架（truncateHead/truncateTail/truncateLine）
- `packages/coding-agent/src/core/tools/grep.ts#L26`：grep 工具的 `glob` 参数（对照——给 rg `--glob` 的范围过滤）
- `packages/coding-agent/test/tools.test.ts#L484-L518`：find 工具测试（隐藏文件、gitignore）

## zero2agent 设计参考

基于本调研，Pi 对 zero2agent `find_files` 工具设计的影响：

| 维度 | Pi 做法 | zero2agent 取舍 |
|------|--------|----------------|
| **输出路径** | 相对 POSIX 路径 | 采用**相对路径**（与 Pi 一致，省 token） |
| **排序** | 无（fd 默认遍历序） | 采用 mtime 降序（跟 OpenCode，简单有效） |
| **limit** | 默认 1000 | 默认 100（对齐 OpenCode，token 友好） |
| **截断** | 条数 + 字节双限 | 先做简单条数截断，字节限后续可加 |
| **底层** | fd | 采用 rg `--files`（零增量依赖） |
| **可插拔** | `FindOperations` 接口 | 当前不需要（无远程场景），可后续扩展 |

**关键借鉴：** Pi 是四家中唯一输出相对 POSIX 路径的，也是我们选择相对路径的重要参考。其截断框架（条数 + 字节双限、`truncateHead`/`truncateTail` 区分）在项目成熟后值得借鉴。

## 参考资料

- [OpenCode Glob 调研](./opencode.md)
- [Codex 调研](./codex.md)
- [Gemini CLI Glob 调研](./gemini-cli.md)
