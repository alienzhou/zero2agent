# OpenAI Codex CLI — 文件模式匹配 / 按名找文件 调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [openai/codex](https://github.com/openai/codex) |
| 调研 Commit | `7880414a2728514ea4aaa619cb5db0ffa807556d` |
| 最近 Tag | N/A |
| Commit 日期 | `2026-03-28 20:39:47 -0700` |
| 调研日期 | `2026-03-29` |

## 调研目标

为 E01-S003 提供竞品参考：Codex 是否提供与 OpenCode `glob` 同级的 **LLM Function Tool**，若无，模型如何完成「按模式列文件」。

## 调研结论

1. **不存在名为 `glob` 或 `find_files` 的 Function Tool。** 在 `codex-rs/core/src/tools/spec.rs` 中仅发现 `list_dir`、`js_repl`、`exec`（code mode）等结构化工具，未检索到 glob/find 类工具定义。

2. **按 glob 找路径的能力通过系统提示引导到 shell `rg --files`。** 多个模型的 `instructions_template` 中明确写：`When searching for text or files, prefer using rg or rg --files respectively`。这意味着**模型自己在 shell 里组装 rg 命令**来完成文件搜索。

3. **`list_dir` 是目录浏览工具，不是 glob 搜索：** 参数 `dir_path`（绝对路径）、`offset`（1-indexed 分页）、`limit`（默认 25）、`depth`（默认 2）。输出按字母序排列、含缩进和 kind 标记（`/` 目录、`@` 符号链接、`?` 其他）。适合「看一个特定目录的结构」，不适合「`**/*.ts` 全仓库扫描」。

4. **`codex_file_search` crate 是 TUI 层的模糊搜索，非 LLM 工具。** 基于 `nucleo`（模糊匹配库）+ `ignore` crate（WalkBuilder 遍历），用于用户在终端的交互式文件查找。它走的是**模糊评分排序**（`score desc, path asc`），与 glob 精确匹配完全不同。

5. **Codex 的策略：不做专用工具，依赖模型 + shell 能力。** 这降低了工具数量和维护成本，但要求模型：(a) 能正确拼 rg 命令；(b) 理解 `--files`/`--glob` 等参数；(c) 处理 rg 输出。Codex 的安全层会对 rg 的危险参数做拦截。

## 详细分析

### A. `list_dir` 工具深入

**参数与默认值（Rust）：**
- `dir_path`: String，必须为绝对路径
- `offset`: usize，默认 1（1-indexed）
- `limit`: usize，默认 25
- `depth`: usize，默认 2

**遍历逻辑：** BFS（`VecDeque` 队列），按 `depth` 控制层级。收集完后**按路径排序**（`sort_unstable_by`），再做分页截取 `[offset-1..offset-1+limit]`。

**输出格式：** 每个条目带缩进（`depth * 2` 个空格），附加 kind 标记：`/`=目录、`@`=符号链接、`?`=其他。超长条目名截断到 500 字节。

**与 OpenCode `list` 的对比：**
| 维度 | Codex `list_dir` | OpenCode `list` |
|------|-----------------|-----------------|
| 实现语言 | Rust (tokio fs) | TS (rg --files) |
| 默认 limit | 25 | 100 |
| 分页 | offset/limit 支持 | 无分页，硬截断 |
| ignore | 无内置 ignore | 34 个硬编码 ignore |
| 深度 | depth 参数可控 | 不限深度（rg 递归） |

### B. `codex_file_search` crate 架构（TUI 层能力）

这是本次调研最意外的发现。Codex 有一个**完整、高性能的文件搜索引擎**，但它**不是 LLM 工具**，而是给用户在 TUI 里做模糊查找的。

**核心组件：**
- `walker_worker`：基于 `ignore::WalkBuilder` 遍历多根目录，支持 `.gitignore` 感知（`require_git(true)`）、隐藏文件、符号链接。并行遍历线程数可配。
- `matcher_worker`：基于 `nucleo`（高性能模糊匹配引擎，Helix 编辑器同款），支持增量查询（`append` 优化）、Smart Case。
- `SessionReporter`：trait 接口，TUI 通过 `on_update` 接收实时排名更新。

