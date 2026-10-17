# 从文件约定到执行前检查

本节的直接结果是：给定目标路径，可以解释规则来自哪几个文件、适用于哪里、模型见过哪个内容版本，以及为什么某批工具还不能执行。整体范围见 [E05 计划](../../course-plan.md)，操作步骤见 [跟练](../follow-along.md)。

| 入口 | 职责 |
| --- | --- |
| packages/core/src/project-instructions.ts | 有界祖先链、权限读取、正文版本、作用域与请求覆盖层 |
| packages/core/src/agent.ts | 易失规则状态、查看/刷新/开关、恢复和压缩入口 |
| packages/core/src/loop.ts | 请求计入预算、整批预检、配对未执行结果、执行前重验 |
| packages/core/src/tools/types.ts | 可信路径字段；terminal 的 instructionDirectories 只声明 workdir |
| packages/tui/src/instruction-view.ts | 区分最近读取与上次真实模型请求的元信息 |
| packages/tui/src/cli.ts、runtime-tui.ts、conversations.ts | 单次、管道、plain、TUI 共用控制入口 |

项目文本只作为有来源的用户级上下文。模型理解自然语言；Harness 验证来源、路径、版本、权限及顺序。读者应分别观察模型遵循约定和宿主阻止越界这两层证据。
