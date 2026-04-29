# 竞品 System Section 顺序对照

> 本笔记回答 2026-04-29 的问题：调研报告里各家 System Prompt / System Message 的 section 顺序是什么？这些顺序对 zero2agent 的 System Role 设计有什么启发？

## 1. 总览

| 项目 | section 组织方式 | 第一段通常是什么 | Runtime Context 位置 | 工具描述位置 |
|------|------------------|------------------|----------------------|--------------|
| Codex | Markdown base instructions + runtime developer instructions | 身份 + capabilities | 不在 base，运行时 developer/context channel | tool schema，prompt 只写策略 |
| Gemini CLI | `SystemPromptOptions` + `renderXxx()` 固定顺序 | Preamble / identity | sandbox/git 等后置 section；memory final shell 追加 | 段内引用工具名常量 |
| OpenCode | per-model `.txt` + system `string[]` 叠加 | 身份 + usage / docs policy | `<env>` 是独立 system 段，排在 skills/instructions 前 | tool schema 为主 |
| Pi Mono | 单函数模板字符串 + 可选追加段 | 身份 + harness + capabilities | date/cwd 放全文最后 | prompt 短版 + schema 长版 |
| Aider | prompt class 的 `main_system` + `system_reminder` | 身份 + coding behavior | platform 通过 placeholder 注入；repo/files 是独立 chunks | 编辑协议规则在 reminder |
| Claude Code | branded `string[]` + effective system priority chain + cached sections | default/agent/coordinator 取决于优先级 | section cache 中分静态/动态；具体正文不摘录 | 工具名从各 tool prompt 模块导出 |

## 2. Codex

调研报告记录的 `default.md` section 顺序：

1. **Identity**：`You are a coding agent running in the Codex CLI...`
2. **Capabilities**：接收用户 prompt、与用户沟通、调用工具。
3. **How you work**
4. **Personality**
5. **AGENTS.md spec**：作用域与优先级。
6. **Responsiveness**
7. **Preamble messages**
8. **Planning**
9. **Editing constraints**
10. **Plan tool**
11. **Special user requests**
12. **Presenting your work and final message**
13. **Final answer structure and style guidelines**

特点：

- 身份和 capabilities 放最前面。
- AGENTS.md 不是运行时内容，而是先在 base prompt 中定义规范。
- 工具完整说明不放 prompt，走 tool schema。
- runtime permissions/sandbox 不塞进 base prompt，走 developer/context instructions。

对 zero2agent 的启发：

- Role + Capability 应在最前。
- Project Instruction 可以先定义原则，不要把具体 AGENTS.md 内容写进 System。

## 3. Gemini CLI

`getCoreSystemPrompt(options)` 的硬编码顺序：

1. `renderPreamble()`
2. `renderCoreMandates()`
3. `renderSubAgents()`
4. `renderAgentSkills()`
5. `renderHookContext()`
6. `renderPlanningWorkflow()` 或 `renderPrimaryWorkflows()`
7. `renderTaskTracker()`
8. `renderOperationalGuidelines()`
9. `renderInteractiveYoloMode()`
10. `renderSandbox()`
11. `renderGitRepo()`
12. `renderFinalShell()` 追加 user memory

特点：

- 顺序由代码硬编码，不是配置驱动。
- mode/workflow 是中段核心。
- sandbox/git 这类运行时上下文靠后。
- user memory 是 final shell 追加，不在 core base 中。

对 zero2agent 的启发：

- Section 顺序应该写死在 builder 中，便于教学。
- Runtime Context 不一定属于 System 前部；可后置或放到 User Task。

## 4. OpenCode

`anthropic.txt` 的顺序：

1. **Identity + CLI usage**
2. **URL / docs policy**
3. **Tone and style**
4. **Professional objectivity**
5. **Task Management**
6. **Doing tasks**
7. **Tool usage policy**
8. **Code References**

`default.txt` 的顺序：

1. **Identity + help/feedback policy**
2. **Tone and style**
3. **Proactiveness**
4. **Following conventions**
5. **Code style**
6. **Doing tasks**
7. **Tool usage policy**
8. **Code References**

system 数组装配顺序（简化）：

1. environment `<env>` system 段
2. skills 段（可选）
3. project/user instructions
4. structured output prompt（可选）

特点：

- 文件内的 base prompt 从 identity 开始。
- runtime environment 是独立 system 段，不混在 base prompt 里。
- instructions 是独立通道。

对 zero2agent 的启发：

- Runtime Context 可以不进入 base system，作为独立动态段或 User Task context。
- Instruction 与 skills 不应污染默认 System。

## 5. Pi Mono

单函数 base 模板的顺序：

