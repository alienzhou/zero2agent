# E01-S004：固定 Prompt 结构

> 讨论始于 2026-04-27，目标是把当前 `cli.ts` 里的 21 行内联 SYSTEM_PROMPT 重构成可演化、可组合、可解释的结构化 prompt。
>
> 调研已在前置步骤完成：`researches/prompt-structure/{codex,gemini-cli,opencode,pi}.md`。

---

## 🔵 Current Focus

本轮进入 **System Section 顺序对照与 User Task 边界**：先从六份调研报告中提取各家 section 顺序，再讨论 zero2agent 的 System 顺序，以及 Runtime Context 是否应放入 User Task。

参考笔记：`notes/prompt-structure-problem-system.md`

消息层级地图：`notes/message-layer-map.md`

System 设计框架：`notes/system-prompt-design-framework.md`

竞品 Section 顺序对照：`notes/system-section-order-research.md`

## ⚪ Pending（待用户决策）

### 消息层级（本轮收敛）

| 层级 | 解决的问题 | 当前状态 |
|------|------------|----------|
| System | Agent 长期身份、能力边界、全局行为约束 | 🔵 当前讨论：Section 顺序 |
| Instruction | 项目/用户/组织级指令，含 AGENTS.md、skills、配置 | ✅ 已确认：S004 只预留位置和优先级，不实现加载 |
| User Task | 用户原始输入及当前任务上下文；早期设计中 User Message 与 Task 等价 | 🔵 当前讨论：Runtime Context 是否放这里 |
| Tool | 工具 schema、工具调用策略、tool response、失败 hint | 待讨论 |
| Response | 最终回答的格式、语言、引用、摘要策略 | 待讨论 |

### 问题体系（本轮新增）

| 编号 | 问题域 | 覆盖用户提出的问题 | 当前讨论目标 |
|------|--------|------------------|--------------|
| P01 | Prompt 资产与生命周期 | 多模型差异、存储形态、运行时加载/编译期生成、prompt cache | 确定 prompt 是「静态资产」还是「运行时可组合产物」 |
| P02 | Message Channel 设计 | system / user / tool response / instruction 独立通道 | 确定哪些信息属于 system，哪些应作为 task/user/tool feedback |
| P03 | Section 架构与顺序 | 分段、工具装配、环境信息、整体结构与顺序约定 | 定义最小稳定 section 顺序 |
| P04 | Tool Surface 与工具描述 | 工具描述如何注入 prompt、schema、工具失败后的 hint | 消除 prompt 与 tool schema 双写，同时保留模型可用性 |
| P05 | Runtime Context 与项目指令 | cwd / platform / git / AGENTS.md / 用户指令 Instruction | 定义动态上下文如何注入、优先级与作用域 |
| P06 | Mode / Scenario 扩展 | plan / debug / review / context compression / 普通 agent | 区分 S004 必做与未来模式扩展 |
| P07 | Customization / Skills / Subagents | 自定义 prompt、自代理配置、skills、subagents | 定义扩展点，不在 S004 一次做完 |
| P08 | Code Ownership 与文件结构 | core / TUI / 配置文件归属、文件结构 | 确定 prompt builder 应归属 core 还是 TUI |

### 旧版 5 个设计决策（待映射到问题体系）

| 编号 | 主题 | Atlas 推荐 | 备注 |
|------|------|-----------|------|
| D01 | Prompt 存储形态：内联字符串 / `.md` 文件 / TS 段渲染 / 单函数 + Options | **D：单函数 + Options（pi-mono 风格）** | 教学项目优先可读，避免 over-engineering |
| D02 | 工具描述放哪：prompt 内 / tool schema 内 / 两者并存 | **B：仅 schema，prompt 只写"工具组合提示"** | 消除当前 SYSTEM_PROMPT 与 tool schema description 的重复 |
| D03 | System message 是 `string` 还是 `string[]` | **A：当前继续用 `string`，但给 host 抽象 `system: string \| string[]` 入口** | 为未来的多段 cache / plan 模式预留口子，但不立刻拆 |
| D04 | 是否在 prompt 里注入运行时上下文（cwd / date / platform / git） | **B：注入 cwd + date 两项，放 prompt 末尾** | 与 pi-mono 保持一致；放末尾对 prompt cache 命中影响最小 |
| D05 | 是否实现 `customPrompt` 整段替换的逃生口 | **C：本次不做，写进 04-backlog** | YAGNI；当前没有需求驱动 |
| D07 | Runtime Context 放在 System 末尾，还是 User Task 中 | 待讨论 | 用户建议放在 User Task，避免污染 System |
| D08 | User 与 Task 是否在 S004 合并为 User Task | 待讨论 | 用户建议 User Task 等同于 User Message |

