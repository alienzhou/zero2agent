# E01-S004: Backlog

> 当前版本确定不做的事项，留待后续迭代。

---

## 功能 Backlog

### Instruction / 项目规则

| 事项 | 说明 | 优先级 / 原因 |
|------|------|---------------|
| AGENTS.md loader | 按 cwd / 作用域发现并加载项目指令 | 高；需要独立讨论作用域与冲突 |
| Instruction conflict resolver | 处理 System / Project / User / Task 指令冲突 | 高；加载前必须先有规则 |
| 用户偏好配置 | 例如回答语言、详细程度、默认模式 | 中；当前只有单用户 CLI |
| 工作区配置 | workspace 级别的默认指令和安全策略 | 中；等多 workspace / host 形态出现 |

### Mode System Fragment / Prompt Profile

| 事项 | 说明 | 优先级 / 原因 |
|------|------|---------------|
| Plan mode | 只讨论方案，不执行或修改 | 高；常见 agent 模式 |
| Debug mode | 先证据、复现、定位，再修改 | 高；需要独立方法论 |
| Review mode | 默认优先找问题，而不是总结优点 | 中；输出契约与普通模式不同 |
| Compact / compression | 面向历史压缩和上下文整理 | 中；需要 prompt cache / message history 配合 |
| Promotion mode | 用户提到的未来模式占位，语义待定义 | 低；先保留命名空间 |

### Skills / 自定义能力

| 事项 | 说明 | 优先级 / 原因 |
|------|------|---------------|
| skills discovery | 发现可用技能文件或配置 | 中；涉及权限和加载范围 |
| skills prompt injection | 将 skill 使用规则作为独立 Instruction 注入 | 中；不应进入 Default System |
| subagent / custom agent prompt | 子代理或自定义 agent 的 prompt profile | 低；需要先有 mode/profile 机制 |
| custom prompt append / replace | 允许用户追加或替换 system fragment | 低；当前没有配置入口 |

### Tool / Response

| 事项 | 说明 | 优先级 / 原因 |
|------|------|---------------|
| tool response hint envelope | 工具失败时提供结构化 hint，而不只是原始错误文本 | 中；需要统一 tool output 契约 |
| tool output truncation metadata | 告诉模型输出是否被截断、如何继续查询 | 中；大输出场景需要 |
| response profiles | 不同模式下的最终回答格式，例如 review 只列问题 | 中；与 mode system fragment 联动 |

---

## 技术优化 Backlog

### Prompt 生命周期

| 事项 | 说明 | 优先级 / 原因 |
|------|------|---------------|
| `SystemFragment[]` | 将内部 section 暴露为片段数组 | 中；等 mode/cache 需要时再做 |
| Anthropic `cache_control` | 静态 system 段可 cache，动态段不 cache | 中；当前调用量和结构还不需要 |
| 多模型 prompt profile | 不同模型使用不同 profile 或 section | 低；当前只接 Anthropic |
| Prompt snapshot tests | 对核心 prompt 进行快照测试 | 中；实现阶段可先做基础单测 |

### UserTaskContext 扩展

| 事项 | 说明 | 优先级 / 原因 |
|------|------|---------------|
| `platform` / `os` | 运行平台信息 | 低；只读文件阶段收益有限 |
| `git_status` | 当前分支、dirty 状态等 | 中；进入写代码/PR 阶段后价值更高 |
| `repo_root` | 区分 cwd 和 repo root | 中；多目录场景需要 |
| `focused_files` | 用户或系统指定的重点文件 | 中；多轮协作和 IDE 集成需要 |
| `conversation_summary` | 多轮上下文摘要 | 中；与 compact 模式相关 |
| `task_mode` | 当前 mode，例如 default / plan / debug | 中；等 mode story 实现 |

---

## 开放性问题

| 问题 | 说明 |
|------|------|
| `systemPrompt` override 是否继续保留 | 当前 `AgentOptions` 支持传入自定义 system prompt。实现 S004 时需要决定这是测试/逃生口，还是未来配置 API 的雏形 |
| UserTaskContext 是否需要转义用户原文中的 XML-like tags | S004 可以先保真包裹，但如果未来机器解析这些 tags，可能需要更严格的 escaping 或 envelope |
| Runtime Context 是 core 全部收集，还是 host 显式传入 | 当前建议 core 补默认值，host 传自己才知道的上下文；具体 API 需要实现阶段细化 |
| Tool Policy 是否应该引用工具名常量 | 为避免工具重命名漂移，未来可从工具注册表读取工具名 |

---

## 被拒绝的方案

| 方案 | 拒绝原因 |
|------|----------|
| 继续把 prompt 放在 `packages/tui/src/cli.ts` | TUI 是交互外壳，不应该拥有 agent 行为规则；未来非 TUI host 会复制 prompt |
| Default System 直接包含 cwd/date | 动态事实会污染静态 system，不利于未来 prompt cache |
| System 中继续维护完整工具列表和参数说明 | 与 tool schema 双写，容易漂移 |
| S004 直接实现完整 message assembly 框架 | 范围过大，会把课程 Story 变成 Agent Runtime 大重构 |
| S004 直接实现 skills / modes / AGENTS.md | 这些能力各自有独立设计问题，不应提前塞进默认 System |
| 使用 Markdown section 包 UserTaskContext | 用户原文也可能含 Markdown 标题，机器注入上下文与用户内容边界不够强 |
| 使用 JSON/YAML 包用户原文 | 多行原文和代码块转义麻烦，教学阅读体验较差 |

---

## Deep Dive 话题池

- Prompt Structure 不是 System Prompt 排版：从 message assembly 看 agent harness 的边界
- Tool schema 与 system prompt 的职责分工：为什么工具描述不应该双写
- Runtime Context 放哪：System、developer message、UserTaskContext 的取舍
- Mode System Fragment/Profile：从 plan/debug/review 到 prompt profile 的演进路线
- Prompt cache 的前置条件：为什么静态/动态边界要先于 cache 实现
