# OpenAI Codex CLI Grep/Search 工具调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [openai/codex](https://github.com/openai/codex) |
| 调研 Commit | `029aab5563caed2f2bbea8a1815a42cbf22b79a2` |
| 最近 Tag | N/A |
| Commit 日期 | `2026-03-15 23:15:52 -0700` |
| 调研日期 | `2026-03-16` |

## 调研目标

为 E01-S002（内容搜索）迭代提供竞品参考，重点关注：

1. **功能的应用场景** — Codex CLI 中内容搜索工具的定位和使用方式
2. **核心能力** — 工具参数设计、底层技术选型、结果格式
3. **实现的特殊技巧** — 与 OpenCode 的差异、独特的设计决策

## 调研结论

1. **Codex 有两条搜索路径：shell `rg` 和 `grep_files` 工具**。Codex 主要依赖 agent 在 shell 中直接调用 `rg`（ripgrep），同时提供了 `grep_files` 作为实验性的结构化工具。两条路径并存，`grep_files` 目前需要通过 `experimental_supported_tools` 启用。

2. **`grep_files` 只返回文件路径，不返回匹配行内容**。这是和 OpenCode 最大的差异 — Codex 的 `grep_files` 使用 `rg --files-with-matches`，只列出包含匹配的文件名，不展示具体匹配行。定位是"先找到文件，再用 `read_file` 看内容"。

3. **结果由 ripgrep 自身排序，使用 `--sortr=modified`**。不需要应用层 `stat()` 调用，直接利用 ripgrep 内置排序参数。

4. **Shell 命令安全检查是 Codex 的独特能力**。Codex 有完整的命令解析层，能识别 `rg`、`grep`、`ag`、`ack` 等搜索命令，并对 ripgrep 的危险参数（`--pre`、`--search-zip`）做安全拦截。

5. **ripgrep 通过 DotSlash 分发，版本 15.1.0**。npm 包中内置 DotSlash manifest，按平台自动下载 ripgrep 二进制。

## 详细分析

### 一、Codex 的搜索体系

Codex 的搜索能力分布在多个层次：

| 能力 | 实现方式 | 定位 |
|------|----------|------|
| 内容搜索（Agent 工具） | `grep_files` 工具，调用 `rg --files-with-matches` | 实验性，返回文件列表 |
| 内容搜索（Shell） | Agent 在 shell 中调用 `rg` | 主要方式，Prompt 引导 |
| TUI 文件搜索 | `codex_file_search` + `nucleo-matcher` | 用户交互，模糊匹配 |
| 工具元数据搜索 | `tool_search`，BM25 检索 | MCP/Apps 工具发现 |
| Web 搜索 | `WebSearchToolConfig` | 外部信息检索 |

**关键发现**：Codex 的 System Prompt 明确引导 agent 优先在 shell 中使用 `rg`：

```text
When searching for text or files, prefer using `rg` or `rg --files` respectively
because `rg` is much faster than alternatives like `grep`.
```

也就是说，Codex 的主要搜索策略是**让 agent 自己组合 shell 命令**，而非依赖结构化工具。`grep_files` 更像是一个补充手段。

### 二、`grep_files` 工具定义

#### 参数设计

```rust
// codex-rs/core/src/tools/spec.rs#L1607-L1658
fn create_grep_files_tool() -> ToolSpec {
    // 四个参数
    // pattern: 必填，正则表达式
    // include: 可选，glob 过滤
    // path: 可选，搜索目录/文件
    // limit: 可选，最大返回文件数，默认 100
}
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `pattern` | string | 是 | — | 正则表达式 |
| `include` | string | 否 | — | glob 过滤（如 `*.rs`、`*.{ts,tsx}`） |
| `path` | string | 否 | session cwd | 搜索目录或文件 |
| `limit` | number | 否 | 100 | 最大返回文件数，上限 2000 |

工具描述：
```
"Finds files whose contents match the pattern and lists them by modification time."
```

**与 OpenCode 对比**：Codex 多了 `limit` 参数，让 LLM 可以控制返回数量。OpenCode 的 limit 是硬编码的 100。

#### 注册方式

```rust
// codex-rs/core/src/tools/spec.rs#L2784-L2796
if config
    .experimental_supported_tools
    .contains(&"grep_files".to_string())
{
    let grep_files_handler = Arc::new(GrepFilesHandler);
    push_tool_spec(&mut builder, create_grep_files_tool(), true, config.code_mode_enabled);
    builder.register_handler("grep_files", grep_files_handler);
}
```

`grep_files` 需要在配置中显式启用，说明它仍处于实验阶段。

### 三、`grep_files` 实现细节

#### 核心逻辑

```rust
// codex-rs/core/src/tools/handlers/grep_files.rs#L110-L153
async fn run_rg_search(
    pattern: &str,
    include: Option<&str>,
    search_path: &Path,
    limit: usize,
    cwd: &Path,
) -> Result<Vec<String>, FunctionCallError> {
    let mut command = Command::new("rg");
    command
        .current_dir(cwd)
        .arg("--files-with-matches")
        .arg("--sortr=modified")
        .arg("--regexp")
        .arg(pattern)
        .arg("--no-messages");
    // ...
}
```

ripgrep 参数：

| 参数 | 作用 |
|------|------|
| `--files-with-matches` | 只输出包含匹配的文件路径（不输出匹配行内容） |
| `--sortr=modified` | 按修改时间倒序排列 |
| `--regexp` | 指定正则模式 |
| `--no-messages` | 抑制错误信息 |
| `--glob` | 文件过滤（可选） |

**关键差异**：使用 `--files-with-matches` 意味着输出只有文件路径列表，没有行号和行内容。这是一个**极简设计**，把"定位文件"和"查看内容"拆成两步。

#### 超时机制

```rust
// codex-rs/core/src/tools/handlers/grep_files.rs#L21,L132-L136
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

