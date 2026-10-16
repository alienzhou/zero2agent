# 来源

| 编号 | 本仓库依据 |
| --- | --- |
| S01 | packages/core/src/loop.ts、execution-recovery.ts、session.ts、session-snapshot.ts |
| S02 | packages/tui/src/session-store.ts、conversations.ts |
| S03 | packages/tui/src/checkpoint-store.ts；E03-S006 文件保护文档 |
| S04 | packages/core/src/result-read-recovery.ts、artifact-completion.ts、run-budget.ts、result-store.ts |
| S05 | packages/tui/src/cli.ts、runtime-tui.ts |
| T01 | e2e/src/safe-resume.test.ts、session-persistence.test.ts；researches/safe-resume/verification.json |
| T02 | researches/safe-resume/demo.mjs 与独立保存的离线/真实服务汇总 |
| D01 | specs/E04-reliability-and-context/S004-safe-resume/details/01-technical-design.md |

课程插图为作者根据已实现协议绘制的教学示意，不冒充真实终端截图。验证报告区分确定性 SDK 响应、真实进程、真实 PTY、真实模型与人工审阅。原始截图与实验附件通过外部归档留存。
