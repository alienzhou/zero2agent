# 原始 13 个问题覆盖矩阵

> 本笔记用于检查：用户最初提出的 13 个相关问题，是否已经在当前讨论材料中被覆盖；若未实现，是否至少有明确的设计位置或 backlog。

| # | 原始问题 | 当前覆盖位置 | S004 处理方式 | 状态 |
|---|----------|--------------|---------------|------|
| 1 | 考虑不同多模型的差异 | `researches/prompt-structure/{codex,gemini-cli,opencode,claude-code}.md`；`notes/modes-and-skills-extension-map.md` | 不实现多模型分流；记录为 future prompt profile / model adapter | 已覆盖，延后实现 |
| 2 | 分段、工具装配、环境信息；section 顺序；工具描述如何注入 | `notes/system-section-order-research.md`；`notes/system-prompt-design-framework.md` | System 先固定 5 个静态 section；工具描述走 schema，System 写策略 | 已覆盖，待拍板 |
| 3 | 运行时加载 / 编译期生成；存储形态 | `outline.md` D01；`notes/prompt-structure-problem-system.md` P01 | 倾向 core 内 `buildSystemPrompt(options)`，不做模板文件与运行时配置 | 已覆盖，待拍板 |
| 4 | 更多场景：review / 上下文压缩等 | `notes/modes-and-skills-extension-map.md` | 作为 mode / independent prompt future，不进默认 System | 已覆盖，延后实现 |
| 5 | 自定义 / 自代理配置 | `outline.md` D05；`notes/modes-and-skills-extension-map.md` | 记录 replace / append / override 方向，不实现 | 已覆盖，延后实现 |
| 6 | AGENTS.md / cwd / 平台 / git / 动态信息 | `decisions/D06...`；`notes/message-layer-map.md`；`outline.md` D07 | Instruction 只预留；Runtime Context 倾向 User Task；AGENTS.md loader 延后 | 已覆盖，部分 confirmed |
| 7 | prompt cache；动态性和静态性 | `claude-code.md`；`notes/system-section-order-research.md`；`notes/modes-and-skills-extension-map.md` | 静态 System 与动态 User Task 分离；不实现 cache | 已覆盖，延后实现 |
| 8 | 多种模式：plan / debug / 普通 agent | `notes/modes-and-skills-extension-map.md` | S004 只 default mode；其它 mode 预留 extension point | 已覆盖，延后实现 |
| 9 | 工具描述如何注入 Prompt | `outline.md` D02；`notes/system-prompt-design-framework.md` | 倾向 schema-only + Tool Policy | 已覆盖，待拍板 |
| 10 | Prompt 在代码层归属：core / TUI / config / 文件结构 | `outline.md` P08；`notes/prompt-structure-problem-system.md` | 倾向 core 拥有 builder，TUI 只传 user task | 已覆盖，待拍板 |
| 11 | 不只 system；user message / tool response message 构建；失败 hint | `notes/message-layer-map.md`；`notes/modes-and-skills-extension-map.md` | 设计覆盖六层；S004 不实现完整 message builder；tool hint 入 backlog | 已覆盖，延后实现 |
| 12 | skills 特性 | `notes/modes-and-skills-extension-map.md` | 归入 Instruction / Skills layer；不实现加载 | 已覆盖，延后实现 |
| 13 | 用户指令独立通道 / Instruction | `decisions/D06-instruction-position-without-loading.md` | 已确认：只预留位置与优先级，不实现加载 | ✅ Confirmed |

## 覆盖状态总结

| 类别 | 数量 | 条目 |
|------|------|------|
| 已确认 | 1 | #13（Instruction 加载延后，但预留位置和优先级） |
| 已覆盖，待拍板 | 4 | #2、#3、#9、#10 |
| 已覆盖，延后实现 | 8 | #1、#4、#5、#6、#7、#8、#11、#12 |

## 仍需下一轮拍板的问题

1. **D02**：工具描述是否采用 schema-only + System Tool Policy。
2. **D07**：Runtime Context 是否放入 User Task，而不是 System。
3. **D08**：S004 是否正式把 User Task 等同于 User Message，不做 task extraction。
4. **P08/D01**：core 是否拥有 `buildSystemPrompt()`，TUI 只传 user task。

## 不在 S004 实现但必须进入 backlog 的事项

- 多模型 prompt profile。
- mode prompt fragments：plan / debug / review / compact / promotion。
- AGENTS.md / Instruction loader。
- skills discovery / loading / permission。
- custom prompt replace / append。
- tool response hint envelope。
- prompt cache / static-dynamic section control。
