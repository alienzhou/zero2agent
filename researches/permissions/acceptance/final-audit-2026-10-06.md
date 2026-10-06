# E03-S002 Agent Harness 最终核验

2026-10-06。用户要求：“最后再校验确认，我们的 agent harness 是不是这一课完成了”。核验对象为 PR #17 当前候选 `bdda034`，对照 S002 原始概述、技术设计、任务和验收清单。

**结论：本课 Agent Harness 功能及当前 macOS 验收已完成，没有发现本课范围内尚未实现的功能项。源码仍待人工审阅与合入 main；这两个状态不能混为一谈。**

| 要求 | 当前实现与核验依据 | 结果 |
|---|---|---|
| 所有模型工具统一授权 | Loop 唯一模型 execute 入口先 authorize；非 tool_use 停止原因的调用不执行且配对错误结果。CLI 两处直接调用对应用户主动人工终端 | 通过 |
| 三态、模式、显式规则 | Controller、8 个内建工具元信息、deny/ask/allow 优先级、精确参数匹配与默认未知工具询问 | 通过 |
| 一次 Approval 生命周期 | 独立 ID、参数/整批快照、超时/取消/非法响应/无宿主拒绝、清理挂起项与 timer；54 项权限单元重新通过 | 通过 |
| 文件边界 | 已有祖先 realpath、软链接/根/外部写、审批后重查、只读外部读拒绝；写/替换/删除工具保留直接守卫 | 通过 |
| 回执与多轮连续性 | 拒绝仍保留调用 ID 和 is_error；展示观察者不承担授权；已有多轮、压缩、人工终端的实测与回归记录齐备 | 通过 |
| CLI/SDK 可用 | Agent 传递实例 Controller，权限类型公开导出；TTY y/N、管道拒绝、EOF/Ctrl+C/超时；20 项 CLI 契约重新通过 | 通过 |
| 实际行为 | 当前构建离线示例再次证明拒绝无文件、批准落盘；50 项真实模型记录及 124 次 HTTP 200 可解压核对 | 通过 |
| 版本与证据对应 | HEAD 的 packages/scripts 与 `73ecdbc` 相同，e2e 与 `8e47cae` 相同；原始全量报告与 3 项补跑独立合并核对，共 137 E2E 全部通过 | 通过 |
| 课程与固定入口 | 五篇 Spec、正文、跟练、研究/复盘/导航、16 页图文、图片/源 ZIP 存在；主图/审阅/包哈希对应；补验 Tag 已推送 | 通过 |

本次重新构建并运行：[构建](./final-audit-build.txt)、[文件效果](./final-audit-smoke.txt)、[54 项权限单元](./final-audit-permissions.txt)、[20 项 CLI 契约](./final-audit-cli.txt)。此前 463 项离线与 50 项真实模型的完整原始证据，经 [runtime-audit](./runtime-audit/README.md)再次校验，包括报告中每项状态、修复后补跑、记录压缩包 SHA-256 与当前源码对应关系。

本次阅读了权限控制器、Loop 各停止分支、Agent、CLI Approval、内建工具路径元信息/递归行为、写工具守卫及 SDK 导出。没有新增生产代码，也没有将展示界面、持久会话或操作系统沙箱当成本课已实现能力。

## 交付状态

- 工程：[PR #17](https://github.com/alienzhou/zero2agent/pull/17)，Open / Draft / mergeable，尚无人工审阅记录，尚未合入 main；GitHub 无 CI 检查项，不能宣称云端 CI 已通过。
- 固定版本：`E03-S002-permissions-approval-verified` 指向 `bdda034`，可构建与跟练。
- 本机工作区干净；原工作目录的既有未提交改动保留。
- 当前验证覆盖 macOS 与配置的 MiniMax-M2.7。跨平台、竞品实机、SDK 宿主故障的验证范围沿用 runtime-audit 中的明确限制。
- 下一课 S003 的运行状态与 TUI 仍为后续工作；会话落盘、结构化日志、文件 Checkpoint 及系统沙箱不属于本课完成条件。
