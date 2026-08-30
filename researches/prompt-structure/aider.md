# Aider System Prompt 结构调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [paul-gauthier/aider](https://github.com/paul-gauthier/aider) |
| 调研 Commit | `3ec8ec5a7d695b08a6c24fe6c0c235c8f87df9af` |
| 最近 Tag | N/A（按 commit 短哈希） |
| Commit 日期 | `2026-04-25 09:43:47 -0700` |
| 调研日期 | `2026-04-27` |

## 调研目标

为 E01-S004（固定 Prompt 结构）补充 **非 TypeScript** 竞品样本。Aider 是 Python 实现的成熟 coding agent，与此前四家（codex / gemini-cli / opencode / pi-mono）形成「语言与工程结构」对照。

## 调研结论

1. **Prompt 按「编辑模式」拆成多个 Python 类，每个类一份 `main_system` + `system_reminder`**。例如 `EditBlockPrompts`、`WholeFilePrompts`、`UnifiedDiffPrompts`、`PatchPrompts`、`HelpPrompts`、`ArchitectPrompts` 等，全部继承 `CoderPrompts`（`aider/coders/base_prompts.py`）。**没有单一全局字符串**——换模式 = 换一套类。

2. **`main_system` 是带占位符的模板字符串**，在 `fmt_system_prompt()` 里用 `str.format()` 注入：`{final_reminders}`、`{fence}`、`{shell_cmd_prompt}`、`{platform}`、`{language}` 等（`aider/coders/base_coder.py` 约 `1174-1224` 行）。这比 TypeScript 竞品里「Options 对象 + render 函数」更原始，但逻辑集中、好 grep。

3. **`system_reminder` 与 `main_system` 拼接**：先 `main_sys = fmt(main_system)`，若 `example_messages` 要打进 system，则附加示例对话；最后 `main_sys += "\n" + fmt(system_reminder)`（`base_coder.py` 约 `1226-1262` 行）。**两段式**与 gemini-cli 的「preamble + operational」在概念上类似，但实现是字符串拼接。

4. **上下文不是全塞进一个 system string**，而是拆成 `ChatChunks`：`chunks.system`（主 system）、`chunks.examples`、`chunks.repo`、`chunks.readonly_files`、`chunks.chat_files`、`chunks.done` 等（`format_chat_chunks` 后续）。**多段用户/系统消息模拟「带文件的工作区」**，与 opencode 的 `string[]` system 不同路数，但同样避免「一大坨」。

5. **少数模型关闭真 system 角色**：`use_system_prompt=False` 时把本应给 system 的内容塞成 `user` + 假 `assistant("Ok.")`（`base_coder.py` 约 `1266-1274` 行）。这是 **API 兼容性** 细节，对「固定 prompt 结构」教学很有价值。

6. **`Model` 层可注入 `system_prompt_prefix`**（如某些模型要求的前缀字符串），在 `main_system` 之后再前置一行（`base_coder.py` 约 `1228-1230` 行）。与 codex 的 per-model 文件是不同粒度的小修补。

## 详细分析

### 一、类层次与文件

```
aider/coders/
├── base_prompts.py          # CoderPrompts：lazy/overeager、files_content_*、repo 只读提示等片段
├── editblock_prompts.py     # 默认 SEARCH/REPLACE 模式，main_system + system_reminder 最长
├── wholefile_prompts.py
├── udiff_prompts.py
├── patch_prompts.py
├── ask_prompts.py
├── architect_prompts.py
├── help_prompts.py
└── ...
```

`EditBlockPrompts.main_system`（节选）结构：

- 身份：`Act as an expert software developer.`
- 行为约束：`Respect existing conventions...`、`If ambiguous ask questions`
- 任务流程：编号步骤（是否需把文件加入 chat、逐步思考、SEARCH/REPLACE）
- 占位：`{final_reminders}`、`{shell_cmd_prompt}`

`system_reminder` 则专门放 **格式规则**（SEARCH/REPLACE block 细则），与「身份/任务」分离。

### 二、`fmt_system_prompt` 注入项

| 占位符 | 来源 |
|--------|------|
| `{final_reminders}` | `lazy_prompt` / `overeager_prompt` / `Reply in {lang}` / `get_platform_info()` 等拼成 |
| `{fence}` | 代码块 fence（单引号三反引号 vs 四反引号） |
| `{shell_cmd_prompt}` | 是否允许 shell 命令，分支 `suggest_shell_commands` |
| `{platform}` | 测试命令、操作系统等（`get_platform_info`） |
| `{language}` | 用户语言偏好 |

### 三、与四家 TS 竞品的差异（教学用对照表）

| 维度 | TS 四家（grep 轮） | Aider |
|------|---------------------|-------|
| 语言 | TS/JS | Python |
| Prompt 存储 | .md / .txt / TS 函数 / 单函数 | **多类 `main_system` 类属性** |
| 工具描述 | 多在 tool schema | Aider 以 **文本编辑协议**（SEARCH/REPLACE、diff）为主，规则在 `system_reminder` |
| System 条数 | 多数 1 条 system | 可能 `use_system_prompt=False` 伪装成 user |

## 对 zero2agent 的启示

1. **`main_system` + `system_reminder` 两段式命名**可以直接借到课程文案里：一段讲「你是谁、目标是什么」，一段讲「输出格式/工具协议硬约束」。

2. **按「模式」分文件/分模块** 与 Aider 的 `*Prompts` 类一一对应；我们若只有「只读 harness」一个模式，暂时不需要多类，但 spec 里可以写「未来加写文件模式 = 新一套 Prompts 类/模块」。

3. **不要把 repo / 只读文件上下文和身份挤在同一段**——Aider 用独立 message chunk 装 repo 摘要、只读文件说明；这与 D04 讨论里「易变与静态拆开」方向一致。

4. **Python 栈读者** 会更容易顺藤摸到 Aider 仓库，可作为课外扩展阅读链接。

## 调研范围衔接

调研规划中建议「四家之外值得补 **Aider + Claude Code**」。本文覆盖 **Aider（OSS）**；**Claude Code 本体 / sourcemap 还原树** 见同目录 `claude-code.md`（方法说明，非源码级引用）。