let output = timeout(COMMAND_TIMEOUT, command.output())
    .await
    .map_err(|_| {
        FunctionCallError::RespondToModel("rg timed out after 30 seconds".to_string())
    })?
```

30 秒超时，防止大仓库搜索卡死。OpenCode 没有显式的超时控制。

#### 结果解析

```rust
// codex-rs/core/src/tools/handlers/grep_files.rs#L155-L172
fn parse_results(stdout: &[u8], limit: usize) -> Vec<String> {
    let mut results = Vec::new();
    for line in stdout.split(|byte| *byte == b'\n') {
        if line.is_empty() { continue; }
        if let Ok(text) = std::str::from_utf8(line) {
            results.push(text.to_string());
            if results.len() == limit { break; }
        }
    }
    results
}
```

按行分割，每行一个文件路径，达到 limit 即停。极简实现。

#### 输出格式

成功时：
```
/absolute/path/to/file1.rs
/absolute/path/to/file2.rs
```

无匹配时：
```
No matches found.
```

没有额外的元信息（如匹配总数、是否截断）。极简到几乎只有"裸数据"。

### 四、Shell 中的 `rg` — Codex 的主要搜索方式

Codex 的 Prompt 引导 agent 优先在 shell 中使用 `rg`。为此，Codex 在命令安全层做了精细化处理：

#### 命令解析

```rust
// codex-rs/shell-command/src/parse_command.rs
// 识别各种搜索命令
Some((head, tail)) if head == "rg" || head == "rga" || head == "ripgrep-all" => { ... }
Some((head, tail)) if matches!(head.as_str(), "grep" | "egrep" | "fgrep") => { ... }
Some((head, tail)) if matches!(head.as_str(), "ag" | "ack" | "pt") => { ... }
```

能识别 `rg`、`grep`、`egrep`、`fgrep`、`ag`、`ack`、`pt`、`git grep` 等搜索命令，分类为 `ParsedCommand::Search`。

#### 安全检查

```rust
// codex-rs/shell-command/src/command_safety/is_safe_command.rs
"grep" => 视为安全，自动放行

"rg" => 需排除危险选项：
  - "--pre"           // 可执行任意命令
  - "--hostname-bin"  // 可执行任意命令
  - "--search-zip"    // 调用外部解压工具
  - "-z"              // --search-zip 的短形式
