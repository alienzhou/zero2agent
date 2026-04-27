# Gemini CLI System Prompt 结构调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| 调研 Commit | `42587de7338f65e075070eeea33a4149266d05ae` |
| 最近 Tag | `42587de`（commit 短哈希；该 commit 未直接打 tag） |
| Commit 日期 | `2026-04-24 17:21:12 -0700` |
| 调研日期 | `2026-04-27` |

## 调研目标

为 E01-S004（固定 Prompt 结构）迭代提供参考。Gemini CLI 是 Google 官方 AI Agent CLI，TypeScript 实现，与 zero2agent 技术栈一致，重点关注：

1. **Prompt 是否已抽象成结构化对象** —— 是字符串拼接还是分段渲染？
2. **段（Section）的命名约定与开关粒度** —— 哪些段是必有的，哪些可选？
3. **工具如何在 prompt 里被引用**？
4. **环境上下文（git/sandbox/memory）如何接入**？
5. **新旧模型如何分流**？

## 调研结论

1. **Prompt 通过 `PromptProvider` 类编排，分段函数化渲染**。`packages/core/src/prompts/promptProvider.ts` 的 `getCoreSystemPrompt(context, userMemory, ...)` 一个方法负责采集所有上下文、构造 `SystemPromptOptions` 对象、调用 `snippets.ts` 里的纯渲染函数拼装。**采集逻辑和渲染逻辑严格分离**。

2. **Section 共 12 个，全部用 `# / ##` markdown 标题**：`Preamble`、`CoreMandates`、`SubAgents`、`AgentSkills`、`HookContext`、`PrimaryWorkflows`（与 `PlanningWorkflow` 互斥）、`TaskTracker`、`OperationalGuidelines`、`InteractiveYoloMode`、`Sandbox`、`GitRepo`、`FinalReminder`。每段对应一个 `renderXxx(options?: XxxOptions): string`，options undefined 时返回空字符串。

3. **新旧模型走两套 snippets 文件**。`snippets.ts`（modern）vs `snippets.legacy.ts`（旧模型），由 `supportsModernFeatures(model)` 自动选择。这是 codex 的 per-model 思路的弱化版——不为每个模型单独写文件，但保留新旧两套渲染。

4. **工具名通过常量 + `formatToolName()` 注入**。Prompt 不写工具的 schema，但会在工作流中以 `${formatToolName(EDIT_TOOL_NAME)}` 这种方式插入工具名（渲染成反引号包裹的标识符）。这样工具改名时只需改一处常量，所有 prompt 引用同步更新。

5. **完整的覆盖机制：环境变量 `GEMINI_SYSTEM_MD` 一键替换整段 base prompt**。指向一个 `.md` 文件即可整体替换，再用 `applySubstitutions` 对 `{{ skills }}` 等占位符做替换。这给用户/企业 fork 留足了改造空间，同时上层逻辑不受影响。

## 详细分析

### 一、文件分布

```
packages/core/src/
├── core/prompts.ts                    # 42 行，对外门面，重导出 PromptProvider
├── prompts/
│   ├── promptProvider.ts              # 347 行，编排（采集 + 调度）
│   ├── snippets.ts                    # 880 行，分段渲染函数（modern）
│   ├── snippets.legacy.ts             # 旧模型版本
│   ├── prompt-registry.ts             # 多用途 prompt（如 compression）的注册表
│   ├── promptProvider.ts              # （同上）
│   └── utils.ts                       # applySubstitutions / resolvePathFromEnv / isSectionEnabled
└── tools/tool-names.ts                # 工具名常量（EDIT_TOOL_NAME / SHELL_TOOL_NAME / ...）
```

### 二、`SystemPromptOptions` 对象（12 个 section）

