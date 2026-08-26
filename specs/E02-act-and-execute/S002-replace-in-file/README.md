# E02-S002：让 Agent Harness 能高效修改已有内容（replace_in_file）

> 这是 Epic 2 的第二个 Story。S001 给了 Agent「整篇重写」的能力，但真实编码里 90% 是改几行，不是重写整个文件——这一步引入 `replace_in_file`，让它能对已有文件做外科手术式的局部替换。

[Epic 2：能动 / 能改 / 能执行](../README.md) | [首页](../../../README.md) | [Roadmap](../../../docs/roadmap/README.md) | [上一篇：E02-S001](../S001-write-file/README.md)

---

## 只会「整篇重写」是远远不够的

E02-S001 之后，Agent 有了 `write_file`——但它只能**全量写入**：把 `content` 当作文件的完整内容，整篇覆盖。

面对「把 `config.ts` 里第 12 行的超时从 30 改成 60」这种请求，`write_file` 会怎么做？

1. 先用 `read_file` 把整个文件读进来
2. 在脑子里（上下文里）改掉那一行
3. 再用 `write_file` 把**整个文件**重新写回去

这一套在真实编码里处处是坑：

- **Token 昂贵**：改 1 行要重读 + 重写整个文件，文件越大浪费越多
- **容易覆盖无关内容**：模型凭记忆复述整个文件，稍有不慎就把没动过的地方也改错、写丢
- **丢失格式**：缩进、换行、尾随空白都可能被模型「重新格式化」，引入噪音 diff

> 真实世界里，程序员改代码从来不是「删掉整个文件重打一遍」，而是**定位到要改的那几行，只动那一处**。Agent 缺的就是这个「局部替换」的动作。

`replace_in_file` 补上的正是它。

---

## 这个 Story 要做什么

### 问题

Agent 只有「全量写」没有「局部改」，导致任何小改动都要整篇重写，token 昂贵、易出错、易污染格式。

### 目标

完成后，Agent Harness 多出一个**局部修改工具**：

- **`replace_in_file`**：在文件里精确匹配一段原文（`old_string`），替换成新内容（`new_string`）。默认要求这段原文**唯一出现**，可选 `replace_all` 替换全部。

并且它延续 S001 的物理安全底线：只能改工作区（`ctx.cwd`）内的文件，越界硬拒绝。

### 边界

- **做**：`old_string` 精确匹配 + 唯一性约束、`new_string` 局部替换、`replace_all` 全量替换开关、cwd 边界硬校验、回执报告替换处数
- **不做**：
  - **统一补丁范式**（Codex `apply_patch` / Aider `editblock`）——需模型严格遵循补丁语法，教学上手重（见 [D01](../../../.discuss/2026-08-15/e02-s002-replace-in-file/decisions/D01-tool-paradigm.md)）
  - **instruction 语义编辑**（Gemini 式「把循环改成递归」）——二次 LLM + 复杂校验，太重，记 backlog
  - **纯插入**（空 `old_string`）——语义模糊易误用；插入用「匹配唯一锚点 + 写回锚点」覆盖
  - **破坏性确认 / 权限体系**——同 S001，留后续专章
  - **多文件 / 多段替换**——违背单一职责，多处替换让模型多次调用

---

## 关键设计

七个决策点（D01–D07）已在[讨论阶段](../../../.discuss/2026-08-15/e02-s002-replace-in-file/outline.md)全部收敛，这里讲三个最关键的。

### 1. 唯一性约束：replace_in_file 的灵魂（D02）

`old_string` 必须在文件里**唯一出现**：

| 匹配结果 | 行为 |
|----------|------|
| 0 次 | `Error: Match not found: <path>` |
| 1 次 | 替换该处，返回成功回执 |
| ≥ 2 次 | `Error: Match not unique: <path>`，**不自动选第一个** |

这看似是个限制，其实是**防止改错位置的关键机制**：唯一性倒逼模型带上足够上下文（函数签名、注释、相邻行）来定位目标。模型写 `old_string: "return result"` 会匹配到一堆地方而报错，于是它会补成 `old_string: "function loadConfig() {\n  ...\n  return result"`——上下文越精确，改错位置的概率越低。

