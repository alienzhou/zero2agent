# OpenAI Codex CLI System Prompt 结构调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [openai/codex](https://github.com/openai/codex) |
| 调研 Commit | `f8c527e5298f2cd047a12624133b24de1bf3829d` |
| 最近 Tag | `f8c527e`（按 commit 短哈希；该 commit 未直接打 tag） |
| Commit 日期 | `2026-04-27 13:31:56 +0200` |
| 调研日期 | `2026-04-27` |

## 调研目标

为 E01-S004（固定 Prompt 结构）迭代提供竞品参考，重点关注：

1. **Prompt 存储形态** —— 字符串、模板文件、还是渲染函数？
2. **整体结构** —— 分了哪些段，段的顺序约定是什么？
3. **工具描述如何注入 Prompt** —— 内嵌还是单独走 tool schema？
4. **环境上下文如何拼装** —— cwd / 平台 / git / AGENTS.md 等动态信息？
5. **Prompt 在代码层的归属** —— core / TUI / 配置文件？

## 调研结论

1. **Prompt 是 `.md` 文件，每个模型一份**。Codex 不维护「一套通用 prompt」，而是给 `gpt-5-codex`、`gpt-5.1-codex`、`gpt-5.2-codex`、`gpt-5.1`、`gpt-5.2` 等每一个支持的模型分别写一份独立 prompt 文件，在编译期通过 Rust `include_str!` 宏内联进二进制。

2. **共享 + 差异并存的层级结构**：`protocol/src/prompts/base_instructions/default.md`（约 200 行）是默认 base，每个模型再有自己的 `core/gpt-5.x-*_prompt.md` 覆盖。另外 `templates/model_instructions/gpt-5.2-codex_instructions_template.md` 是带 `{{ personality }}` 占位符的模板，让用户可注入个性。

3. **Section 切得很细，全部用 `# / ##` Markdown 标题**。典型 section（以 `default.md` 为例）：
   - `Capabilities`（顶部，没标题，先讲身份+能力清单）
   - `# How you work` → `## Personality`
   - `# AGENTS.md spec`
   - `## Responsiveness` → `### Preamble messages`
   - `## Planning`
   - `## Editing constraints`
   - `## Plan tool`
   - `## Special user requests`
   - `## Presenting your work and final message` → `### Final answer structure and style guidelines`

4. **工具描述完全不在 system prompt 里**。Codex 只在 prompt 里点名提到工具名（如 `update_plan`、`apply_patch`、`rg`），但工具的参数、用法、约束全部走 OpenAI 的 tool schema 字段（`description`、`parameters`），由 `core/src/tools/spec.rs` 注册。Prompt 只负责行为引导（什么时候该用 plan、preamble 怎么写、apply_patch 在什么场景适用）。

5. **环境上下文走「permissions instructions」单独通道**。`cwd`、sandbox 模式（`read_only` / `workspace_write` / `danger_full_access`）、approval policy（`never` / `unless_trusted` / `on_failure` / `on_request`）每一种都有独立的 `.md` 模板（`core/src/context/prompts/permissions/`），通过 `codex_utils_template::Template` 引擎渲染并以 **developer message**（不是 system message）插入到对话里。这让 base prompt 保持稳定，运行时上下文走另一通道。

## 详细分析

### 一、文件清单与归属

```
codex-rs/
├── protocol/src/prompts/base_instructions/default.md   # 默认 base，196 行
├── core/
│   ├── gpt_5_codex_prompt.md          # 67 行，覆盖 base
│   ├── gpt_5_1_prompt.md              # 330 行
│   ├── gpt_5_2_prompt.md              # 297 行
│   ├── gpt-5.1-codex-max_prompt.md
│   ├── gpt-5.2-codex_prompt.md
│   ├── prompt_with_apply_patch_instructions.md
│   ├── review_prompt.md               # /review 子命令独有
│   ├── prompt_for_init_command.md     # /init 子命令独有
│   ├── templates/
│   │   ├── model_instructions/
│   │   │   └── gpt-5.2-codex_instructions_template.md  # 带 {{ personality }} 占位
│   │   ├── compact/prompt.md          # 上下文压缩用
│   │   ├── realtime/backend_prompt.md # 语音模式独立
│   │   ├── personalities/             # 个性预设
│   │   ├── agents/ collab/ goals/ memories/ review/ search_tool/
│   └── src/context/prompts/permissions/
│       ├── approval_policy/
│       │   ├── never.md  unless_trusted.md  on_failure.md
│       │   └── on_request.md  on_request_rule_request_permission.md
│       └── sandbox_mode/
│           ├── read_only.md  workspace_write.md  danger_full_access.md
```

每个 `.md` 都通过 `include_str!("...")` 编译进 Rust 二进制：

```rust
// codex-rs/protocol/src/models.rs:904
pub const BASE_INSTRUCTIONS_DEFAULT: &str =
    include_str!("prompts/base_instructions/default.md");

// codex-rs/core/src/context/permissions_instructions.rs:17-32
const APPROVAL_POLICY_NEVER: &str = include_str!("prompts/permissions/approval_policy/never.md");
const SANDBOX_MODE_READ_ONLY: &str = include_str!("prompts/permissions/sandbox_mode/read_only.md");
// ...
```

### 二、模型选择逻辑

