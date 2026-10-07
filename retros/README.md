# Retrospectives

This directory contains retrospective notes and lessons learned.

## Completed

| Retro | Iteration | Notes |
|-------|-----------|-------|
| [E02-S001-write-file.md](./E02-S001-write-file.md) | E02-S001 写文件 + 删文件 | 第一个写工具迭代的复盘（回执语言 doc/code 漂移的教训） |
| [E02-S002-replace-in-file.md](./E02-S002-replace-in-file.md) | E02-S002 局部修改 | 唯一性约束 + replace_all，教训落地到下一个迭代 |
| [E02-S003-terminal.md](./E02-S003-terminal.md) | E02-S003 驱动执行环境 | 不截断 / 不杀死 / 三道防线；代码合并不等于 Story 收口 |

## Latest merged Story

| Retro | Iteration | Notes |
|-------|-----------|-------|
| [E03-S001-multi-turn.md](./E03-S001-multi-turn.md) | E03-S001 进程内多轮会话与上下文压缩 | 历史所有权、工具副作用证据、预算闸门与分级压缩；已合入 main、已打 Tag，未对外发布 |
| [E02-S004-human-terminal.md](./E02-S004-human-terminal.md) | E02-S004 人工交互终端 | 输入所有权、PTY 恢复、进程组清理和真实断连；两项试用通过，脱敏历史已合入 main，未打 Tag |

## Local implementation, not released

| Retro | Iteration | Notes |
|---|---|---|
| [E03-S002-permissions-approval.md](./E03-S002-permissions-approval.md) | E03-S002 权限与一次审批 | 整批快照、有限等待、路径变化、SSE/PTY 与真实模型验收；已通过 PR #17 合入 main，课程未发布 |

| [E03-S003-runtime-tui.md](./E03-S003-runtime-tui.md) | E03-S003 运行状态与 TUI | 事件与控制、取消证据、连续输入体验与跨模式验收；本地实现，当前验收见课程 |

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
