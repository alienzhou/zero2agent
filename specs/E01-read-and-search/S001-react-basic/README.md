# E01-S001：让 Agent 跑起最小只读闭环

> 这是 Epic 1 的第一个 Story，也是 Zero2Agent 的第一个真正跟练入口。

---

## 这次我们要解决的问题和目标

### 问题

如果 Agent 还只是“一次性调用模型然后返回结果”，那它就没有真正进入 Agent 的工作方式。

我们需要先解决一个最基础的问题：

- Agent 怎么进入循环，而不是只回答一次
- Agent 怎么在循环里发起工具调用
- Agent 怎么在安全前提下读取文件和目录

### 目标

这一步做完后，我们希望得到一个最小但完整的只读闭环：

- 能接收用户问题
- 能运行 ReAct 循环
- 能调用 `read_file` 和 `list_directory`
- 能把工具结果再交回模型，直到拿到最终回答

### 边界

这一步故意只做到最小闭环，不继续往外扩：

- **做**：ReAct 循环、只读工具、基础 CLI 入口、过程日志
- **不做**：写文件、删除文件、终端执行、审批、安全权限控制
- **暂不展开**：grep / glob 搜索、复杂 Prompt 框架、会话管理

---

## 这次实现的关键点

### 实现轮廓

这次实现可以按四个关键点来理解：

1. **先把 Agent 跑成一个循环**
   - 入口在 `packages/core/src/loop.ts`
   - 核心是让模型响应不再是“一次结束”，而是根据 `stop_reason` 决定继续循环还是结束

2. **接上最小工具集合**
   - `packages/core/src/tools/read-file.ts`
   - `packages/core/src/tools/list-directory.ts`
   - 这两个工具先满足“看文件、看目录”两类最基本需求

3. **把循环和工具封装成更容易使用的入口**
   - `packages/core/src/agent.ts`
   - 它不是复杂抽象，而是一个方便调用的轻入口

4. **给学习者一个可以直接运行的 CLI**
   - `packages/tui/src/cli.ts`
   - 这里把基础 system prompt、交互模式和结果输出串起来

### 你可以怎么看这次实现

如果你想更有效地阅读这次实现，我建议按这个顺序看：

1. 先看 [00-overview.md](./00-overview.md)
   - 先建立这次 Story 的整体设计感

2. 再看 [01-technical-design.md](./01-technical-design.md)
   - 理解为什么这一版要先做只读闭环，以及循环、工具和消息如何串起来

3. 然后重点看这些代码文件：
   - `packages/core/src/loop.ts`
   - `packages/core/src/agent.ts`
   - `packages/core/src/tools/read-file.ts`
   - `packages/core/src/tools/list-directory.ts`
   - `packages/tui/src/cli.ts`

4. 最后回看 [CHANGELOG.md](../../../CHANGELOG.md)
   - 把这一步放回整个迭代演进里看

看代码时，重点留意三件事：

- 循环是如何根据 `stop_reason` 前进的
- 工具结果是如何回传给模型的
- CLI 是如何把“一个能跑的 Agent”暴露出来的

---

## 做完后的效果

完成这一步后，你应该能清楚感知到下面这些变化：

- Agent 不再只是“问一次答一次”，而是能多轮调用工具推进任务
- 遇到文件或目录问题时，Agent 可以主动使用只读工具
- 你能从日志里看清每一轮循环发生了什么

一个最直接的结果是：你已经有了一个最小可运行的 Coding Agent 雏形。

对应的当前资料入口包括：

- [总览](./00-overview.md)
- [技术设计](./01-technical-design.md)
- [任务清单](./02-task-list.md)
- [验收检查清单](./03-verification-checklist.md)
- [Backlog](./04-backlog.md)
- [迭代日志](../../../CHANGELOG.md#e01-s001-react-basic-done)
- Git tag：`E01-S001-react-basic`

---

## 扩展阅读

### 为什么第一步只做只读闭环

因为这一步最重要的不是“能力多”，而是“闭环清楚”。

先做只读工具，可以把风险和变量压到最低，让学习者把注意力放在：

- ReAct 循环是什么
- 工具调用怎么接进去
- 工具结果为什么还要继续回给模型

### 为什么把 `read_file` 和 `list_directory` 放在同一个 Story

因为它们一起才构成最小的查看闭环：

- 只会读文件，不知道有哪些文件，信息不完整
- 只会列目录，不能深入看内容，也不完整

把二者放在一起，更像一个真正能“看项目”的最小能力包。

### 为什么这里不急着讲更复杂的 Prompt 结构

因为在工具和循环都还没跑通前，过早讲 Prompt 工程会让学习者失去参照物。

更自然的节奏是：

- 先把循环和工具跑起来
- 再在后续 Story 里回头看 Prompt 应该如何组织

### 还有哪些现在没做、但很常见

当前这一步刻意没有加入：

- 文本搜索（grep）
- 文件集合搜索（glob）
- 写文件与删除文件
- 终端执行
- 审批与权限控制

这些都很重要，但它们属于后续 Story 和后续 Epic，而不是这个最小闭环本身。

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [00-overview](./00-overview.md) | 设计概述 |
| [01-technical-design](./01-technical-design.md) | 技术设计方案 |
| [02-task-list](./02-task-list.md) | 开发任务清单 |
| [03-verification-checklist](./03-verification-checklist.md) | 验收检查项 |
| [04-backlog](./04-backlog.md) | 后续优化方向 |
