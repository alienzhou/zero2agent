# Claude Code（sourcemap 还原树）System Prompt 结构调研

## 声明（公开仓库约束）

- 本文只记录从**还原源码**中可观察到的**类型、装配顺序、缓存策略、与工具名的衔接方式**。
- **不**在此转载 Anthropic 默认 system prompt 的长文本正文（避免在公开课程仓库中复制专有内容）。需要对照措辞时请读者自行打开 `constants/prompts.ts` 等文件。

## 基本信息

| 项目 | 值 |
|------|-----|
| 来源 | 内网仓 `claude-code-sourcemap`（README 说明：自 npm `@anthropic-ai/claude-code` 包内 `cli.js.map` 的 `sourcesContent` 无损还原；本调研以该还原树为准） |
| 调研 Commit | `b3006ae0b5ff0d59c18a54cabbf3a46eba46ea0b` |
| 还原包版本（README） | `2.1.88` |
| 调研日期 | `2026-04-28` |

## 调研结论

1. **System prompt 在类型层是 `string[]`，不是单字符串**。`SystemPrompt = readonly string[]` + 品牌类型 `asSystemPrompt()`（`src/utils/systemPromptType.ts`）。与 opencode 的「多段 system」一致，利于分层与（在支持时）分段 cache。

2. **有效 system 的优先级链在 `buildEffectiveSystemPrompt()` 里写死**（`src/utils/systemPrompt.ts`），顺序可概括为：
   - `overrideSystemPrompt` 若存在 → **整段替换**，只保留这一段（数组单元素）
   - 否则 Coordinator 模式 → coordinator 专用 prompt + 可选 `appendSystemPrompt`
   - 否则主线程 Agent：
     - **Proactive/Kairos 模式**：`defaultSystemPrompt` **后接** `# Custom Agent Instructions` + agent 段（**追加**而非替换默认身份）
     - 非 Proactive：**agent 段替换默认**；若无 agent 则用 `customSystemPrompt`；再无则用 `defaultSystemPrompt`
   - 末尾统一可再拼 `appendSystemPrompt`
   - 与 pi-mono「`customPrompt` 替换头、保留尾」相比，这里把 **override / agent / custom / default** 的分支写得更显式。

3. **默认大段内容由 `constants/prompts.ts` 驱动**，并组合 **可缓存的 section**（`systemPromptSection`）与 **故意破坏 cache 的 section**（`DANGEROUS_uncachedSystemPromptSection`）（`src/constants/systemPromptSections.ts`）。每个 section 有 `name`、`compute()`、以及是否 `cacheBreak`；`/clear` 与 `/compact` 会清 section 缓存（同文件注释）。

4. **工具名常从各工具的 `prompt.js` 再 export**（如 `FILE_READ_TOOL_NAME` 从 `../tools/FileReadTool/prompt.js` 引入），保证 **prompt 正文与 tool schema 使用同一字符串源**，与 gemini-cli 的 `tool-names.ts` 同源策略同构。

5. **子代理 / teammate** 路径里还有 `systemPromptMode: 'default' | 'replace' | 'append'`（`src/utils/swarm/inProcessRunner.ts` 附近），可显式把用户自定义与默认堆叠方式分离。

## 详细分析（文件级导航，无正文摘录）

| 关切点 | 入口文件 / 符号 |
|--------|------------------|
| 有效 system 如何拼 | `buildEffectiveSystemPrompt`（`src/utils/systemPrompt.ts`） |
| 品牌类型 | `SystemPrompt`, `asSystemPrompt`（`src/utils/systemPromptType.ts`） |
| Section 缓存 / 破坏 cache | `systemPromptSection`, `DANGEROUS_uncachedSystemPromptSection`, `resolveSystemPromptSections`（`src/constants/systemPromptSections.ts`） |
| 默认 prompt 装配、环境/工具名注入 | `src/constants/prompts.ts`（体量大；**不在此摘抄**） |
| Teammate system 模式 | `systemPromptMode`、`getSystemPrompt` 组合（`src/utils/swarm/inProcessRunner.ts`） |
| Prompt cache 与 tool 顺序 | `src/utils/toolSchemaCache.ts`（注释提到与 system 位置、schema 稳定性相关） |

## 与 zero2agent / 其它竞品的对照

| 维度 | Claude Code（本树） | gemini-cli | opencode | zero2agent 目标 |
|------|---------------------|------------|----------|------------------|
| System 形态 | **string[]（品牌类型）** | 单 string（再 sanitize） | string[] | 可在 Spec 中选 B：host 接受 `string \| string[]` |
| 动态段与 cache | section 显式标注 cacheBreak | 段函数 + `\n{3,}` 收敛 | 多段注入 | 可借鉴「易变段」单独标 DANGEROUS |
| 工具名同源 | 各 tool `prompt.js` export 名字 | `tool-names.ts` | 常量 | 应对齐 D02：避免 prompt 与 schema 手抄两份 |

## 与 ALI-13 的衔接

- 先前在仅沙箱环境不可达内网时，只能写「方法占位」。**2026-04-28 起**在可达网络下已能 `git clone` 上述仓并完成文件级导航；本文即基于该次拉取。
- 若后续 **Multica 云端** 再次不可达内网，读者仍可按该仓 README 的 **npm pack + 解析 cli.js.map** 流程在本地再生相同树。

## 状态

- ✅ 结构层调研可独立使用（不依赖内网：亦可用 npm 包 + sourcemap 自行还原）。
- ⛔ 不在 `zero2agent` 仓库提交任何完整默认 system prompt 文本或大体量原文 diff。
