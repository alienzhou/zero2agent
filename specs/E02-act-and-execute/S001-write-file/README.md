# E02-S001：让 Agent Harness 能直接改动工作区（write_file + delete）

> 这是 Epic 2 的第一个 Story，也是整个 Agent Harness 跨过「只读」边界的第一步。目标是给 Agent 装上第一批**写工具**——`write_file` 和 `delete`，让它从「只会看」变成「能动手改」。

[Epic 2：能动 / 能改 / 能执行](../README.md) | [首页](../../../README.md) | [Roadmap](../../../docs/roadmap/README.md)

---

## Epic 1 结束时，Agent 还碰不了任何文件

Epic 1 给了 Agent 四件只读工具：`read_file`、`list_directory`、`grep_search`、`find_files`。它能看、能查、能定位，但**改不了工作区里的任何东西**。

```text
用户：帮我在 src/ 下新建一个 config.ts，写入默认配置。
```

面对这个再普通不过的请求，Epic 1 的 Agent 只能干瞪眼——它读得懂现有代码，却没有任何一个工具能把内容**落盘**。这正是「只读 Agent」和「Coding Agent」之间那条最关键的线。

Epic 2 要跨过这条线。而跨线的第一步，就是最基础的两个动作：**写文件**和**删文件**。

---

## 这个 Story 要做什么

### 问题

Agent Harness 缺少「改动工作区」的能力：

1. 无法创建 / 写入文件——所有生成的内容都停留在对话里，落不了地
2. 无法删除文件——清理临时产物、删除废弃文件都做不到

### 目标

完成后，Agent Harness 多出两个**独立的写工具**：

- **`write_file`**：全量写入一个文件（不存在则创建、存在则覆盖，自动创建父目录）
- **`delete`**：删除一个或多个文件（支持数组、不递归删目录）

并且这两个工具都守住一条**物理安全底线**：只能在工作区（`ctx.cwd`）内动手，越界一律硬拒绝。

### 边界

- **做**：`write_file` 全量写入、`delete` 批量删文件、cwd 边界硬校验、区分新建/覆盖的回执
- **不做**：
  - **破坏性确认 / 权限体系**——覆盖、删除都不弹确认，留到**后续专门一章**完整实现（见 [D04](../../../.discuss/2026-07-20/e02-s001-write-file/decisions/D04-destructive-confirmation.md)）
  - **局部修改 / append**——留给 S002 `replace_in_file`
  - **递归删目录**——破坏性过强，等 Epic 3 有 Checkpoint 机制再放开
  - **软链接解析、危险路径黑名单**——记 backlog

---

## 一个反常识的发现：竞品都没有独立的 delete 工具

进 Spec 前我们照惯例做了[竞品调研](../../../researches/write-file/README.md)（opencode / codex / pi-mono / gemini-cli / aider 五家），得到一条反常识的结论：

> **没有任何一家做「独立的 delete 工具」。** OpenCode / pi-mono / Gemini 把删除交给 shell `rm`；Codex 做成 `apply_patch` 补丁里的 `*** Delete File:` hunk；Aider 靠 git 管理文件生命周期。

那 zero2agent 为什么偏要做一个独立 `delete`？这是**有意的教学向选择**：

| 理由 | 说明 |
|------|------|
| 教学直观 | 「一个工具 = 一种清晰意图」，独立 `delete` 比把删除藏进 shell 或补丁语法更好理解 |
| 工具层可控 | 独立工具能在工具层做路径校验（cwd 边界）和结构化回执；交给 shell `rm` 则这些保护全依赖 shell 权限层 |
| 依赖解耦 | Epic 2 此刻还没有 terminal 能力，用 shell 删文件等于提前引入未实现的依赖 |

而 `write_file` 的形态则**高度收敛**——去掉各家工程复杂度后，最小写工具就是 `{path, content}` + 自动建父目录 + 不存在建/存在覆盖。**pi-mono 几乎就是这个裸形态**，是我们的直接蓝本。

---

## 关键设计

七个决策点（D01–D07）已在[讨论阶段](../../../.discuss/2026-07-20/e02-s001-write-file/outline.md)全部收敛，这里讲三个最关键的。

### 1. write_file 与 delete 是两个独立工具（D01 / D02）

`write_file` 只做一件事：把 `content` 作为文件的**完整内容**写入。

```
write_file({ path: string, content: string }) => string
```

- 不存在则创建，存在则覆盖；自动创建缺失的父目录（等价 `mkdir -p`）。
- **不做 append、不做 mode 开关**——局部追加/修改是另一种能力，留给 S002。
- 「新建」还是「覆盖」不靠参数区分，而是靠**回执**告诉模型（见下）。

