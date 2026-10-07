# 会话保存与恢复研究

2026-10-07，以固定源码核对两种生产产品的存储与恢复组织方式：[Codex](codex.md)、[Gemini CLI](gemini-cli.md)。本课未运行竞品模型任务。

| 问题 | 观察 | 本课采用 |
|---|---|---|
| 找回哪次对话 | 稳定会话身份与浏览/筛选入口 | UUID、工作区隔离、TUI 列表 |
| 写入何时可读 | JSONL recorder / 原子重写 | 已结算全量快照、独占 revision 发布 |
| 谁来管理运行 | 数据存储与运行宿主分离 | Core snapshot → Store → Conversations → TUI/plain |

结论用于设计取舍，不等于对竞品所有行为的验证。课程见 [E03-S004](../../specs/E03-product-foundations/S004-session-persistence/README.md)。
