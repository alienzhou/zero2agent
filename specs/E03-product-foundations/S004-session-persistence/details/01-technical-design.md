# 会话保存设计

设计决策见 [D01](../../../../.discuss/2026-10-07/e03-s004-session-persistence/decisions/D01-persistence-boundaries.md)。

Core 导出和恢复 SessionSnapshot；ContextManager 只导出已采用摘要。SessionStore 负责磁盘协议与结构校验；ConversationController 负责执行前后保存和会话身份。TUI 与 plain 共用控制器，Core 不依赖屏幕。

关键约束：先完整校验再恢复；工具调用结果完整配对；摘要切点不能切断配对；采用当前 cwd/model/system prompt/权限；pending 不自动重放。恢复时还原界面投影，绝不重发 runtime 事件触发执行。