单一职责让工具语义清晰、模型不易用错，这是本课程一贯的工具设计哲学。

### 2. 物理边界：硬拒绝 cwd 之外的写/删（D03）

写和删都是有副作用的操作，必须先立住一条底线：

> **无论模型意图如何，都不允许它把手伸出工作区。**

实现上，解析出绝对路径后判断它是否落在 `ctx.cwd` 目录树内，越界（含 `..` 逃逸、绝对路径逃逸）一律返回 `Error:`，不写、不删。

这里刻意选**硬拒绝**而非 OpenCode 那种「升级询问」——教学项目要的是简单、明确、可预测的一行边界判断。升级询问依赖 permission 框架，而本 Story 明确不引入 approval。

> ⚠️ 这是**物理边界**（能不能碰），不是**意图边界**（该不该碰）。意图层面的「这个删除操作要不要让用户确认」属于破坏性确认，是后续专章的事。

### 3. delete 支持批量，部分失败「尽力删 + 逐条汇总」（D05 / D06）

批量删临时文件是真实高频场景，所以 `delete` 接收一个**路径数组**：

```
delete({ paths: string[] }) => string
```

但数组会带来一个绕不开的问题——**部分失败**。比如 `delete(["a.txt", "b.txt", "c.txt"])`，其中 `b.txt` 不存在，该怎么办？我们对比了三种方案：

| 方案 | 行为 | 问题 |
|------|------|------|
| A. 全成功才算成功 | 遇错即停，已删的不回滚 | 语义模糊（a 删了 b 没删），状态不清 |
| **B. 尽力删 + 逐条汇总** ✅ | 每个都试，最后汇总结果 | —— |
| C. 先全校验才删 | 任一越界/不存在就整体拒绝 | 更安全但牺牲批量便利 |

选 **B**：对每个路径都尝试删除（都先过 cwd 边界校验），不因某个失败而中断，最后逐条汇总：

```text
已删除：a.txt, c.txt；失败：b.txt（文件不存在）
```

这对 Agent 最友好——它能从回执明确知道哪些成了、哪些没成，自主决定要不要重试；也让读者直面「批量操作要处理部分失败」这个真实工程问题。

### 回执契约（D06）

沿用现有工具的 `Promise<string>` 回执，不引入结构化返回：

- **write_file 区分新建/覆盖**（零成本、对模型有用）：
  - 新建：`已创建文件 <path>（写入 N 字节）`
  - 覆盖：`已覆盖文件 <path>（写入 N 字节）`
- **delete 逐条汇总**（见上）
- **错误**沿用 `Error: ...` 前缀，文本区分常见错因（`文件不存在` / `是目录` / `超出工作区`），不上错误类型枚举

### 不动 ToolContext（D07）

S001 **不扩展 `ToolContext`**，维持只有 `cwd`。唯一会驱使我们扩展 `ctx` 的需求是 approval 回调——既然 approval 留到后续专章，`ctx` 就没有扩展的理由。接口稳定性优先，不为单个 Story 的便利污染公共契约。

---

## 做完后的效果

完成这一步后，你应该能观察到：

- Agent 遇到「新建 config.ts 并写入内容」时，会调用 `write_file` 把内容真正落盘
- Agent 遇到「删掉这几个临时文件」时，会用 `delete` 一次批量删除，并从回执得知每个文件的结果
- 试图写/删工作区之外的路径时，工具直接返回 `Error: 超出工作区`，守住安全底线

能力变化不是「多了两个命令」，而是：

> Agent 从一个**只读观察者**，第一次变成了能**改变世界状态**的行动者。这也是 Epic 2「行动力」主轴的起点。

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

## 延伸阅读

理解了这一版 `write_file` 和 `delete` 的主线实现后，下面这篇文章值得继续读：

| 文档 | 说明 |
|------|------|
| [工具接口就是 Agent 的行动语言](./deep-dive/01-agent-computer-interface.md) | 工具的粒度、参数格式、能力边界和回执，分别决定了模型能表达什么、Harness 能约束什么、模型能观测到什么 |

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [讨论记录](../../../.discuss/2026-07-20/e02-s001-write-file/outline.md) | 需求讨论与决策（D01–D07） |
| [竞品调研](../../../researches/write-file/README.md) | opencode / codex / pi-mono / gemini-cli / aider 五家写删文件实现 |
| [Epic 2 总览](../README.md) | 本 Story 所属 Epic |

---

下一篇：[E02-S002：让 Agent Harness 能高效修改已有内容](../S002-replace-in-file/README.md)（Planned）
