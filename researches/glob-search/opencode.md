# OpenCode Glob / 按模式找文件 工具调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| 调研 Commit | `a5b1dc081d589598168c0e0d9346a35aeb58548b` |
| 最近 Tag | `v1.3.5` |
| Commit 日期 | `2026-03-29 03:43:00 +0000` |
| 调研日期 | `2026-03-29` |

## 调研目标

为 E01-S003（按 glob 在文件集合中定位）提供竞品参考，关注：

1. Agent 面向的工具名、参数与权限模型
2. 底层实现（是否复用 ripgrep、与内容搜索如何分工）
3. 结果形式、排序、截断与 Prompt 引导
4. 与 `list`/`grep` 等其他工具的关系和边界
5. 错误处理与安全防护

## 调研结论

1. **工具名固定为 `glob`**，与 `grep` / `list` / `read` 等并列注册在 `tool/registry.ts`。权限点 `permission: "glob"`，审批时带 `patterns`（glob 表达式）和 `always: ["*"]`（即「对任意 pattern 一律允许」）。

2. **底层统一走 ripgrep `--files` 模式，不用 npm `glob` 包。** Agent 工具路径始终调用 `Ripgrep.files({ cwd, glob: [pattern] })`，即 `rg --files --glob=<pattern>`。仓库里另有一套 `util/glob.ts` 使用 npm `glob`/`minimatch`，但那是给**内部文件系统层**（`AppFileSystem.glob`）用的，不是给 Agent 工具的。

3. **参数极简：仅 `pattern` + 可选 `path`。** 无 `case_sensitive`、无 `ignore` 控制、无 `limit` 参数。`path` 不填时默认 `Instance.directory`（项目根），支持绝对/相对解析。`path` 的 describe 里还**特别强调**了 `DO NOT enter "undefined" or "null" - simply omit it`——这是在防模型幻觉。

4. **硬编码 limit=100，应用层 mtime 降序排序。** `for await` 遍历 rg 输出，逐条 `Filesystem.stat(full)?.mtime`，收满 100 条就 break。排完序后输出**绝对路径**、截断文案。

5. **Prompt 描述（`glob.txt`）只有 6 行，但信息密度很高：** "按修改时间排序"、"支持 `**` 模式"、"大开销搜索用 Task 工具"、"鼓励多个工具并行调用"。把「何时该用别的工具」也写在描述里。

6. **安全防护两层：** `ctx.ask()` 权限审批 + `assertExternalDirectory()` 约束路径不能越出 Instance 目录。如果 `path` 不在 `Instance.containsPath(target)` 内，会触发 `external_directory` 权限再审批。

## 详细分析

### A. Ripgrep `files()` 完整调用链

**`src/file/ripgrep.ts` → `Ripgrep.files()`：**

```
rg --files --glob=!.git/* [--hidden] [--follow] [--max-depth=N] [--glob=<pattern>]
```

- `--glob=!.git/*` **硬编码排除 .git**，始终追加。
- `--hidden` **默认开启**（`input.hidden !== false`），能看到隐藏文件（`.env`、`.vscode` 等）。
- 输出以 `Process.spawn` 异步流式读取，按 `\r?\n` 分行，yield 每行路径。
- **ENOENT 防护**：先 `fs.stat(input.cwd)` 检查是否存在且为目录，否则抛自定义错误。

**与 `Ripgrep.search()` 的关系：** `search()` 走 `rg --json`，`files()` 走 `rg --files`——同一个 rg 二进制，两种模式。

**Ripgrep 获取方式：** `state()` 懒加载——先 `which("rg")`，找不到则从 GitHub Releases 下载 v14.1.1，支持 6 种平台（包括 Windows arm64）。tar.gz 或 zip 解压后放 `Global.Path.bin`。

### B. 与 `list` 和 `grep` 的分工

| 维度 | `glob` | `list` | `grep` |
|------|--------|--------|--------|
| **底层** | `rg --files --glob=` | `rg --files` + ignore patterns | `rg -nH --hidden` |
| **参数** | `pattern`, `path?` | `path?`, `ignore?[]` | `pattern`, `path?`, `include?` |
| **排序** | mtime 降序 | 字母序（目录树渲染） | mtime 降序 |
| **截断** | 100 条 | 100 条 | 100 match + 单行 2000 字符 |
| **输出格式** | 绝对路径列表 | 缩进目录树 | 按文件分组的匹配行 |
| **核心场景** | "找名叫 X 的文件" | "看这个目录下有什么" | "文件内容里哪里出现 X" |