```typescript
// snippets.ts:43-56
export interface SystemPromptOptions {
  preamble?: PreambleOptions;
  coreMandates?: CoreMandatesOptions;
  subAgents?: SubAgentOptions[];
  agentSkills?: AgentSkillOptions[];
  hookContext?: boolean;
  primaryWorkflows?: PrimaryWorkflowsOptions;
  planningWorkflow?: PlanningWorkflowOptions;  // 与 primaryWorkflows 互斥
  taskTracker?: string;
  operationalGuidelines?: OperationalGuidelinesOptions;
  sandbox?: SandboxOptions;
  interactiveYoloMode?: boolean;
  gitRepo?: GitRepoOptions;
}
```

每个 section 自带其需要的运行时输入（如 `PrimaryWorkflowsOptions` 需要 `enableGrep / enableGlob / approvedPlan` 等）。

### 三、组合函数（top-level）

```typescript
// snippets.ts:142-170
export function getCoreSystemPrompt(options: SystemPromptOptions): string {
  return `
${renderPreamble(options.preamble)}

${renderCoreMandates(options.coreMandates)}

${renderSubAgents(options.subAgents)}

${renderAgentSkills(options.agentSkills)}

${renderHookContext(options.hookContext)}

${
  options.planningWorkflow
    ? renderPlanningWorkflow(options.planningWorkflow)
    : renderPrimaryWorkflows(options.primaryWorkflows)
}

${options.taskTracker ? renderTaskTracker(options.taskTracker) : ''}

${renderOperationalGuidelines(options.operationalGuidelines)}

${renderInteractiveYoloMode(options.interactiveYoloMode)}

${renderSandbox(options.sandbox)}

${renderGitRepo(options.gitRepo)}
`.trim();
}
```

特点：
- **顺序硬编码在组合函数里**。可见性最高，没有运行时排序。
- **空 section 自然消失**：`renderXxx(undefined)` 返回空字符串，多余空行最后由 `sanitizedPrompt = finalPrompt.replace(/\n{3,}/g, '\n\n')` 收敛。

### 四、Section 内容举例

**Preamble**（`renderPreamble`，分 interactive 与否）：

```
You are Gemini CLI, an interactive CLI agent specializing in software
engineering tasks. Your primary goal is to help users safely and effectively.
```

**CoreMandates**：包含 Security & System Integrity / Context Efficiency / Scope Adherence 等子段。

**PrimaryWorkflows**：

```markdown
# Primary Workflows

## Development Lifecycle
Operate using a Research → Strategy → Execution lifecycle...

## New Applications
Goal: Autonomously implement...
```

**OperationalGuidelines**：包括 Tone and Style / Security and Safety Rules / Tool Usage / Interaction Details 4 个 `##` 子段。Tool Usage 段直接引用 tool name 常量：

```typescript
- **Command Execution:** Use the ${formatToolName(SHELL_TOOL_NAME)} tool...
- **File Editing Collisions:** Do NOT make multiple calls to the ${formatToolName(EDIT_TOOL_NAME)} tool...
```

### 五、上下文采集（PromptProvider）

`getCoreSystemPrompt(context)` 采集流程（350 行的核心方法）：

```typescript
const interactiveMode = interactiveOverride ?? context.config.isInteractive();
const approvalMode = context.config.getApprovalMode?.() ?? ApprovalMode.DEFAULT;
const isPlanMode = approvalMode === ApprovalMode.PLAN;
const skills = context.config.getSkillManager().getSkills();
const toolNames = context.toolRegistry.getAllToolNames();
const enabledToolNames = new Set(toolNames);
// ...
const desiredModel = resolveModel(...);
const isModernModel = supportsModernFeatures(desiredModel);
const activeSnippets = isModernModel ? snippets : legacySnippets;
```

构造 `options` 时通过 `withSection(key, factory, guard)` 辅助函数批量做 **「外部 feature flag + 段内 enable 条件」** 双门：

```typescript
private withSection<T>(key: string, factory: () => T, guard: boolean = true): T | undefined {
  return guard && isSectionEnabled(key) ? factory() : undefined;
}
```

`isSectionEnabled` 又读一份 section feature flag 表，让特定 section 可以全局禁用。

