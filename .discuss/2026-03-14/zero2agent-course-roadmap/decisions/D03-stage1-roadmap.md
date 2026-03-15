# D03：Epic 1 规划

## 状态
✅ Confirmed

## 阶段目标

Epic 1 的终点是：

> 做出一个只读、安全、可解释的最小 Coding Agent。

它需要让学习者建立“Agent 会看、会查，并通过 ReAct 循环调用工具”的直觉。

## Story 顺序

1. **让 Agent 跑起最小只读闭环**
   - ReAct 循环
   - `read_file`
   - `list_files / list_directory`

2. **让 Agent 能在内容里定位信息**
   - `grep search`

3. **让 Agent 能在文件集合里定位目标**
   - `glob search`

4. **回看 ReAct 模式并固定 Prompt 结构**
   - System Prompt 的工程结构
   - 工具描述如何组织
   - User Message 如何进入 Prompt 框架

## 关键判断

- Prompt 结构是一个正式 Story，不是附带总结。
- 但它的出场时机放在 read / list / grep / glob 都跑通之后。
- 当前仓库的实现、提交历史和正式 Tag `E01-S001-react-basic`，也更贴近这种“最小只读闭环 + read/list 合并”的组织方式。

## 理由

1. Epic 1 的主线应该先建立“能看 / 能查”的直觉。
2. ReAct 与基础只读工具天然耦合，合并后更适合作为课程开场。
3. 等工具都跑起来后再回看 Prompt，学习者更容易理解其工程意义。
