# E04-S001 总览

[课程](../README.md) | [设计](./01-technical-design.md) | [任务](./02-task-list.md) | [验收](./03-verification-checklist.md) | [Backlog](./04-backlog.md)

把请求失败、工具修正与运行停止统一到一次 Turn。增加可配置 RunLimits、共享 RunBudget 和请求执行器；保留原有 Session/ContextManager、权限、取消和文件保护契约。每次调用的副作用以真实工具结果为准。