## ✅ Confirmed

| 编号 | 决策 | 文档 |
|------|------|------|
| D06 | Instruction / AGENTS.md：S004 只定义优先级和位置，不实现加载 | `decisions/D06-instruction-position-without-loading.md` |

## ❌ Rejected

（暂无）

---

## 决策框架

### D01：Prompt 存储形态

**现状**：[`packages/tui/src/cli.ts:9-21`](https://github.com/alienzhou/zero2agent/blob/main/packages/tui/src/cli.ts#L9) 一段 21 行内联模板字符串。

**4 个候选方案**：

| 方案 | 描述 | 代表项目 | 复杂度 |
|------|------|---------|-------|
| A | 保持内联字符串，简单清理 | （现状） | 低 |
| B | 抽到 `.md` 文件，编译期 import | codex / opencode | 中 |
| C | TS 段渲染函数 + Options 对象（每段一个 render 函数） | gemini-cli | 高 |
| D | 单函数 `buildSystemPrompt(options)`，base 模板 + 可选段追加 | pi-mono | 中-低 |

**Atlas 推荐 D**，原因：
1. 与 zero2agent 当前 monorepo 风格一致（`packages/core` 已有多个类似的 builder 函数）
2. 比 C 简单，但比 A/B 更扩展友好——加段时改一个函数而不是新建文件
3. pi-mono 的 172 行实现是教科书级参考，可以作为 spec 里的"演进目标"展示给读者
4. 课程下一步进 E02（写工具）时，Options 对象已经预留好了扩展位

**取舍**：放弃了 codex 的「per-model 文件 + Template 引擎」，因为 zero2agent 当前只用 Anthropic 一家模型，没有多模型分流需求。

---

### D02：工具描述的归属

**现状**：当前同一份"工具描述"出现两处：
1. **SYSTEM_PROMPT 中的 bullet**（`cli.ts:11-19`）：手写中文一句话
2. **每个 Tool 的 `description` 字段**（`packages/core/src/tools/*.ts`）：手写英文/中文一段话

二者**事实上互不引用、且各自维护**，重复维护成本高、容易漂移。

**3 个候选方案**：

| 方案 | 描述 | 代表项目 |
|------|------|---------|
| A | 短版（在 prompt）+ 长版（在 schema），两份并存但**短版从 schema 自动生成** | pi-mono（半自动） |
| B | **只保留 schema description，prompt 不写工具列表**，仅写"何时用什么工具"的引导 | codex / opencode |
| C | Prompt 写工具名（不写描述），schema 写完整 description，prompt 通过常量引用工具名 | gemini-cli |

**Atlas 推荐 B**，原因：
1. 消除重复——单一信息源（schema description）
2. 模型在 tool calling 阶段才看到 schema description，正好是"决定调哪个工具"的时机，时序最匹配
3. SYSTEM_PROMPT 的篇幅可以大幅缩减（从 21 行到 ~5 行）
4. 当前工具数量少，不写工具列表完全可行；未来工具多了 schema 数量自然就成"目录"

**风险**：模型可能在每轮看不到工具列表的情况下"忘了自己有什么工具"。Codex 的实践证明这是可控的——它的 default.md 也只在 `# General` 段提一句 `prefer rg`。可以在 spec 阶段写测试验证。

**反方观点（值得留意）**：教学项目里把工具明确列出来"让读者一眼看到 prompt 里写了什么"也有价值。如果用户想优先教学清晰度，可能 A 或 C 更合适。

---

### D03：System Message 形态

**现状**：当前 `Agent.run(userMessage)` 直接接收一个字符串 user message，SYSTEM_PROMPT 在内部作为单 string 传给 Anthropic SDK。

**Anthropic Messages API 接受 `system: string | Array<{ type: "text", text: string, cache_control? }>`**——用数组可以分段独立 cache、独立加 cache_control。OpenCode 已经在用这种 array 形式。

**3 个候选方案**：

| 方案 | 描述 | 改动范围 |
|------|------|---------|
| A | host 接口保持 `system: string`，buildSystemPrompt 返回单 string | 最小 |
| B | host 接口改成 `system: string \| string[]`，buildSystemPrompt 默认仍返回 string | 中等，向后兼容 |
| C | host 接口改成 `system: string[]`，强制分段 | 大，破坏性 |

**Atlas 推荐 B**：保持 buildSystemPrompt 的签名简单（默认返回 string），但 host 抽象层接受数组形态，给未来的 cache 控制和 plan 模式预留通道。本 Story 不实际拆分。

**和 D04 的耦合**：如果 D04 选择"注入运行时上下文"，那 cwd/date 这种"易变内容"放数组的最后一段、设置 cache_control: ephemeral 是更优解。但这是 cache 优化，不是本 Story 的核心目标。

---

### D04：运行时上下文注入

**现状**：当前 prompt 完全不带 cwd / date / 平台等上下文。模型不知道自己跑在哪。

**4 家竞品对比**：

| 项目 | cwd | date | platform | git 状态 | 形式 |
|------|-----|------|----------|---------|------|
| codex | ✅ | ❌ | ❌ | ❌ | 独立 developer message |
| gemini-cli | ✅ | ❌ | ✅ (sandbox mode) | ✅ | 段内 |
| opencode | ✅ | ✅ | ✅ | ✅ | `<env>` XML 块（独立 system 段） |
| pi-mono | ✅ | ✅ | ❌ | ❌ | prompt 末尾两行 |

**3 个候选方案**：

| 方案 | 描述 | 复杂度 |
|------|------|-------|
| A | 不注入 | 0 |
| B | 注入 cwd + date 两项，prompt 末尾 | 低 |
| C | 完整 env 块（cwd + date + platform + git status） | 中 |

**Atlas 推荐 B**：
1. 教学曲线友好——一个 prompt 里只引入 1 个新概念（"运行时上下文")
2. cwd 是 S003 已经引入的 `ToolContext.cwd` 的自然延伸——prompt 阶段也用同一份
3. date 极便宜，但能解决"模型按 2024 知识思考 2026 的事"这个常见痛点
4. Platform / git 等留给未来 Story（写工具 / 修改文件时再补）

