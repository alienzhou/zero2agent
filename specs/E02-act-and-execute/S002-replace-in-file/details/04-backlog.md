# E02-S002: Backlog

> 当前版本确定不做的事项，留待后续迭代。

---

## 功能 Backlog

### 破坏性操作确认（最高优先，独立成章）

| 功能 | 说明 | 竞品参考 | 归属 |
|------|------|---------|------|
| 事前确认 | 替换前弹确认，人工批准 | OpenCode `ctx.ask`、Gemini `ApprovalMode` | **后续专章** |
| 批准模式 | auto / ask / deny 等粒度 | Gemini ApprovalMode | 后续专章 |
| diff 呈现 | 确认时展示替换 diff | OpenCode、Gemini | 后续专章 |
| 事后回滚 | 每次替换自动 Checkpoint，可撤销 | Aider（git 自动 commit + revert） | **Epic 3** |

### replace_in_file 扩展

| 功能 | 说明 | 竞品参考 | 优先级 |
|------|------|---------|--------|
| 「先读后写」约束 | 改已存在文件前必须先 Read，否则失败 | OpenCode（硬约束）| 中（需状态跟踪）|
| 多段替换 | 一次调用传入多个 old/new 对 | Aider editblock / Cursor | 中 |
| 模糊匹配 | 近似匹配（容忍空白/缩进差异） | Codex apply_patch | 低（确定性优先）|
| instruction 语义编辑 | 「把循环改成递归」由模型定位改哪里 | Gemini `instruction` | 低（二次 LLM，太重）|
| 换行符适配 | 替换时沿用原文件 CRLF/LF 风格 | Gemini | 低 |
| 省略占位检测 | 检测 `... rest of code ...` 等偷懒占位 | Gemini `detectOmissionPlaceholders` | 中 |

---

## 技术优化 Backlog

### 安全性

| 优化项 | 说明 | 竞品参考 |
|--------|------|---------|
| 软链接真实路径解析 | 防 cwd 内软链指向外部造成逃逸 | Gemini `resolveToRealPath` |
| 危险路径黑名单 | 禁止改 `.git/`、系统目录等 | —— |
| 文件级串行锁 | 同一文件并发改不交错 | pi-mono `file-mutation-queue` |

### 回执增强

| 优化项 | 说明 | 竞品参考 |
|--------|------|---------|
| 附 diff | 回执带替换前后的 diff 摘要 | Gemini |
| 附 LSP 诊断 | 改后拼接语法/类型错误 | OpenCode |
| 结构化返回 | 从 string 升级为结构化结果类型 | —— |

### 架构演进

| 优化项 | 说明 | 竞品参考 |
|---------|------|---------|
| 可插拔文件操作 | 把 fs 操作抽象为接口，支持远程/SSH | pi-mono `WriteOperations` |
| 统一补丁范式 | 一次调用批量「建/删/改」多文件 | Codex `apply_patch` |

---

## 被拒绝的方案

| 方案 | 拒绝原因 |
|------|----------|
| 统一补丁（apply_patch / editblock）| 需模型严格遵循补丁语法，教学上手重 |
| instruction 语义编辑（Gemini 式）| 二次 LLM + 复杂校验，超出教学主线 |
| 自动选第一个匹配 | 违背唯一性约束，容易改错位置 |
| 纯插入（空 old_string）| 语义模糊易误用，用锚点替换覆盖 |
| 多文件 / 多段替换（一次调用）| 违背单一职责，多处替换让模型多次调用 |
| 模糊 / 近似匹配 | 确定性优先，宁可报错让模型补上下文 |
| 回执附 LSP 诊断 / diff | 太重，S002 用简版回执 |
| 结构化返回类型 | 沿用 string 契约，不上枚举 |
| S002 就扩展 ToolContext | 无 approval 需求就无扩展理由 |

---

## Deep Dive 话题池

- **字符串替换 vs 补丁范式**：为什么「确定性字符串匹配」是局部改的主流，补丁/块语法适合什么场景
- **唯一性约束 vs 模糊匹配**：两种定位哲学的取舍——「逼模型带上下文」vs「容忍漂移」
- **「先读后写」约束的价值与成本**：OpenCode 为什么强制，zero2agent 为什么暂缓
- **replace_all 的语义风险**：全量替换何时会「好心办坏事」，如何通过回执让模型察觉
- **局部修改的安全纵深**：物理边界（cwd）→ 意图边界（确认）→ 可回滚（Checkpoint）三层如何演进
