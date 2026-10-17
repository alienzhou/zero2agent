# 事实来源

| 标识 | 来源与核对范围 |
| --- | --- |
| O01 | [agents.md 官方站点](https://agents.md/)，2026-10-17 核对；[固定源码](https://github.com/agentsmd/agents.md/tree/d001185d792eb6402a58e4cbef1c228b309ec25d)。普通 Markdown、无必填字段、嵌套就近优先、明确用户覆盖。 |
| S01 | packages/core/src/project-instructions.ts：发现、读取、权限、容量、作用域、哈希、请求覆盖层。 |
| S02 | packages/core/src/loop.ts、agent.ts：批次预检、结果配对、预算、实际执行前重验、恢复与压缩。 |
| S03 | packages/tui/src/cli.ts、conversations.ts、runtime-tui.ts、instruction-view.ts：入口、最近读取与实际请求版本。 |
| T01 | packages/core/src/__tests__/project-instructions.test.ts；tools/__tests__/find-files.test.ts。 |
| T02 | e2e/src/project-instructions.test.ts：真实 HTTP/SDK、CLI、管道、plain、PTY 及取消清理。 |
| T03 | researches/project-instructions/cases.mjs、demo.mjs、verification.json：固定输入、模型与离线分层验证；原始附件外部归档。 |
| D01 | specs/E05-extensibility/S001-project-instructions/details/01-technical-design.md；follow-along.md。 |

格式事实来自官方来源；搜索边界、数值容量、取消、权限和 UI 明确属于 Zero2Agent 的实现。没有把两个模型样例描述为通用遵从率。截图不是课程中的假造终端回执。