Codex 维护 `model_info.rs`，给每个模型（按精确字符串匹配）配 `model_instructions`、对应的 base prompt。运行时根据 `config.profile` 或 `--model` 参数解析出 `ModelInfo`，再取出对应字符串。这是「模型粒度的 prompt」——同一个 agent 框架，不同模型的 prompt 可能完全不同。

最有意思的设计：`gpt_5_codex_prompt.md`（67 行）和 `gpt_5_1_prompt.md`（330 行）实际是**两份完全不同的 prompt**，不是 diff。开发者认为不同模型对同一段话的反应差异大到不能复用。

### 三、`default.md` 的 section 结构（200 行）

```markdown
You are a coding agent running in the Codex CLI...

Your capabilities:
- Receive user prompts...
- Communicate with the user...
- Emit function calls to run terminal commands...

# How you work

## Personality
（默认人设：concise, direct, friendly）

# AGENTS.md spec
- Repos often contain AGENTS.md files...
- Instructions in AGENTS.md files: scope/precedence/...
（精确定义 AGENTS.md 的作用域与覆盖规则）

## Responsiveness
### Preamble messages
（call tool 前要先发一句 preamble，给 8 条示例）

## Planning
（什么时候用 update_plan，什么时候不用，给 4 个高质量 plan 示例）

## Editing constraints
- Default to ASCII...
- Add succinct code comments...
- Try to use apply_patch...
- Dirty git worktree handling
- NEVER use destructive commands...

## Plan tool
（与 Planning 不重复——这里是工具调用细节）

## Special user requests
- Simple requests
- Code reviews（review 模式行为）

## Presenting your work and final message
### Final answer structure and style guidelines
（plain text, GFM, headers, bullets, monospace, file refs 6 条精确规则）
```

### 四、工具描述的去向

工具不在 prompt 里。`core/src/tools/spec.rs` 注册的工具示例：

```rust
fn create_grep_files_tool() -> ToolSpec {
    ToolSpec {
        name: "grep_files".into(),
        description: "Finds files whose contents match the pattern \
            and lists them by modification time."
            .into(),
        parameters: /* JSON schema */,
        ...
    }
}
```

prompt 只在 `# General` 段写一句：

> When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`.

也就是说 codex 的策略是 **"prompt 教模型什么时候用工具"，不是 "prompt 教模型工具是什么"**。工具的 schema 由 SDK 在 tool calling 协议里独立递交。

### 五、环境上下文的两通道设计

Codex 的「base prompt」是模型粒度静态的，但运行时上下文（cwd / sandbox / approval / network）每次会话都不一样。它的处理方式是：

1. **Base prompt** 进 `system` message（编译期固定）。
2. **Permissions instructions** 走 `developer` message（运行时拼装）。

```rust
// core/src/context/permissions_instructions.rs:57
pub struct PermissionsInstructions {
    text: String,
}
```

PermissionsInstructions 由 4 个变量驱动：approval_policy（5 个枚举）× sandbox_mode（3 个枚举）× exec_policy × request_permissions_tool_enabled。每种组合用 `Template::parse(...)` + 字段替换，得到一段 developer message 文本，附在对话开头。

更进一步，AGENTS.md 内容也是走 developer message 注入的（base prompt 里只是定义了规则）：

> The contents of the AGENTS.md file at the root of the repo and any directories from the CWD up to the root are included with the developer message and don't need to be re-read.

### 六、覆盖与扩展机制

用户可以通过 `model_instructions_file` 配置项指向自己的文件：

```toml
# ~/.codex/config.toml
model_instructions_file = "root.txt"

[profiles.foo]
model_instructions_file = "child.txt"
```

加载顺序：CLI flag > profile > base config > 编译期默认。这给了用户「整段替换 base prompt」的逃生口。

### 七、`Template` 引擎

`codex_utils_template::Template` 是 Codex 自研的极简模板引擎，仅支持 `{{ var }}` 占位（看 `gpt-5.2-codex_instructions_template.md`：`{{ personality }}`）。**没有条件、循环**。复杂分支靠选择不同的 .md 文件来表达，不靠模板逻辑。

## 对 zero2agent 的启示

1. **Prompt 文件化优于内联字符串**。Codex 把 prompt 抽成 `.md` 是个非常成熟的实践——文档/代码分离、diff 友好、便于书写时使用 markdown 工具链。zero2agent 当前的 `cli.ts:9-21` 内联字符串在再加 4-5 个工具后会非常难读。

2. **不要把工具说明写进 system prompt**。让工具 schema 自带 description；system prompt 只写「行为约束」（何时用、何时不用、配合关系）。当前 zero2agent 在 prompt 里逐个枚举 tool 的做法虽然简单，但工具增加后会指数级膨胀。

3. **静态 prompt 与动态上下文分两通道**。Codex 的 base prompt 是编译期常量，运行时上下文（cwd / sandbox / AGENTS.md）走另一通道（developer message）。zero2agent 当前没有这种区分，所有内容都堆在 SYSTEM_PROMPT 一根字符串里——重构时建议引入「base prompt + runtime context block」两段式结构。

4. **课程层面价值**：Codex 的「per-model prompt 文件」是教科书级例子，可在 spec 里作为「一种极端的 prompt 管理策略」展示，与我们要做的「单一 prompt + 分段渲染」对照，让读者看到取舍。

5. **不要现在做的**：模型粒度的 prompt 分发、Template 引擎、permissions/sandbox 的运行时切换——这些是 codex 因复杂场景才需要的；zero2agent 在 E01 仍然是只读 agent，没有这些维度。