1. **Identity + harness**：expert coding assistant operating inside pi。
2. **Available tools**
3. **Custom tools note**
4. **Guidelines**
5. **Pi documentation**
6. `appendSystemPrompt`（可选）
7. **Project Context**（可选）
8. **Skills**（可选）
9. **Current date**
10. **Current working directory**

特点：

- 最接近 zero2agent 当前阶段。
- date/cwd 放最后，照顾 prompt cache。
- 工具短描述在 prompt 中，长描述仍可在 schema 中。

对 zero2agent 的启发：

- 单函数 builder 足够。
- Runtime Context 放最后是一个简单方案；但如果我们采用 User Task 视角，也可以移出 System。

## 6. Aider

`EditBlockPrompts.main_system` 的结构：

1. **Identity**：expert software developer。
2. **General coding behavior**：best practices、respect conventions。
3. **Final reminders placeholder**：lazy/overeager/language 等动态提醒。
4. **Request handling**：take requests for changes；ambiguous 时提问。
5. **Task flow**：是否需要用户 add files、逐步说明、输出 edit block。
6. **Shell command prompt placeholder**
7. **Example messages**（可作为 system 或普通 examples）
8. **system_reminder**：格式规则、SEARCH/REPLACE block 约束。

特点：

- main_system 讲身份、行为、任务流程。
- system_reminder 专门放硬格式规则。
- repo/files 不放进 System，而作为独立 chat chunks。

对 zero2agent 的启发：

- 可以借鉴 `main_system` + `system_reminder` 的分工：前者讲角色/工作流，后者讲输出和工具协议硬约束。
- 只读文件上下文不应塞进 System。

## 7. Claude Code（还原树）

调研报告不摘录默认 prompt 正文，但可观察到 system 组合顺序：

1. `overrideSystemPrompt`：若存在，整段替换。
2. Coordinator mode：coordinator prompt + append。
3. Agent prompt：
   - Proactive/Kairos：默认 prompt + `# Custom Agent Instructions` + agent prompt。
   - 非 proactive：agent prompt 替换默认 prompt。
4. `customSystemPrompt`：无 agent 时替换默认。
5. `defaultSystemPrompt`：兜底。
6. `appendSystemPrompt`：末尾追加。

另有 `systemPromptSection()` 和 `DANGEROUS_uncachedSystemPromptSection()` 区分可缓存与动态 section。

特点：

- system 是 `string[]` 品牌类型。
- 不是简单“固定 section 列表”，而是先根据模式/agent/custom 选择有效 system，再追加。
- 动态性与 cache 是一等公民。

对 zero2agent 的启发：

- S004 不必实现这么复杂，但应承认：System 可能不是一个静态字符串。
- 如果 Runtime Context 动态变化，放 System 里要考虑 cache；放 User Task 可降低对静态 System 的污染。

## 8. 横向规律

### 共同点

1. **Identity 通常最前**：大多数项目第一段先说明 agent 是谁。
2. **Capability / Boundary 紧跟 Identity**：告诉模型能做什么、不能做什么。
3. **Workflow / Tool Policy 放中段**：在模型理解身份后再约束行动方式。
4. **Output / Formatting 靠后**：回答格式、引用规则、语言通常在后面。
5. **Runtime / Project / Skills 多数不直接混进 base system**：成熟项目倾向独立段、动态段或其它 channel。

### 分歧点

| 问题 | 方案 A | 方案 B |
|------|--------|--------|
| Runtime Context | 放 System 末尾（Pi） | 放独立 env/system 段（OpenCode）或 context/developer channel（Codex） |
| Tool 描述 | prompt 短版 + schema 长版（Pi） | schema-only 或工具名常量引用（Codex/Gemini/OpenCode） |
| Mode | prompt 内 section（Gemini） | 独立 prompt 文件/运行时叠加（OpenCode/Codex） |
| User/Task | 部分项目无显式拆分 | Aider / Claude Code 通过 chunks/sections 区分 |

## 9. 对 zero2agent 的更新建议

结合用户建议，我会调整之前的倾向：

1. **System Section 顺序保留 5 段静态内容**：
   1. Role / Identity
   2. Scope / Capability
   3. Tool Policy
   4. Workflow
   5. Output Contract

2. **Runtime Context 先不强行放进 System**：  
   作为 D07 单独讨论，候选方案改为：
   - A：System 末尾（Pi）
   - B：独立 dynamic system/env 段（OpenCode / Claude Code）
   - C：User Task context（用户建议，适合 S004 简化）

3. **User Task 在 S004 可等同于 User Message**：  
   不单独实现 task extraction，只在文档里预留未来 mode/task 抽象。

## 10. 下一轮建议拍板

1. System 是否先固定为 **5 个静态 section**，暂不包含 Runtime Context？
2. Runtime Context 是否选择 **User Task context** 作为 S004 的设计方向？
3. Tool Policy 是否只写组合策略，不写完整工具清单？
