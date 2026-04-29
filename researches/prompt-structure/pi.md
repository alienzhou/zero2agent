# Pi Mono System Prompt 结构调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| 调研 Commit | `2a7e82d3ef5ff887a0de1334bad26faf9ce73def` |
| 最近 Tag | `2a7e82d`（commit 短哈希） |
| Commit 日期 | `2026-04-27 08:53:06 +0000` |
| 调研日期 | `2026-04-27` |

## 调研目标

为 E01-S004（固定 Prompt 结构）迭代提供参考。Pi 是与 zero2agent 技术栈最接近的 TypeScript Agent（同样是 monorepo + Node.js + 单一字符串 prompt 起步），重点关注：

1. **结构粒度** —— 一个函数搞定还是分多段？
2. **工具列表如何注入**？
3. **运行时上下文（cwd / 日期）如何拼接**？
4. **项目上下文（AGENTS.md / 项目说明）如何附加**？
5. **是否提供 customPrompt 整段替换的逃生口**？

## 调研结论

1. **Prompt 由单一函数 `buildSystemPrompt(options)` 拼装**，整个文件 172 行（[`packages/coding-agent/src/core/system-prompt.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/system-prompt.ts)）。这是四家中最简洁的实现，最接近 zero2agent 当前的状态。

2. **整体结构是「base 字符串 + 5 段可选追加」线性顺序**：
   ```
   [Role + Available tools 列表 + Guidelines + Pi docs 引导]
   + [可选 appendSystemPrompt]
   + [可选 # Project Context 段，逐文件拼接]
   + [可选 Skills 段]
   + [Current date + Current working directory]（始终放最后）
   ```

3. **工具以「`- 工具名: 一行描述`」bullet 列表形式注入 prompt**。调用方传 `selectedTools: string[]` + `toolSnippets: Record<string, string>`，函数过滤出 `toolSnippets[name]` 存在的工具，列成清单。**没有该工具的 snippet 就不进入清单**——意思是工具是否「曝光」给模型完全由调用方决定，与工具是否真正可用解耦。

4. **Guidelines 段动态生成且去重**。根据「装了哪些工具的组合」自动产出引导语：例如 `hasBash && !hasGrep && !hasFind && !hasLs` 就追加 `"Use bash for file operations like ls, rg, find"`，否则追加 `"Prefer grep/find/ls tools over bash for file exploration..."`。还总有 `"Be concise in your responses"` / `"Show file paths clearly when working with files"` 兜底。**调用方可以传 `promptGuidelines: string[]` 注入更多条目**。

5. **`customPrompt` 整段替换的逃生口完整**：传入 `customPrompt` 时跳过 base prompt 全部，但仍然附加 appendSection / contextFiles / skills / date / cwd 这些下游段。这种「替换头部，但通用尾部依然拼上」的混合策略，比 gemini-cli 的「整段替换」更有生产意义。

## 详细分析

### 一、`BuildSystemPromptOptions` 接口

```typescript
// system-prompt.ts:8-25
export interface BuildSystemPromptOptions {
  /** Custom system prompt (replaces default). */
  customPrompt?: string;
  /** Tools to include in prompt. Default: [read, bash, edit, write] */
  selectedTools?: string[];
  /** Optional one-line tool snippets keyed by tool name. */
  toolSnippets?: Record<string, string>;
  /** Additional guideline bullets appended to the default system prompt guidelines. */
  promptGuidelines?: string[];
  /** Text to append to system prompt. */
  appendSystemPrompt?: string;
  /** Working directory. */
  cwd: string;
  /** Pre-loaded context files. */
  contextFiles?: Array<{ path: string; content: string }>;
  /** Pre-loaded skills. */
  skills?: Skill[];
}
```

只有 `cwd` 必填。其它字段都用合理默认值。

### 二、Base 字符串模板

```typescript
let prompt = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When asked about: extensions (docs/extensions.md), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
```

注意：
- **base 用模板字符串而非外部文件**。最低复杂度。
- **嵌入了关于 pi 自身的引导**——Pi 想让模型知道自己跑在什么 harness 里。
- 没有「Tone and style / Output format」这类大段——这部分要靠 `appendSystemPrompt` 由项目自己补。

### 三、工具列表生成

```typescript
// system-prompt.ts:87-92
const tools = selectedTools || ["read", "bash", "edit", "write"];
const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
const toolsList =
  visibleTools.length > 0
    ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n")
    : "(none)";
```

| 维度 | 表现 |
|---|---|
| 默认工具 | `["read", "bash", "edit", "write"]`（硬编码） |
| 选择机制 | `selectedTools` 决定哪些进 prompt |
| 描述来源 | `toolSnippets[name]`，**调用方注入** |
| 工具未配 snippet | 不进 prompt（即使 selectedTools 包含） |
| 全空时 | 显示 `(none)` |

这种设计的精妙之处：**工具描述的「短版」（在 prompt 里，模型一直看得到）和「长版」（在 tool schema description，模型在 tool calling 时才注入）是两份**。pi 让调用方对短版有完全控制。

### 四、Guidelines 动态生成

```typescript
// system-prompt.ts:94-129
const guidelinesList: string[] = [];
const guidelinesSet = new Set<string>();
const addGuideline = (guideline: string): void => {
  if (guidelinesSet.has(guideline)) return;
  guidelinesSet.add(guideline);
  guidelinesList.push(guideline);
};

const hasBash = tools.includes("bash");
const hasGrep = tools.includes("grep");
const hasFind = tools.includes("find");
const hasLs = tools.includes("ls");
const hasRead = tools.includes("read");

if (hasBash && !hasGrep && !hasFind && !hasLs) {
  addGuideline("Use bash for file operations like ls, rg, find");
} else if (hasBash && (hasGrep || hasFind || hasLs)) {
  addGuideline("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
}

for (const guideline of promptGuidelines ?? []) {
  const normalized = guideline.trim();
  if (normalized.length > 0) addGuideline(normalized);
}

addGuideline("Be concise in your responses");
addGuideline("Show file snippets clearly when working with files");

const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");
```

特点：
- **去重**：传入相同 guideline 只保留一条。
- **条件分支基于工具组合**：如「装了 bash 但没装 grep/find/ls」就提示用 bash 干这些事。
- **业务方可注入额外项**：`promptGuidelines` 让 SDK 用户加自己的引导，不用改 pi。

### 五、追加 sections 的顺序

```typescript
// 顺序固定，按语义而非数据
prompt = base
  + (appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "")
  + (contextFiles.length > 0 ? renderContextFiles(contextFiles) : "")
  + (hasRead && skills.length > 0 ? formatSkillsForPrompt(skills) : "")
  + `\nCurrent date: ${date}`
  + `\nCurrent working directory: ${promptCwd}`;
```

注意：
- **Skills 仅当 `hasRead`**（agent 至少能 read_file 时才推荐 skills，因为 skills 通常是 .md 文件）。
- **Date 和 cwd 永远放最后**。这是因为 LLM 的 prompt cache 通常以「最末尾差异点」做 cache 失效——把易变内容（日期、cwd）放最后影响最小。

### 六、Project Context 段

```typescript
if (contextFiles.length > 0) {
  prompt += "\n\n# Project Context\n\n";
  prompt += "Project-specific instructions and guidelines:\n\n";
  for (const { path: filePath, content } of contextFiles) {
    prompt += `## ${filePath}\n\n${content}\n\n`;
  }
}
```

调用方负责加载 AGENTS.md / .pi.md / 任何项目级别说明文档，pi 只负责拼接。**核心 SDK 不绑定特定文件名**——这与 codex/gemini-cli 硬编码 `AGENTS.md` / `GEMINI.md` 形成对比。

### 七、`customPrompt` 的混合策略

```typescript
// system-prompt.ts:53-80
if (customPrompt) {
  let prompt = customPrompt;
  if (appendSection) prompt += appendSection;

  // Append project context files
  if (contextFiles.length > 0) { /* 同上 */ }

  // Append skills section (only if read tool is available)
  const customPromptHasRead = !selectedTools || selectedTools.includes("read");
  if (customPromptHasRead && skills.length > 0) {
    prompt += formatSkillsForPrompt(skills);
  }

  // Add date and working directory last
  prompt += `\nCurrent date: ${date}`;
  prompt += `\nCurrent working directory: ${promptCwd}`;

  return prompt;
}
```

`customPrompt` 替换的是 `[role + tools + guidelines + pi docs]` 这部分。但 `[appendSystemPrompt → contextFiles → skills → date → cwd]` 这条尾巴不动。**这是一种「框架对运行时上下文有最终发言权」的设计**——用户可以替换业务文案，但日期和 cwd 这些事实信息框架始终保证存在。

## 对 zero2agent 的启示

1. **「单函数 + Options 对象」是 zero2agent 现阶段的最佳起点**。比 gemini-cli 的 12 段渲染函数轻；比 codex 的多 .md 文件 + 模板引擎也轻。pi 的 172 行 `buildSystemPrompt` 完整覆盖了 base / tools / guidelines / context / skills / date / cwd 七件事，可读性极好——这正是「教学项目」需要的简洁度。

2. **工具 snippets 与 tool schema description 分离**。Pi 让调用方提供 `toolSnippets`（短版），而工具自身的 schema description 由 tool registry 提供（长版）。这个 long/short 区分对模型行为有实测影响，spec 时建议显式说明。

3. **Guidelines 动态生成 + 去重**。这是 pi 在「prompt 怎么应对工具组合变化」上给出的优雅答案。zero2agent 当前 4 个工具有 4 条提示，扩展到 8 个工具时按工具组合自动出引导，比硬编码一长串更灵活。可以借鉴。

4. **Date 和 cwd 永远放 prompt 末尾**。这是 pi 的细节，原因是 prompt cache 命中策略——易变内容放末尾，对 cache 影响最小。zero2agent 重构时务必保留这个习惯。

5. **`customPrompt` 替换头部、保留尾部**：这是教科书级别的「业务可替换 / 平台保证不变」分界。spec 可以引用作为最佳实践，本 Story 不一定立刻实现，但 04-backlog.md 可以记录。

6. **不要直接抄的**：pi 的「Pi documentation」段是它对自身 docs 的硬性引导，zero2agent 不需要。`hasBash` 这种「装了某工具就改 guideline」的条件分支当前用不上（zero2agent 没有 bash）。