```

`grep` 无条件安全。`rg` 大部分调用安全，但需要排除几个能执行任意命令的参数。

这个安全检查层让 agent 可以自由使用 `rg` 而不需要每次请求用户授权。

### 五、ripgrep 分发策略

Codex 使用 [DotSlash](https://dotslash-cli.com/) 来分发 ripgrep：

```json
// codex-cli/bin/rg（DotSlash manifest）
{
  "name": "rg",
  "platforms": {
    "macos-aarch64": {
      "path": "ripgrep-15.1.0-aarch64-apple-darwin/rg",
      "providers": [{
        "url": "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/..."
      }]
    }
    // ... 6 个平台
  }
}
```

- ripgrep 版本：**15.1.0**（OpenCode 用 14.1.1）
- 覆盖 macOS/Linux/Windows × amd64/arm64
- DotSlash 是 Meta 开发的懒加载二进制分发工具，首次调用时自动下载

### 六、TUI 文件模糊搜索（参考）

Codex 的 TUI 中有用 `@` 触发的文件名模糊搜索，用到了独立的 `codex_file_search` crate：

```rust
// codex-rs/file-search/src/lib.rs
// 使用 ignore crate（ripgrep 同源）遍历目录
// 使用 nucleo-matcher 做模糊匹配
// 支持增量搜索（FileSearchSession）
```

这不是给 agent 用的工具，而是 TUI 交互功能，但设计上很精致。

## 关键源码引用

| 文件 | 说明 |
|------|------|
| `codex-rs/core/src/tools/handlers/grep_files.rs` | `grep_files` 工具完整实现 |
| `codex-rs/core/src/tools/handlers/grep_files_tests.rs` | 单元测试 |
| `codex-rs/core/tests/suite/grep_files.rs` | 集成测试 |
| `codex-rs/core/src/tools/spec.rs#L1607-L1658` | 工具 Schema 定义 |
| `codex-rs/core/src/tools/spec.rs#L2784-L2796` | 工具注册逻辑 |
| `codex-rs/protocol/src/prompts/base_instructions/default.md` | System Prompt 中的搜索引导 |
| `codex-rs/shell-command/src/parse_command.rs` | Shell 命令解析（识别搜索命令） |
| `codex-rs/shell-command/src/command_safety/is_safe_command.rs` | 命令安全检查（rg 白名单） |
| `codex-cli/bin/rg` | DotSlash ripgrep manifest（v15.1.0） |
| `codex-rs/file-search/src/lib.rs` | TUI 文件模糊搜索库 |

## 与 OpenCode 的对比

| 维度 | OpenCode | Codex |
|------|----------|-------|
| **搜索工具名** | `grep`（GrepTool） | `grep_files` |
| **返回内容** | 文件路径 + 行号 + 行内容 | 仅文件路径列表 |
| **排序方式** | 应用层 `stat()` + sort | ripgrep `--sortr=modified` |
| **结果上限** | 硬编码 100 条 | 默认 100，LLM 可调（上限 2000） |
| **单行截断** | 2000 字符 | 无（不返回行内容） |
| **通用截断** | 2000 行 / 50KB | 无 |
| **超时** | 无显式超时 | 30 秒 |
| **工具状态** | 正式工具，无条件注册 | 实验性，需 feature flag |
| **主要搜索方式** | 结构化工具为主 | Shell `rg` 为主，工具为辅 |
| **语言** | TypeScript | Rust |
| **ripgrep 版本** | 14.1.1 | 15.1.0 |
| **ripgrep 分发** | 运行时自动下载 | DotSlash / npm 包内置 |
| **安全检查** | 权限系统 + 外部目录检查 | 命令解析 + 危险参数拦截 |

## 对 E01-S002 的设计参考

### 1. 返回粒度的选择

Codex 选择只返回文件路径，让 agent 再用 `read_file` 查看具体内容。OpenCode 直接返回匹配行。

**对我们的启示**：对于教学项目，返回匹配行内容（OpenCode 风格）更直观，减少 agent 的工具调用轮次，也更便于学习者理解搜索结果。如果后续需要精细控制 token 用量，可以考虑像 Codex 一样只返回文件列表。

### 2. limit 参数暴露给 LLM

Codex 允许 LLM 控制返回数量（默认 100，上限 2000），OpenCode 硬编码 100。

**对我们的启示**：可以先硬编码上限（简单），后续再考虑暴露 `limit` 参数。

### 3. 超时机制

Codex 设置了 30 秒超时，这在大仓库中很有价值。

**对我们的启示**：值得借鉴。Node.js 中可以用 `AbortController` + `setTimeout` 实现类似效果。

### 4. `--sortr=modified` vs 应用层排序

Codex 利用 ripgrep 内置的排序参数，避免了应用层的 `stat()` 调用。但 `--sortr` 是 ripgrep 较新版本的特性。

**对我们的启示**：如果我们依赖系统 `rg`，不确定版本，应用层排序更安全。如果自带 ripgrep，可以用 `--sortr`。

### 5. Shell vs 结构化工具

Codex 的经验表明，成熟的 coding agent 更倾向让 agent 直接用 shell 命令，因为灵活性更高。但对于学习项目，结构化工具更可控、更易理解。

**对我们的启示**：S002 先做结构化工具，后续迭代再考虑 shell 执行能力。

## 参考资料

- [Codex CLI 仓库](https://github.com/openai/codex)
- [ripgrep 项目](https://github.com/BurntSushi/ripgrep)
- [DotSlash 项目](https://dotslash-cli.com/)
- [OpenCode Grep 调研](/researches/opencode-grep-search/README.md)
- [E01-S002 讨论大纲](/.discuss/2026-03-16/e01-s002-content-search/outline.md)
