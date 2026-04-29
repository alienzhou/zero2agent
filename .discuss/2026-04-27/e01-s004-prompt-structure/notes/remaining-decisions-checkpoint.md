# Remaining Decisions Checkpoint

> 本笔记用于回答：进入 Spec 前还有什么需要讨论确定？目标是把讨论从发散转向收敛。

## 1. 已确认

| 决策 | 内容 | 是否阻塞 S004 |
|------|------|---------------|
| D06 | Instruction / AGENTS.md：S004 只定义优先级和位置，不实现加载 | 不阻塞 |
| D09 | Mode-specific 内容属于 System Prompt Fragment/Profile，但不进入 Default System；S004 只预留扩展点 | 不阻塞 |

## 2. 进入 Spec 前建议确认的阻塞项

### B01：Default System 的 section 顺序

建议确认：

```text
Role / Identity
→ Scope / Capability
→ Tool Policy
→ Workflow
→ Output Contract
```

问题：

- Runtime Context 是否明确不属于 Default System？
- 是否需要把 Safety 单独成段，还是并入 Scope / Capability？

### B02：Tool 描述策略

建议确认：

```text
Tool schema 写完整 description；
Default System 只写 Tool Policy（如何组合工具），不逐个重复工具说明。
```

问题：

- 为了教学清晰度，是否需要在 System 中只列工具名？
- 还是完全不列，由 tool schema 与课程文档解释？

### B03：Runtime Context 的位置

建议确认：

```text
Runtime Context 放入 User Task Context，不放 Default System。
```

理由：

- cwd / date / platform / git 等是每轮动态事实。
- 放 User Task 更贴近当前任务，也避免污染静态 Default System。
- 未来若支持 `string[] system` 或 developer channel，再考虑独立 dynamic system/env 段。

### B04：User Task 的定义

建议确认：

```text
S004 阶段 User Task = User Message；
不做独立 task extraction。
```

后续：

- plan/debug/review 等模式出现后，再从 User Message 派生结构化 Task。

### B05：Prompt 存储形态与代码归属

建议确认：

```text
packages/core 拥有 buildSystemPrompt()；
packages/tui 不再拥有 prompt 文案，只传入 User Task / Runtime Context。
先用 TypeScript builder，不引入模板文件。
```

理由：

- core 才是 agent 行为归属。
- TUI 是交互外壳，不应拥有 agent 的系统规则。
- TS builder 比 `.md` 模板更适合当前课程阶段，可测试、可组合。

### B06：System message 类型

建议确认：

```text
S004 实现仍可返回 string；
设计上预留 string[] / SystemFragment[]。
```

理由：

- 当前功能不需要立刻改完整 host message 抽象。
- 但竞品中 OpenCode / Claude Code 都说明多段 system 是合理方向。

## 3. 不阻塞 S004，但应进入 backlog

| 事项 | 所属层级 | 备注 |
|------|----------|------|
| 多模型 prompt profile | Prompt lifecycle | 后续引入多模型时做 |
| plan / debug / review / compact / promotion | Mode System Fragment/Profile | D09 已预留 |
| AGENTS.md / Instruction loader | Instruction | D06 已预留 |
| skills discovery / loading / permission | Instruction / Skills layer | 不进入 Default System |
| custom prompt replace / append | Customization | 后续配置能力 |
| tool response hint envelope | Tool | 需要独立输出契约 |
| prompt cache / static-dynamic section control | Prompt lifecycle | 后续优化 |

## 4. 建议的下一步

如果用户同意以上 B01-B06，可以把它们沉淀为一组决策文档：

- D10：Default System section order
- D11：Tool description strategy
- D12：Runtime Context belongs to User Task
- D13：User Task equals User Message in S004
- D14：Prompt builder ownership in core
- D15：System stays string for S004 but reserves fragments

完成这些决策后，就可以进入 Spec 编写阶段。