**放在哪**：与 pi-mono 一致，放 prompt **最末尾**——这样 cache 最稳定（前面静态内容长期 cache，末尾每次刷新）。

---

### D05：customPrompt 逃生口

**现状**：用户/读者无法替换 prompt。

**问题**：作为教学项目，读者很可能想 fork 后改成自己的 prompt。但本 Story 是 S004，主线是"做出第一版结构化 prompt"，不是"做 prompt 配置框架"。

**3 个候选方案**：

| 方案 | 描述 |
|------|------|
| A | 完整实现 pi-mono 风格的 `customPrompt`（替换头部，保留尾部） |
| B | 只实现 `appendSystemPrompt`（追加自定义内容），不允许替换 |
| C | 本次不做，写进 `details/04-backlog.md` 作为后续工作 |

**Atlas 推荐 C**——当前没有实际需求，YAGNI。但 spec 的 backlog 段会清楚记录"这是已知留口"，未来 epic 触及配置时优先做。

---

## 📎 相关上下文

### 调研报告（已完成）

详见 `researches/prompt-structure/`：

- 首轮四家：codex / gemini-cli / opencode / pi（commit `95b1743`）
- 补充：**Aider**（Python / `aider.md`，commit `f46f6c1`）、**Claude Code** 内网 sourcemap 场景的方法说明（`claude-code.md`，无源码引用；背景见子任务 ALI-13）

### 现有代码

- 当前 prompt：[`packages/tui/src/cli.ts:9-21`](https://github.com/alienzhou/zero2agent/blob/main/packages/tui/src/cli.ts#L9)（21 行内联字符串）
- Agent 入口：`packages/core/src/agent.ts`
- Tool 接口（含 description）：`packages/core/src/tools/types.ts`
- Tool 实现：`packages/core/src/tools/{read-file,list-directory,grep-search,find-files}.ts`

### 相关讨论

- E01 路线：`specs/E01-read-and-search/README.md`
- S003（前一个 Story）讨论：`.discuss/2026-03-29/e01-s003-glob-repo-research/outline.md`
- 课程 roadmap：`.discuss/2026-03-14/zero2agent-course-roadmap/outline.md`

---

## ⏭️ 下一步

等用户在 issue comment 里回复 D01-D05 的取舍（哪些采纳推荐 / 哪些要换方案 / 哪些要补充约束），Atlas 把每个 Confirmed 决策写成独立的 `decisions/Dxx-*.md`，然后准备进入 Spec 阶段。