竞品里 OpenCode / pi-mono / Gemini 的 `edit` 都这么干，这是行业共识（[竞品调研](../../../researches/replace-in-file/README.md)）。

### 2. replace_all：默认关掉的「全量替换」开关（D03）

真实场景里有「把 `foo` 重命名为 `bar`」这种**本该一次完成**的需求。没有 `replace_all`，模型要反复调 N 次 `replace_in_file`。

所以 S002 加一个可选参数 `replace_all`（默认 `false`）：

- 默认关：维持唯一性约束这个安全默认
- 显式开：替换文件里**所有**匹配处，回执报告实际替换了几处

这是对「唯一性」约束的一个**低成本、高价值的逃逸口**——把「我知道会改多处」这件事显式化，而不是让模型静默猜。五家竞品都没有这个开关，算 S002 的一个有意小偏离。

### 3. 沿用物理底线，并吸取 S001 的 doc/code 漂移教训（D04 / D06）

`replace_in_file` 复用 S001 的 `resolveInsideCwd`（`path-guard.ts`），越界硬拒绝。更重要的是，**回执统一用英文**，与既有 6 个工具的实际实现一致：

```text
Replaced src/config.ts (1 occurrence)
Error: Match not unique: src/config.ts (3 occurrences, add more context to disambiguate)
```

S001 的复盘记过一条教训：spec 写中文回执、代码落英文，doc/code 漂移。这次在决策阶段就**明确英文回执**，spec 与代码不再两套并存（见 [D06](../../../.discuss/2026-08-15/e02-s002-replace-in-file/decisions/D06-return-contract.md)）。

---

## 做完后的效果

完成这一步后，你应该能观察到：

- Agent 遇到「改某一行」时，会用 `replace_in_file` 只动那一处，而不是整篇重写
- `old_string` 写得太宽泛（匹配到多处）时，工具返回 `Match not unique`，模型被逼着补上下文
- 「把变量名全部重命名」这类需求，`replace_all: true` 一次完成并报告改了几处
- 试图改工作区之外的路径时，工具直接返回 `Error: ... outside the workspace`，守住安全底线

能力变化不是「多了一个替换命令」，而是：

> Agent 从「只能整篇重写」进化为「能精确地只改一处」，这是「高效修改」的关键一步，也是后续 `terminal` 等更重能力的铺垫。

---

## 技术实现细节

| 文档 | 说明 |
|------|------|
| [details/00-overview](./details/00-overview.md) | 设计概述 |
| [details/01-technical-design](./details/01-technical-design.md) | 技术设计方案 |
| [details/02-task-list](./details/02-task-list.md) | 开发任务清单 |
| [details/03-verification-checklist](./details/03-verification-checklist.md) | 验收检查项 |
| [details/04-backlog](./details/04-backlog.md) | 后续优化方向 |

---

## 扩展阅读

理解主线后，下面这些问题值得继续想（对应 [04-backlog](./details/04-backlog.md) 的话题池）：

- **为什么字符串替换赢了补丁？** Codex 的 `apply_patch` 和 Aider 的 `editblock` 为什么不是教学主线的好选择
- **唯一性约束 vs 模糊匹配**：Gemini 的 instruction 编辑走向「语义定位」，和「确定性字符串匹配」各有什么取舍
- **「先读后写」约束**：OpenCode 强制改已存在文件前必须先 Read，S002 为什么没做

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [讨论记录](../../../.discuss/2026-08-15/e02-s002-replace-in-file/outline.md) | 需求讨论与决策（D01–D07） |
| [竞品调研](../../../researches/replace-in-file/README.md) | opencode / codex / pi-mono / gemini-cli / aider 五家局部修改机制 |
| [Epic 2 总览](../README.md) | 本 Story 所属 Epic |

---

下一篇：E02-S003：让 Agent Harness 能驱动执行环境（📝 Planned，尚未开始）
