# OpenCode System Prompt 结构调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [sst/opencode](https://github.com/sst/opencode)（仓库已迁移到 [anomalyco/opencode](https://github.com/anomalyco/opencode)） |
| 调研 Commit | `61eabfc60c1005d1b2b11849d70696a3dcef293e` |
| 最近 Tag | `61eabfc`（commit 短哈希） |
| Commit 日期 | `2026-04-27 17:02:27 +0800` |
| 调研日期 | `2026-04-27` |

## 调研目标

为 E01-S004（固定 Prompt 结构）迭代提供参考。OpenCode 是 TypeScript 实现的开源 CLI agent，与 zero2agent 技术栈一致，重点关注：

1. **Prompt 是否文件化**？
2. **如何按模型分流**？
3. **Prompt 在最终请求里怎么交付（单字符串 vs 数组）**？
4. **环境上下文如何拼装**？
5. **Skills / 用户指令等扩展段如何接入**？

## 调研结论

1. **Prompt 是 `.txt` 文件，按模型分文件，运行时按模型 ID 字符串匹配选择**。`packages/opencode/src/session/prompt/` 目录下 13 个 `.txt` 文件（anthropic / gpt / gemini / kimi / codex / beast / trinity / default 等），通过 Bun 的 `text` import 编译期内联，运行时由 `provider(model)` 函数（[`session/system.ts:19`](https://github.com/anomalyco/opencode/blob/main/packages/opencode/src/session/system.ts)）按 `model.api.id` 包含的字符串选择对应文件。

2. **System message 是字符串数组而非单字符串**。最终发送给 LLM 的 system 字段是 `[basePrompt, envBlock, skillsBlock, ...userInstructions]` 的数组（`session/prompt.ts:1445`），由 AI SDK 的 provider 适配层决定如何拼接（Anthropic 多块 system / OpenAI 单段拼接）。

3. **环境上下文是独立的一段「`<env>` XML 块」**：当前 cwd、worktree、是否 git、平台、日期五项，由 `SystemPrompt.environment(model)` 在每次请求时即时生成。这是 codex「权限块走 developer message」的简化版——opencode 把所有运行时上下文挤进同一段 env XML。

4. **Skills 是另一段独立 system 字符串**，由权限决定是否启用。`SystemPrompt.skills(agent)` 检查 agent 的 `permission.skill` 配置，如果可用就拼接所有 available skills 的描述，作为一段独立 string 进入 system 数组。

5. **Plan / max-steps / build-switch 等是 ad-hoc 注入的额外 prompt**。Plan 模式开启时把 `plan.txt` 作为 system 一段；max-steps 即将到达时把 `MAX_STEPS` 作为最后一条 assistant message；切换 build 模式时插 `build-switch.txt`。**这种「不在 base prompt 里写 if 分支，而是把分支独立成 prompt 文件并在运行时按需注入」是 opencode 的核心模式**。

## 详细分析

### 一、文件清单

```
packages/opencode/src/session/prompt/
├── anthropic.txt              # 105 行，Claude 用
├── beast.txt                  # 147 行，BEAST 模式（GPT-4 / o1 / o3）
├── codex.txt                  #  79 行，gpt codex 用
├── copilot-gpt-5.txt          # 143 行
├── default.txt                # 105 行，默认
├── gemini.txt                 # 155 行
├── gpt.txt                    # 107 行
├── kimi.txt                   #  95 行
├── trinity.txt                #  97 行
├── plan.txt                   #  26 行，plan 模式注入
├── plan-reminder-anthropic.txt#  67 行，Anthropic 在 plan 模式末尾的提醒
├── max-steps.txt              #  15 行，将达到 max steps 时的最后一条 assistant
└── build-switch.txt           #   5 行，切换到 build 模式时
```

### 二、模型选择逻辑

```typescript
// session/system.ts:19-33
export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) return [PROMPT_CODEX]
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}
```

注意返回的是**数组**（即使只有一个元素），暗示设计就考虑了「未来一种模型可能用多段拼接」。

### 三、Effect 服务化

OpenCode 用 `effect` 库做依赖注入，`SystemPrompt` 是一个 `Service`：

```typescript
// session/system.ts:35-80
export interface Interface {
  readonly environment: (model: Provider.Model) => string[]
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment(model) {
        const project = Instance.project
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${Instance.directory}`,
            `  Workspace root folder: ${Instance.worktree}`,
            `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
        ]
      },

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return
        const list = yield* skill.available(agent)
        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)
```

环境块的注释值得抄：作者发现 verbose 形式（写在 system prompt 里）配合 less verbose 的 tool description 比反过来效果好。

### 四、最终 system 数组组装

```typescript
// session/prompt.ts:1439-1454
const [skills, env, instructions, modelMsgs] = yield* Effect.all([
  sys.skills(agent),
  Effect.sync(() => sys.environment(model)),
  instruction.system().pipe(Effect.orDie),
  MessageV2.toModelMessagesEffect(msgs, model),
])
const system = [...env, ...(skills ? [skills] : []), ...instructions]
const format = lastUser.format ?? { type: "text" as const }
if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)

const result = yield* handle.process({
  user: lastUser, agent, ...
  system,                  // ← 字符串数组
  messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
  tools, model, ...
})
```

注意：
- **system 是 `string[]`**，不是单个 string。下游适配层（AI SDK）把这个数组按 provider 协议拼装。
- `MAX_STEPS` 不进 system，而是作为 **assistant 消息**追加在对话末尾——这是非常聪明的设计：让模型「以为自己应该停了」，比 system 命令更可靠。

### 五、`anthropic.txt` 的 section 结构

`anthropic.txt`（105 行）的段落（非常接近 Claude Code 的官方 system prompt）：

```
[顶部 4 行：身份 + 用途 + URL 政策]

# Tone and style
# Professional objectivity
# Task Management（举例：TodoWrite 使用模式）
# Doing tasks
# Tool usage policy
# Code References

[底部：tool usage policy 的具体例子]
```

`default.txt`（105 行）则有更多段：`Tone and style` / `Proactiveness` / `Following conventions` / `Code style` / `Doing tasks` / `Tool usage policy` / `Code References`。

不同模型文件的差异主要在：
- **顶部身份语气**（anthropic 「OpenCode, the best coding agent on the planet」vs gpt 「opencode」）
- **示例和反例**的具体文案
- **某些段在某些模型里的强弱**（如 Code style 段在 default 里强调，在 anthropic 里被合并）

### 六、用户指令（Instruction）独立通道

```typescript
const [skills, env, instructions, ...] = yield* Effect.all([
  sys.skills(agent),
  Effect.sync(() => sys.environment(model)),
  instruction.system().pipe(Effect.orDie),
  ...
])
const system = [...env, ...(skills ? [skills] : []), ...instructions]
```

`instruction.system()` 取项目里的 AGENTS-equivalent 文件（如 `AGENTS.md`、`OPENCODE.md`），作为独立段落进入 system 数组。

### 七、运行时注入 Plan / build-switch / max-steps

不写在 base prompt 里：

- **plan.txt**（26 行）：plan 模式开启时作为额外 system 段附加。
- **plan-reminder-anthropic.txt**：Anthropic 在 plan 模式末尾再提醒一次。
- **build-switch.txt**（5 行）：用户从 plan 切到 build 模式时，作为「转场提示」注入。
- **max-steps.txt**（15 行）：作为最后一轮的 assistant message 注入。

这种**「需要时再叠加一段，不在 base prompt 里维护开关」**模式特别清爽。

## 对 zero2agent 的启示

1. **system 用「字符串数组」而非单字符串**是个相当重要的设计抉择。AI SDK 和 Anthropic 等 API 原生支持多段 system，分段可以独立 cache。zero2agent 当前 `agent.run(message)` 内部不知道 system 是字符串还是数组——重构时建议改成数组接受，让 base + env + instructions 各占一段，未来扩展便宜。

2. **「按需叠加 prompt 段」比「在一段 prompt 里 if-else」清爽得多**。OpenCode 的 plan / max-steps / build-switch 都是独立 .txt，按运行时状态决定是否注入。zero2agent 后续如果做 plan 模式，可以直接抄这套模式。

3. **环境段写成 `<env>` XML 块**。比 markdown bullet 列表更不容易被模型当成业务内容混淆。可以抄。

4. **`text` import**（编译期把 .txt 文件内联到 bundle）：Vite/Bun/esbuild 都支持这种 import attribute，TypeScript 也能处理。zero2agent 把 prompt 写成 `.md/.txt` 文件、`import PROMPT from "./prompts/system.md"` 引入，这是个很现代的做法。

5. **不要现在做的**：按模型分文件（zero2agent 当前只用 Claude，没有这个需求）、Effect Service 化（过重）、verbose skill description 与 tool description 两段并存（zero2agent 没有 skill 概念）。

6. **教学价值**：opencode 是「**用文件管理而不是用代码 if-else 管理 prompt 变体**」的最纯粹示例。在 spec 的 deep-dive 里可以单独讨论这种思路 vs gemini-cli 的「options 对象 + 段渲染函数」思路，让读者看到两种主流路线。
