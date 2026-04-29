# Prompt Structure 问题体系

> 本笔记用于承接 2026-04-29 的讨论：用户提出 13 个相关但不完全正交的问题，希望基于竞品调研整理出一套需要解决的问题体系，再回到 zero2agent 的产品设计中取舍。

## 一、为什么不能只讨论「system prompt」

从调研看，成熟 Agent 很少只把问题理解为「写一段 system prompt」：

- **Claude Code / OpenCode** 都把 system 设计成多段数组或可组合片段，而不是单字符串。
- **Aider** 把 repo 摘要、只读文件、chat files 拆成不同 message chunk，而不是全部塞进 system。
- **Gemini CLI** 用 `PromptProvider` 先采集上下文，再用 sections 渲染 prompt。
- **Codex** 把静态 base instructions 与运行时 permission/developer instructions 分通道处理。

所以 S004 更准确的问题不是「SYSTEM_PROMPT 怎么分段」，而是：

> Agent Harness 在每一轮模型调用前，如何把角色、任务、工具、环境、项目约束、用户指令、模式与工具反馈组织成一组稳定、可演化、可测试的 messages？

## 二、8 个问题域

### P01：Prompt 资产与生命周期

覆盖问题：多模型差异、存储形态、运行时加载/编译期生成、prompt cache。

关键问题：

- Prompt 是源码的一部分，还是可配置资产？
- 多模型差异是现在就建模，还是只留未来扩展口？
- 哪些内容是静态的，哪些每轮都会变？
- 如果未来做 prompt cache，哪些段必须稳定？

竞品参考：

- Codex：per-model `.md` + template。
- Gemini CLI：modern / legacy 两套 snippets。
- Claude Code：section cache 与 cache-breaking section。
- Pi：单函数 builder，date/cwd 放末尾。

zero2agent 初步倾向：

- S004 先做 **单函数 builder + options**，不做 per-model 文件。
- 明确区分「静态 base」与「动态 context」，但不实现 cache。

### P02：Message Channel 设计

覆盖问题：system prompt、user message、tool response message、用户指令独立通道。

关键问题：

- 哪些信息属于长期行为约束（system）？
- 哪些信息属于本轮任务（user/task message）？
- 哪些信息属于工具执行结果（tool response）？
- 工具失败后的 hint 应该是 tool response 的一部分，还是系统提示的一部分？
- 用户或项目指令应与系统内置规则合并，还是独立 channel？

竞品参考：

- Aider：repo/read-only/chat files 拆成独立 chunks。
- Codex：AGENTS.md 与 permissions 更接近 developer/context channel。
- OpenCode：environment / skills / instructions 进入 system 数组。

zero2agent 初步倾向：

- S004 不只改 system prompt 文案；要在 spec 里定义 **message builder** 的边界。
- 代码实现可以先保守：system 仍是一段字符串，但文档上明确未来会扩为 message assembly。

### P03：Section 架构与顺序

覆盖问题：分段、工具装配、环境信息、整体结构与顺序约定。

关键问题：

- 最小 section 应该有哪些？
- section 顺序由代码硬编码，还是配置驱动？
- 动态信息放前面还是末尾？

建议候选顺序：

1. Role / Identity：你是谁，处在哪个 harness 中。
2. Scope / Capability：当前只读能力边界。
3. Tool Policy：何时使用哪些工具，不重复 tool schema。
4. Workflow / Behavior：查找、阅读、回答的默认流程。
5. Output Contract：回答语言、引用文件路径、简洁度。
6. Runtime Context：cwd、date 等易变内容，放末尾。

zero2agent 初步倾向：

- 顺序硬编码在 builder 中，便于教学阅读。
- 不引入 section registry 或模板引擎。

### P04：Tool Surface 与工具描述

覆盖问题：工具描述如何注入 prompt、schema、工具失败后的额外 hint。

关键问题：

- 工具说明是否应重复出现在 system prompt 中？
- tool schema description 是唯一信息源吗？
- prompt 里应该写工具列表，还是只写工具组合策略？
- tool response 是否允许携带「下一步建议」？

竞品参考：

- Codex / OpenCode：工具 schema 承担主要描述。
- Gemini CLI：prompt 中引用工具名常量，避免字符串漂移。
- Pi：prompt 中有短版 snippet，schema 中有长版 description。

