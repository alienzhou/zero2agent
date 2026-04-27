# Claude Code / Sourcemap 仓库 —— 调研说明（占位）

> 本文件**不是**对 Claude Code 产物的源码级对标，只记录：为什么在 S004 讨论里会提到它、在**有** `claude-code-sourcemap` 或类似资产时怎么自助检索。

## 背景

- 子任务 ALI-13 线程中，人类成员提到内网仓  
  `git@git.corp.kuaishou.com:base-platform/claude-code-sourcemap.git`（**Claude Code 带 sourcemap 的构建侧产物**或映射），用于在**压缩/打包后的代码**里反查 `system` / `tool` / `subagent` / `hook` 等逻辑。
- 在 **Multica agent 运行环境** 中 **无法** 访问 `git.corp.kuaishou.com`，因此本仓库的 Atlas **不能** 代 clone 或逐行引用该仓内容。
- 若你本机已拉取，可在**合规**前提下自行全文检索，或将**脱敏片段**贴到 issue 再 @ Atlas 做与 `aider` / `opencode` 同维度的对照表。

## 若持有 sourcemap 时建议的检索关键词

- `system`、`systemPrompt`、 `developer`、 `instructions`
- `tool`、 `registerTool`、 `mcp`、 `subagent`、 `task`
- `hook`、 `permission`、 `sandbox`、 `AGENTS`、 `CLAUDE.md`
- 结合浏览器 DevTools / `source-map` CLI 在 bundle 中跳回「可读」源位置（若 sourcemap 完整）。

## 与公开竞品的补位关系

- **Aider**（`aider.md`）：OSS、可完整对照 Python 的「多 `*Prompts` 类 + 两段式 system」。
- **Claude Code**：产品层与社区讨论常作为「终端 agent 体验标杆」；**有 sourcemap 时**才能像 codex 那样引用到**文件+行号**；否则仍只能以官方文档/公开 Release note 为二级来源。

## 状态

- 待有**可机读、可外发的**片段后，可升级为正式「Claude Code Prompt 结构」补篇；在此之前本文保持 **methodology-only**。
