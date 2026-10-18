# 复盘目录

2026-10-18，E01–E05 主线正式完结，22 节课程已全部上线；[完结范围与固定版本](../docs/course-completion.md)。下表列出本仓库已有复盘，原失败、源码版本、成绩和限制保留；带日期的过程描述不代表当前仍待合并或部署。E02-S004 的课程 Tag 已补齐为 `E02-S004-human-terminal`。

| 复盘 | 主题 |
| --- | --- |
| [E02-S001-write-file](./E02-S001-write-file.md) | E02-S001-write-file Retrospective |
| [E02-S002-replace-in-file](./E02-S002-replace-in-file.md) | E02-S002-replace-in-file Retrospective |
| [E02-S003-terminal](./E02-S003-terminal.md) | E02-S003-terminal Retrospective |
| [E02-S004-human-terminal](./E02-S004-human-terminal.md) | E02-S004-human-terminal Retrospective |
| [E03-S001-multi-turn](./E03-S001-multi-turn.md) | E03-S001-multi-turn 复盘 |
| [E03-S002-permissions-approval](./E03-S002-permissions-approval.md) | E03-S002：权限与一次审批的复盘 |
| [E03-S003-runtime-tui](./E03-S003-runtime-tui.md) | E03-S003：运行状态与 TUI 复盘 |
| [E03-S004-session-persistence](./E03-S004-session-persistence.md) | E03-S004 复盘：让恢复遵守真实发生过的事 |
| [E03-S005-runtime-logging](./E03-S005-runtime-logging.md) | E03-S005：运行日志与问题追查复盘 |
| [E03-S006-file-checkpoints](./E03-S006-file-checkpoints.md) | E03-S006 复盘：成本和恢复保证一起设计 |
| [E04-S001-failure-recovery](./E04-S001-failure-recovery.md) | E04-S001：失败恢复与运行预算复盘 |
| [E04-S002-result-references](./E04-S002-result-references.md) | E04-S002 复盘：已有落盘，还缺少可读取的契约 |
| [E04-S003-summary-quality](./E04-S003-summary-quality.md) | E04-S003：有原始来源，摘要仍可能做错任务 |
| [E04-S004-safe-resume](./E04-S004-safe-resume.md) | E04-S004：恢复以前，先说明哪些事实已知 |
| [E05-S001-project-instructions](./E05-S001-project-instructions.md) | E05-S001：规则更新不应消耗无谓的重规划 |
| [E05-S002-skills](./E05-S002-skills.md) | E05-S002：按需加载要覆盖整条执行链 |
| [E05-S003-mcp](./E05-S003-mcp.md) | E05-S003：外部工具要进入同一条执行链 |
| [E05-S004-hooks](./E05-S004-hooks.md) | E05-S004：检查结论不能覆盖工具事实 |

复盘记录具体问题、改进和可复用经验；当前交付状态以各课入口和[主线完结说明](../docs/course-completion.md)为准。AI 作者复核、用户授权合并与独立人工逐行审阅分别记录。

## Directory structure

```
retros/
├── E01-S001-react-basic.md
├── E01-S002-xxx.md
└── ...
```

## What belongs here

- What went well
- What could be improved
- Lessons learned
- AI coding insights (prompt strategies, error patterns, etc.)

## Template

```markdown
# Exx-Sxxx-{slug} Retrospective

## Summary
Brief description of the iteration.

## What Went Well
- ...

## What Could Be Improved
- ...

## Lessons Learned
- ...

## AI Coding Notes
- Prompt strategies that worked
- Common errors and fixes
- ...
```
