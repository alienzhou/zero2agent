# System Prompt 设计框架

> 本笔记用于回答：设计 System Prompt 或其它 Instruction（User / Task / Tool / Response）时，需要从哪些项目角度和维度考虑？如何用表格/地图引导用户设计这套套路？

## 1. 先区分两张地图

System Prompt 设计不要只看「应该写哪些段」，还要同时看两张地图：

| 地图 | 回答的问题 | 产物 |
|------|------------|------|
| **Message Layer Map** | 信息应该放在哪个消息层？System / Instruction / User / Task / Tool / Response | `notes/message-layer-map.md` |
| **System Section Map** | 已经确定属于 System 的信息，应该分哪些 section、按什么顺序出现 | 本文 |

第一张地图决定「放不放进 system」；第二张地图决定「进了 system 后怎么组织」。

## 2. System Prompt 的设计维度

| 维度 | 要回答的问题 | 典型选项 | S004 倾向 |
|------|--------------|----------|-----------|
| Identity | 这个 agent 是谁？运行在哪个产品/课程/harness 中？ | 产品 agent / coding agent / read-only agent / review agent | Zero2Agent 只读文件 Agent Harness |
| Capability Boundary | 它能做什么，不能做什么？ | 只读 / 可编辑 / 可执行 shell / 可联网 | 当前只读：read/list/grep/find |
| Tool Policy | 如何选择和组合工具？ | 列工具说明 / 只写工具策略 / 完全依赖 schema | system 写工具策略，schema 写工具说明 |
| Workflow | 面对任务时默认怎么推进？ | 先搜索后阅读 / 先计划 / 先复现 / 先审查 | 先定位文件，再精读，再中文回答 |
| Output Contract | 最终回答怎么写？ | 语言 / 文件引用 / 简洁度 / 是否总结过程 | 中文、简洁、必要时引用路径 |
| Runtime Context | 哪些运行时事实要给模型？ | cwd / date / platform / git / repo root | 先考虑 cwd + date，放末尾 |
| Safety / Boundaries | 哪些行为禁止或需要谨慎？ | 不编辑 / 不执行危险命令 / 不泄露 secrets | 当前强调只读边界即可 |
| Extensibility | 未来如何接入 mode / instruction / skills？ | options / section registry / template | 先用 options 预留，不实现加载 |

这张表可以作为任何 Agent 的 System Prompt 设计检查表。

## 3. System Section Map（建议顺序）

建议把 System Prompt 固定为 6 段，顺序如下：

| 顺序 | Section | 作用 | 静态/动态 | S004 是否实现 |
|------|---------|------|-----------|--------------|
| 1 | Role / Identity | 说明你是谁、运行在哪个 harness 中 | 静态 | ✅ |
| 2 | Scope / Capability | 说明能力边界与只读约束 | 静态 | ✅ |
| 3 | Tool Policy | 说明工具组合策略，不重复参数说明 | 静态为主 | ✅ |
| 4 | Workflow | 说明默认工作流：定位 → 阅读 → 回答 | 静态 | ✅ |
| 5 | Output Contract | 说明回答语言、简洁度、路径引用 | 静态 | ✅ |
| 6 | Runtime Context | 注入 cwd / date 等易变事实 | 动态 | ⚪ 待拍板 |

为什么 Runtime Context 放最后：

- 易变内容放末尾，未来更利于 prompt cache。
- 静态 section 不会因为 cwd/date 改变而整体失效。
- Pi Mono 也采用 date/cwd 末尾追加。

## 4. 什么不应该放进 System

| 信息 | 不放 System 的原因 | 应放位置 |
|------|-------------------|----------|
| 用户本轮具体需求 | 任务级信息，不是长期规则 | User / Task |
| AGENTS.md 原文 | 有作用域、加载和冲突问题 | Instruction |
| 每个工具完整参数说明 | 已在 tool schema 中维护，双写会漂移 | Tool schema |
| 工具执行结果 | 每轮变化，且绑定具体 tool call | Tool response |
| 工具失败后的详细恢复建议 | 属于工具输出契约，不是全局规则 | Tool response / Tool hint |
| plan/debug/review 模式专用规则 | mode-specific，不能污染默认 agent | Task / Mode prompt |
| skills 列表 | 动态、可禁用、可按项目变化 | Instruction / Skills layer |

这张表的核心目的：防止 system prompt 变成「所有规则的大杂烩」。

## 5. System Prompt Builder 的输入模型

S004 可以先不实现完整 message builder，但 `buildSystemPrompt(options)` 应该体现未来方向。

建议概念模型：

```ts
type BuildSystemPromptOptions = {
  role?: string;
  capabilities: string[];
  toolPolicy: string[];
  workflow: string[];
  outputContract: string[];
  runtimeContext?: {
    cwd?: string;
    date?: string;
  };
};
```

现阶段可以更简单：不做太抽象的用户配置，只在 core 内部提供固定 builder。

## 6. 面向其它层的同一套检查表

System 的设计维度可以推广到其它消息层，但每层问法不同：

| 层级 | 核心检查问题 |
|------|--------------|
| Instruction | 来源是谁？作用域多大？优先级如何？是否可禁用？ |
| User | 是否保留原文？是否需要结构化提取？是否要处理多轮追加？ |
| Task | 当前模式是什么？任务目标是什么？约束和验收标准是什么？ |
| Tool | schema 是否完整？失败输出是否有 hint？输出是否可被模型继续消费？ |
| Response | 面向用户的信息密度、语言、引用和失败解释如何约束？ |

这可以成为课程中的「Prompt/Message 设计工具箱」。

## 7. 对 zero2agent 的阶段性建议

### S004 现在做

- 建立 System section 顺序。
- 把 prompt 文案从 TUI 移到 core builder。
- 去掉工具说明双写，system 只保留工具策略。
- 输出规则保持简单：中文、简洁、必要时引用路径。

### S004 只预留

- Instruction 层位置与优先级。
- `string[]` system / prompt cache 的未来空间。
- AGENTS.md loader。
- plan/debug/review mode。
- tool response hint。
- skills/subagents。

## 8. 下一轮建议讨论的问题

1. 上面的 6 段 System Section 顺序是否合理？
2. Tool Policy 是否只写组合策略，不列完整工具说明？
3. Runtime Context 是否在 S004 就放入 cwd + date？
