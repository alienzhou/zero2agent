# E01-S004: Backlog

> 当前版本确定不做的事项，留待后续迭代。

---

## Backlog

### 功能

| 事项 | 说明 | 优先级 / 原因 |
|------|------|---------------|
| AGENTS.md 加载 | 搜索、解析项目级 AGENTS.md 文件 | 高 / 需要独立 Story 讨论作用域和优先级 |
| Instruction conflict resolver | 多级指令冲突时的优先级处理 | 中 / 依赖 AGENTS.md 加载 |
| Skills 加载 | 发现和加载 skills 配置 | 中 / 需要定义 skills 格式 |
| plan mode | 先讨论方案，不执行 | 中 / 需要定义 mode 切换机制 |
| debug mode | 先证据后修复 | 中 / 需要定义 mode 切换机制 |
| review mode | 优先找问题而不是总结 | 中 / 需要定义 mode 切换机制 |
| compact mode | 上下文压缩 | 低 / 当前上下文不大 |
| customPrompt 逃生口 | 允许用户完全替换 System Prompt | 低 / YAGNI，当前没有需求 |

### 技术优化

| 事项 | 说明 | 优先级 / 原因 |
|------|------|---------------|
| System message 返回 string[] | 支持分段 cache control | 中 / 当前功能简单，不需要 cache |
| prompt cache 实现 | 静态 section 缓存 | 中 / 依赖 string[] 支持 |
| tool response hint | 工具失败时的提示注入 | 低 / 当前工具错误处理已够用 |
| UserTaskContext 扩展字段 | platform、repoRoot、gitStatus 等 | 低 / 当前只需要 cwd 和 date |
| 多模型 prompt profile | 不同模型使用不同 prompt | 低 / 当前只用 Anthropic |

---

## 开放性问题

| 问题 | 说明 |
|------|------|
| Mode fragment 的加载方式 | 配置驱动、代码注册，还是文件模板？ |
| Mode fragment 与 Instruction 的优先级 | 当 mode 规则和 instruction 冲突时如何处理？ |
| Mode 是否允许完全 replace default system | 还是只能 append？ |
| UserTaskContext 是否需要结构化 task extraction | 从用户输入中提取 goal、constraints 等？ |
| Instruction 的作用域规则 | 按 cwd / 文件路径匹配？全局 vs 项目级？ |

---

## 被拒绝的方案

| 方案 | 拒绝原因 |
|------|----------|
| Prompt 存储为 .md 文件 | 比单函数更复杂，教学项目优先可读性 |
| 多段渲染函数（gemini-cli 风格） | 复杂度不值得，当前功能简单 |
| Runtime Context 放入 Default System | 会污染静态 section，不利于 cache |
| UserTaskContext 用 Markdown section | 用户原文可能包含 Markdown 标题，边界不够强 |
| UserTaskContext 用 JSON/YAML | 转义和多行文本麻烦 |
| 本 Story 实现 AGENTS.md 加载 | 会扩大范围，应有独立 Story |

---

## Deep Dive 话题池

- **Prompt 结构的演进路径** — 从 string 到 string[] 到 fragment registry，什么时候该升级？
- **多模型 prompt 差异处理** — 不同模型对 prompt 结构的偏好差异，如何抽象？
- **Instruction 优先级设计** — System > Project > User > Task 的具体实现策略
- **Mode 切换机制** — append vs replace vs switch，各自适用场景