### 六、整段替换的逃生口

```typescript
// promptProvider.ts:111-132
const systemMdResolution = resolvePathFromEnv(process.env['GEMINI_SYSTEM_MD']);

if (systemMdResolution.value && !systemMdResolution.isDisabled) {
  let systemMdPath = path.resolve(path.join(GEMINI_DIR, 'system.md'));
  if (!systemMdResolution.isSwitch) {
    systemMdPath = systemMdResolution.value;
  }
  basePrompt = fs.readFileSync(systemMdPath, 'utf8');
  const skillsPrompt = activeSnippets.renderAgentSkills(...);
  basePrompt = applySubstitutions(basePrompt, context.config, skillsPrompt, isModernModel);
}
```

也提供反向通道——`GEMINI_WRITE_SYSTEM_MD` 环境变量让 CLI 把当前组装好的 prompt 落盘，给用户作为定制起点。

### 七、Final Shell 阶段

`getCoreSystemPrompt` 完事后还要再走 `renderFinalShell` 包一层，注入 user memory（hierarchical：global / extension / project）和 context filenames（默认 `GEMINI.md`），最后再 sanitize：

```typescript
let sanitizedPrompt = finalPrompt.replace(/\n{3,}/g, '\n\n');
if (isTopicUpdateNarrationEnabled) {
  // 拼接 [Active Topic: ...] 行
}
```

Topic 状态由 sanitization 后单独追加，避免影响 cache 命中。

### 八、Modern vs Legacy

通过 `supportsModernFeatures(model)` 的布尔结果选择 `snippets` 还是 `snippets.legacy`：

```typescript
const activeSnippets = isModernModel ? snippets : legacySnippets;
const getCoreSystemPrompt = activeSnippets.getCoreSystemPrompt as (...) => string;
basePrompt = getCoreSystemPrompt(options);
```

这是 codex 「per-model 文件」的轻量化版——只切两档（新/旧），文件大小可控。差异主要在 final reminder 段和工作流文案的措辞。

## 对 zero2agent 的启示

1. **「Options 对象 + 段渲染函数」是值得偷的设计模式**。每个 section 一个可选的 options struct（明确依赖什么运行时数据），一个对应的 `render` 纯函数（接收 options 返回字符串），加一个 top-level 组合函数硬编码顺序。zero2agent 在 S004 完全可以用 TypeScript 落地这个模式，比 codex 的 `.md + Template` 引擎更轻量。

2. **工具名走常量**。`packages/core/src/tools/tool-names.ts` 的 `READ_FILE_TOOL_NAME = "read_file"` 这种实现非常便宜但好处明显——prompt 里所有工具引用都通过 `${formatToolName(READ_FILE_TOOL_NAME)}` 拼，工具改名时只动一处。zero2agent 当前在 prompt 里硬编码字符串 `read_file / list_directory / grep_search / find_files`，重构时建议跟着抽。

3. **Section 顺序硬编码**比配置驱动更好理解。Gemini 没有用「section list」的数据结构来灵活排序，而是直接在 `getCoreSystemPrompt` 函数里写死顺序。这与 zero2agent「教学项目，可读性优先」的目标契合。

4. **段落拼接后做 `\n{3,}` 收敛**是个简单但实用的 trick。多个空 section 合并不会留多余空行。可以照抄。

5. **`GEMINI_SYSTEM_MD` 整段替换 + `applySubstitutions(basePrompt, ..., {{ skills }}, ...)`**：这是给企业用户/读者 fork 后整段重写的逃生口。在 S004 里我们暂时不需要做（YAGNI），但 spec 的「未来工作」可以提及。

6. **不要现在做**：modern/legacy 分流、`isSectionEnabled` 全局开关、user memory hierarchical、topic state、planning vs primary workflow 互斥——这些是 Gemini 在多年迭代后才积累的复杂度；zero2agent 当前 4 个工具的只读 agent 没必要先吃下。
