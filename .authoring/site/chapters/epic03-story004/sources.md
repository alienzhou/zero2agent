# 来源映射

来源截至 2026-10-07。S/T/D 引用本课固定 Tag `E03-S004-session-persistence` 对应仓库代码；R 引用研究报告中的外部固定 Commit。教学图为原创 SVG 重排，不冒充逐像素截图。

| ID | 来源 | 用于说明 |
|---|---|---|
| S01 | packages/core/src/session-snapshot.ts、session.ts | 原始消息、校验与配对 |
| S02 | packages/core/src/context-manager.ts | 已采用摘要与 through；临时作业排除 |
| S03 | packages/tui/src/session-store.ts | 工作区隔离、版本化快照、独占发布 |
| S04 | packages/tui/src/conversations.ts | pending、结算保存、崩溃提醒与当前策略 |
| S05 | packages/tui/src/runtime-tui.ts、runtime-state.ts、cli.ts | 列表焦点、历史投影、CLI 入口 |
| T01 | packages/core/src/__tests__/session-snapshot.test.ts、e2e/src/session-store.test.ts | 校验、并发、失败、取消与存活 PID |
| T02 | e2e/src/session-persistence.test.ts、runtime-tui.test.ts | SDK 请求、双进程、真实 PTY 与旧交互 |
| T03 | e2e/src/session-live.test.ts | 真实服务跨进程回忆 |
| D01 | scripts/e03-s004-session-demo.mjs | 本地 HTTP/SSE 夹具跟练 |
| R01 | researches/session-persistence/codex.md | Codex recorder 与 cwd 过滤 |
| R02 | researches/session-persistence/gemini-cli.md | Gemini 自动记录与恢复浏览器 |

本机验证只覆盖 macOS。目录 fsync 是尽力执行，网络卷、Windows、跨主机和断电场景没有实机结论。会话内容来自用户和工具时可能包含敏感数据；不额外序列化宿主配置密钥，不采集人工 PTY 私密正文。
