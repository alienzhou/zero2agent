# D06：Instruction / AGENTS.md 先预留位置，不实现加载

## 状态

✅ Confirmed

## 背景

Prompt Structure 的完整设计范围已经扩展为六类消息层：

1. System
2. Instruction
3. User
4. Task
5. Tool
6. Response

其中 Instruction 层会承载项目、组织、用户偏好、AGENTS.md、skills 等外部规则。但 Instruction 的实际加载不只是 prompt 拼装问题，还涉及：

- AGENTS.md 文件发现与作用域规则
- cwd / 文件路径相关的匹配关系
- 多级指令的优先级与冲突处理
- skills / 自定义配置的发现和权限控制

这些内容会扩大 S004 的实现范围。

## 决策

S004 **只定义 Instruction 的位置和优先级原则，不实现加载机制**。

建议原则：

```text
System > Project Instruction > User Preference > Task
```

在消息装配设计中，Instruction 是独立层；但本 Story 不做：

- AGENTS.md 搜索
- AGENTS.md 解析
- workspace/user config 加载
- skills 加载
- instruction conflict resolver

## 理由

1. S004 的核心仍是从当前内联 `SYSTEM_PROMPT` 演进到可组合的 prompt builder。
2. AGENTS.md 加载本身是一个完整功能点，应有独立 Story 讨论作用域、优先级和冲突处理。
3. 先预留位置可以保证架构方向正确，不会把 Instruction 硬塞进 System 文案里。
4. 课程叙事更清晰：本节讲消息层地图与 System prompt builder，后续章节再逐步实现 Instruction 加载。

## 对 S004 的影响

- 文档中要说明 Instruction 层的存在。
- `buildSystemPrompt(options)` 可以预留 `instructions?: string[]` 或在 spec/backlog 中记录该扩展点。
- 代码实现阶段不需要读取 AGENTS.md。
- Backlog 中新增「Instruction loader / AGENTS.md support」。