**排序策略：** `score desc, path asc`——先按 nucleo 评分降序，同分按路径字典序。

**重要设计决策（`.gitignore` 处理）：**
```rust
walk_builder.require_git(true);
```
代码注释说明：不设此标志时，`ignore` crate 会读取**所有祖先目录**的 `.gitignore`——这与 git 本身的行为不一致（git 只读 repo root 及以下的 `.gitignore`）。如果 `~/.gitignore` 里有 `*`（某些用户的全局配置），会导致所有文件被隐藏。这个 bug fix 有对应的回归测试。

**测试覆盖：** 10+ 个测试用例，覆盖：增量查询、walker/matcher 交互、cancel flag、drop session 不影响 sibling、多目录搜索、`.gitignore` 边界（parent gitignore outside repo、repo-local gitignore with negate patterns）。

### C. 模型提示中的 `rg` 引导

多个模型配置中的关键语句：

> When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`. (If the `rg` command is not found, then use alternatives.)

此外：
> Parallelize tool calls whenever possible - especially file reads, such as `cat`, `rg`, `sed`, `ls`, `git show`, `nl`, `wc`.

这意味着 Codex 期望模型**直接在 shell 里用 rg**，与 OpenCode/Gemini 把 glob 封装成独立工具的路线完全不同。

### D. 对 zero2agent 的设计启示

| 方面 | Codex 路线（shell + rg） | OpenCode/Gemini 路线（封装工具） |
|------|-------------------------|-------------------------------|
| 工具数量 | 少（不单独占工具位） | 多一个工具定义 |
| 模型门槛 | 高（要会拼 rg 参数） | 低（只需填 pattern + path） |
| 错误处理 | 分散在 shell 输出解析 | 集中在工具层 |
| 结果标准化 | 无（raw rg output） | 有（统一格式、排序、截断） |
| 安全防护 | shell 命令拦截层 | 工具权限 + 路径校验 |

## 关键源码引用

- `codex-rs/core/src/tools/spec.rs#L702-L747`：`list_dir` 的 JSON Schema 定义
- `codex-rs/core/src/tools/handlers/list_dir.rs#L1-L271`：完整 list_dir 实现（BFS、分页、kind 标记、500 字节截断）
- `codex-rs/file-search/src/lib.rs#L1-L1181`：`codex_file_search` 完整实现（walker、nucleo matcher、session 管理、`.gitignore` 边界处理、10+ 测试用例）
- `codex-rs/core/models.json`：多模型 instructions_template 中 `rg --files` 引导

## zero2agent 设计参考

基于本调研，Codex 对 zero2agent `find_files` 工具设计的影响：

| 维度 | Codex 做法 | zero2agent 取舍 |
|------|-----------|----------------|
| **工具形态** | 无专用工具，模型 shell rg | 提供封装工具（降低模型门槛、统一输出） |
| **输出路径** | shell `rg --files` 默认相对 | 采用**相对路径**（与 Codex 的 rg 输出自然对齐） |
| **排序** | 无（rg 默认遍历序） | 采用 mtime 降序（OpenCode 路线） |
| **list_dir 分页** | offset/limit 支持 | 当前 `list_directory` 无分页，后续可参考 |
| **`.gitignore`** | `ignore` crate / `require_git(true)` | 依赖 rg 默认的 `.gitignore` 感知 |

**关键借鉴：** Codex 不做 glob 工具的策略虽然精简，但对模型能力要求高，不适合教学项目。`list_dir` 的 offset/limit 分页是后续优化 `list_directory` 的参考方向。

## 参考资料

- [OpenCode Glob 调研](./opencode.md)
- [Pi find 调研](./pi.md)
- [Gemini CLI Glob 调研](./gemini-cli.md)
