# D09：Mode-specific 内容属于 System Prompt Fragment/Profile，但不进入 Default System

## 状态

✅ Confirmed

## 背景

S004 的完整设计范围已经覆盖 System / Instruction / User Task / Tool / Response 等消息层。讨论中出现了一个容易混淆的问题：

> plan / debug / review / compact / promotion 等模式规则，到底是否属于 System Prompt？

初始说法是「modes 不进 System」，但这不够精确。根据竞品调研，很多产品确实会把模式规则表达为 system prompt 或 prompt profile：

- Gemini CLI：`planningWorkflow` 与 `primaryWorkflows` 是 system 渲染分支。
- OpenCode：`plan.txt` / `build-switch.txt` 是运行时叠加的 system prompt 片段。
- Codex：review / compact / realtime 等有独立 prompt 模板。
- Claude Code：`systemPromptMode` 支持 replace / append / default。
- Aider：editblock / wholefile / architect / ask / help 是不同 prompt profile。

## 决策

Mode-specific 内容属于 **System Prompt Fragment / Prompt Profile**，但不进入 **Default System** 常驻段。

换句话说：

```text
Default System = 普通 agent 每轮都带的稳定规则
Mode System Fragment/Profile = 某个 mode 激活时才 append / replace / switch 的 system-level 内容
User Task Context = 本轮用户任务和动态事实，不属于 System
```

S004 只预留 Mode System Fragment/Profile 的设计位置，不实现具体模式。

## 理由

1. Mode 规则往往是 system-level 行为约束，例如 plan mode 不能执行、review mode 优先找问题、debug mode 先证据后修改。
2. 这些规则如果常驻 default System，会让普通只读 agent 变重，也会混淆默认行为。
3. 竞品普遍采用按模式切换/追加 prompt 片段，而不是把所有模式写进默认 prompt。
4. 将 mode 抽象为 fragment/profile，未来可以支持 append / replace / switch，而不会推翻 S004 的 default System builder。

## 对 S004 的影响

- `Default System` 只实现普通只读 agent 的稳定 section。
- 文档中预留 `ModeSystemFragment` / `PromptProfile` 概念。
- plan / debug / review / compact / promotion 不在 S004 中实现。
- Backlog 中记录具体 mode 的独立 Story。

## 后续问题

- Mode fragment 的加载方式是配置驱动、代码注册，还是文件模板？
- Mode fragment 与 Instruction / Skills 的优先级如何组合？
- Mode 是否允许完全 replace default system，还是只能 append？
