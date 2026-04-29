# Modes / Skills 扩展位设计

> 本笔记用于回应 2026-04-29 的讨论：S004 虽然不会实现 plan/debug/review/compact/promotion 等模式，也不会实现 skills 加载，但设计必须给这些能力留下明确位置。

## 1. 竞品如何处理模式

| 项目 | 模式/场景 | 放在哪里 | 对 zero2agent 的启发 |
|------|-----------|----------|----------------------|
| Codex | review / compact / realtime / search_tool 等独立模板 | 独立 prompt 文件或 context 模块 | 不要把所有模式写进默认 System；模式应有自己的 prompt 片段 |
| Gemini CLI | `primaryWorkflows` 与 `planningWorkflow` 互斥；compression prompt 独立 | `SystemPromptOptions` 中按 mode 选择 section | mode 是 builder options 的分支，不是字符串拼接 |
| OpenCode | plan / plan-reminder / build-switch / max-steps | 独立 `.txt` 文件，运行时叠加；max-steps 甚至作为 assistant message | mode 片段可以按需叠加，不必污染 base prompt |
| Aider | editblock / wholefile / architect / ask / help 等 prompt class | 不同 `*Prompts` 类 | mode 可以对应不同 prompt profile |
| Claude Code | coordinator / agent / proactive / custom / override；plan 相关工具 | `buildEffectiveSystemPrompt` 优先级链 + systemPromptMode | mode 需要清晰优先级：replace / append / default |
| Pi Mono | 未强调多模式，更多依赖 options 追加 | `appendSystemPrompt` / customPrompt | 简化实现可以先靠 append 预留 |

## 2. zero2agent 的 Mode 设计位置

S004 不实现具体 mode，但应预留以下概念：

```ts
type AgentMode =
  | "default"
  | "plan"
  | "debug"
  | "review"
  | "compact"
  | "promotion";
```

这里的 `"promotion"` 先作为用户提到的未来模式占位，不在 S004 解释业务语义。

建议层级：

| mode 信息 | 所属层 | 说明 |
|-----------|--------|------|
| 当前 mode 是什么 | User Task / Task Mode | 与本轮任务绑定 |
| mode 的长期规则 | Mode Prompt Fragment | 不进入默认 System |
| mode 触发条件 | Runtime / Controller | 不由 prompt 自己判断 |
| mode 输出约束 | Response / Mode Fragment | 如 review 优先问题、debug 先证据 |

## 3. 竞品如何处理 skills

| 项目 | 是否有 skills 概念 | 注入方式 | 关键观察 |
|------|------------------|----------|----------|
| Gemini CLI | 有 `agentSkills` | `renderAgentSkills(options.agentSkills)`，作为 System section | skills 是独立 section，可按是否存在启用 |
| OpenCode | 有 Skill Service | `sys.skills(agent)` 返回一段独立 system 字符串；可被 permission 禁用 | skills 是可权限控制的动态 instruction |
| Pi Mono | 有 `skills?: Skill[]` | `formatSkillsForPrompt(skills)`，且只有 read tool 可用时追加 | skills 往往依赖读取文档能力 |
| Claude Code | 有 `SkillTool` / skill search 相关模块 | 作为工具/服务能力存在，具体正文不在公开仓摘录 | skills 应与工具权限、发现机制绑定 |
| Codex | 未见同名 skills 主路径 | 更强调 AGENTS.md / tools / templates | 可不强求所有 agent 都有 skills 层 |
| Aider | 无显式 skills 层 | 通过不同 prompt class / commands 分能力 | 小系统可先不做 skills |

## 4. zero2agent 的 Skills 设计位置

S004 建议：

- 不实现 skills 加载。
- 把 skills 归入 **Instruction / Skills layer**。
- 在 message assembly 设计中保留一个位置：

```ts
type MessageAssemblyInput = {
  system: SystemSpec;
  instructions?: InstructionSpec[];
  skills?: SkillInstruction[];
  userTask: UserTaskSpec;
};
```

但 S004 的代码实现只需要 `buildSystemPrompt()`，不需要上述完整结构。

## 5. 为什么不能把 modes / skills 都写进 System

| 内容 | 不宜写入默认 System 的原因 | 应放位置 |
|------|--------------------------|----------|
| Plan mode | 只在计划场景生效，会改变默认执行行为 | Task Mode / Mode Fragment |
| Debug mode | 需要证据优先、复现优先，和普通读代码不同 | Task Mode / Mode Fragment |
| Review mode | 输出目标是找问题，不是完成任务 | Task Mode / Response |
| Compact / compression | 面向历史压缩，不是用户任务回答 | 独立 prompt |
| Promotion mode | 语义未定，不能提前污染默认 prompt | Backlog / Mode placeholder |
| Skills | 动态发现、可能受权限控制、可能依赖文件读取 | Instruction / Skills layer |

## 6. S004 的处理策略

| 类型 | S004 是否实现 | S004 是否设计 | 产物 |
|------|--------------|--------------|------|
| default mode | ✅ | ✅ | System builder |
| plan/debug/review/compact/promotion | ❌ | ✅ | backlog + mode extension point |
| skills | ❌ | ✅ | Instruction / Skills layer 位置 |
| subagent custom prompt | ❌ | ✅ | custom/override/append 未来方向 |

## 7. 推荐结论

S004 的设计文档应该明确：

1. **Default System 不包含 mode-specific 内容**。
2. **Mode 是 Task 层或独立 Mode Fragment，不是 System 的常驻 section**。
3. **Skills 是 Instruction 层的动态子类，不是 System 常量**。
4. **自定义 prompt 需要 future API 支持 replace / append，但当前不实现**。

这可以防止一个常见问题：为了“预留未来能力”，把未来所有模式和 skills 都提前塞进默认 system prompt，导致默认 agent 变重、变混乱。
