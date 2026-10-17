# 本课交付什么

主线是目录摘要、激活正文、参考文件三层读取。用户可明确选择技能，模型也可通过受控工具选择；当前来源、内容版本、失败与停用状态可见。沿用既有上下文预算、权限、文件工具、会话与恢复机制。

代码入口：Core 的 `skill-format.ts`、`skills.ts` 和技能工具适配；Agent/loop 的请求覆盖层和执行前检查；CLI/Conversations/TUI 的检查与控制。案例、可复现脚本和精简结果放在 `researches/skills/`，原始附件留在 Git 外。

各项范围与验收来自 [E05 既定计划](../../course-plan.md)，本课不改变 MCP/Hooks 的后续边界。
