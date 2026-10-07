# E03-S006 工程总览

[课程](../README.md) | [设计](./01-technical-design.md) | [任务](./02-task-list.md) | [验收](./03-verification-checklist.md) | [Backlog](./04-backlog.md)

目标是让受控文件编辑可查看、可回退，同时把成本绑定到涉及文件和保留历史，而非整个仓库。本版完整实现存储、Core 控制接口、TUI 与 plain/单次 CLI，制作图解、跟练和基准。

粒度为一次受控工具调用。默认捕获 write_file / replace_in_file / delete 的显式路径；任意命令、人工终端、外部系统不捕获。文件恢复、会话恢复和日志查询是三个独立协议。

实现不增加运行时依赖，使用 Node 文件接口、SHA-256、zlib 与现有终端栈。候选分支 codex/e03-s006-file-checkpoints；固定跟练 Tag E03-S006-file-checkpoints。交付、验证和审查状态统一放在验收页。