zero2agent 初步倾向：

- S004 避免重复维护工具说明。
- prompt 只写「组合策略」，如先 `find_files` 定位，再 `read_file` 精读。
- tool response 的失败 hint 作为工具输出契约的一部分，另起 Story 细化。

### P05：Runtime Context 与项目指令

覆盖问题：cwd、平台、git、AGENTS.md、用户指令 Instruction。

关键问题：

- `cwd` 是否是 prompt context，还是只属于 tool context？
- AGENTS.md 是 system 的一部分，还是独立 project instruction？
- 用户自定义 instruction 与内置规则冲突时谁优先？

竞品参考：

- Codex：AGENTS.md 有作用域与优先级规则。
- Claude Code：有独立 instruction 与 section cache 体系。
- OpenCode：environment / instructions / skills 分段进入 system。

zero2agent 初步倾向：

- S004 只把 `cwd` 与 `date` 纳入 runtime context。
- AGENTS.md 支持留到后续 Story，但在 spec 中先定义优先级原则：系统规则 > 项目规则 > 用户偏好。

### P06：Mode / Scenario 扩展

覆盖问题：plan、debug、review、上下文压缩、普通 agent。

关键问题：

- mode 是 prompt 的条件分支，还是独立 prompt profile？
- 是否需要为 review / compaction 这类任务建立独立 prompt？
- S004 是否要支持 mode？

竞品参考：

- OpenCode：plan / max-steps / build-switch 是运行时叠加片段。
- Codex：review / compact / realtime 独立 prompt 文件。
- Gemini CLI：primaryWorkflow 与 planningWorkflow 互斥。

zero2agent 初步倾向：

- S004 只服务普通只读 agent。
- 在设计中保留 `mode` 概念，但不实现 plan/debug/review。

### P07：Customization / Skills / Subagents

覆盖问题：自定义 prompt、自代理配置、skills。

关键问题：

- 用户能否替换或追加 system prompt？
- skills 是 prompt 的一部分，还是独立工具加载机制？
- subagent 的 prompt 是继承主 prompt，还是完全独立？

竞品参考：

- Pi：`customPrompt` 替换头部但保留 runtime 尾部。
- Claude Code：`overrideSystemPrompt` / `appendSystemPrompt` / agent prompt 优先级明确。
- OpenCode：skills 独立段，权限可禁用。

zero2agent 初步倾向：

- S004 不做自定义、skills、subagents。
- 但 spec 应明确：未来扩展不能依赖硬编码全局字符串，必须走 builder/options。

### P08：Code Ownership 与文件结构

覆盖问题：Prompt 在 core / TUI / 配置文件的归属。

关键问题：

- prompt builder 属于 core 还是 TUI？
- TUI 是否只负责交互，core 负责 agent 行为？
- tool registry 是否应该参与 prompt construction？

竞品参考：

- Gemini CLI：core 的 `PromptProvider` 负责编排。
- OpenCode：session/system service 负责 system 组合。
- Pi：coding-agent core 内 `buildSystemPrompt()`。

zero2agent 初步倾向：

- `packages/core` 拥有 prompt builder。
- `packages/tui` 只传入 runtime context 与运行用户输入。

## 三、从问题体系回到 S004 的切入点

S004 不应该一次解决全部 8 个问题域。更合适的切入方式：

1. **先定义边界**：S004 解决普通只读 agent 的 prompt structure，不解决 plan/debug/review/skills/subagent。
2. **再定义最小架构**：`buildSystemPrompt(options)`，包含静态 base、tool policy、runtime context。
3. **最后定义未来扩展位**：system 数组、instruction channel、AGENTS.md、custom prompt、mode 都进入 backlog。

## 四、建议下一轮讨论聚焦的 3 个问题

1. **S004 的目标是「prompt builder」还是更大的「message builder」？**  
   如果只做 prompt builder，user/tool response 的设计进入 backlog；如果做 message builder，本 Story 范围会明显变大。

2. **工具描述是否彻底从 system prompt 中移除？**  
   这决定 D02 的方向，也决定课程读者是从 tool schema 还是 prompt 文案理解能力边界。

3. **`string[]` system 是否现在进入 core 类型？**  
   Claude Code / OpenCode 强烈支持这个方向，但 zero2agent 当前实现可以先返回 string，避免过早改 host 抽象。