三者**全部**基于 `Ripgrep` 模块（`rg` 二进制），分工在参数和后处理。

**`list` 的独特设计：** 硬编码了 34 个 `IGNORE_PATTERNS`（`node_modules/`, `dist/`, `.venv/` 等），以 `--glob=!xxx*` 方式排除。它**不返回平铺路径**，而是 `renderDir()` 构建缩进目录树。

### C. 权限与安全模型

- 配置里 `permission` 按工具名划分：`glob`、`grep`、`list`、`bash` 等各自独立，支持 `allow`/`deny`/`ask` 三种策略，可按 pattern 配精细规则。
- `assertExternalDirectory`：若目标路径不在 Instance.directory 内，构造 `parentDir/*` 作为审批 pattern，要求用户二次确认（`permission: "external_directory"`）。

### D. 错误处理

- `Ripgrep.files()` 内部：ENOENT（目录不存在）直接抛异常，rg 进程 stderr `ignore`（不报不可访问路径的噪音）。
- `GlobTool.execute`：`Filesystem.stat()` 返回 null（文件删除/链接断裂）时 mtime 默认 `0`，不会中断整个搜索。
- **没有做 pattern 校验。** 如果用户传入非法 glob（如 `**`），行为由 rg 决定，工具层不拦截。

### E. 测试覆盖

`test/filesystem/filesystem.test.ts` 中有 `describe("glob")` 块，但只测了底层 `AppFileSystem.glob()`（npm `glob` 包），不是 Agent 工具层。Agent 工具层的 GlobTool **没有看到独立单元测试**——Grep 调研中也是类似情况。

## 关键源码引用

- `packages/opencode/src/tool/glob.ts#L1-L78`：完整工具定义（参数、权限、rg 调用、limit=100、mtime 排序、输出拼接）
- `packages/opencode/src/file/ripgrep.ts#L130-L209`：rg 获取 & 懒下载（`state()`）
- `packages/opencode/src/file/ripgrep.ts#L216-L275`：`files()` 异步迭代器（`--files` + `--glob`）
- `packages/opencode/src/file/ripgrep.ts#L335-L375`：`search()` 内容搜索走 `--json`（对照）
- `packages/opencode/src/tool/glob.txt`：注入模型的 6 行工具说明
- `packages/opencode/src/tool/ls.ts#L1-L121`：`list` 工具，34 个硬编码 ignore、目录树渲染
- `packages/opencode/src/tool/grep.ts#L1-L156`：`grep` 工具，mtime 排序、单行 2000 字符截断
- `packages/opencode/src/tool/external-directory.ts#L1-L32`：路径越界检查
- `packages/opencode/src/config/config.ts#L529-L546`：`glob`/`grep`/`list` 等权限配置 schema

## zero2agent 设计参考

基于本调研，OpenCode 对 zero2agent `find_files` 工具设计的影响：

| 维度 | OpenCode 做法 | zero2agent 取舍 |
|------|-------------|----------------|
| **输出路径** | 绝对路径 | 采用**相对路径**（省 token，与 `read_file`/`grep_search` 对齐） |
| **排序** | mtime 降序 | 沿用 mtime 降序（与 `grep_search` 一致，简单有效） |
| **limit** | 硬编码 100 | 默认 100，参数可覆盖 |
| **底层** | `rg --files --glob` | 沿用（零增量依赖成本） |
| **path 默认值** | `Instance.directory`（项目根） | 使用统一工作目录 `cwd`（当前项目无此机制，需新增） |

**关键借鉴：** mtime 排序 + 硬编码 limit 的极简策略。OpenCode 的 `assertExternalDirectory` 路径约束也值得后续安全迭代参考。

## 参考资料

- [Codex 调研](./codex.md)
- [Pi find 调研](./pi.md)
- [Gemini CLI Glob 调研](./gemini-cli.md)
