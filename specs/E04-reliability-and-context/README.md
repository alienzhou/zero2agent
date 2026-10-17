# Epic 4：健壮性与上下文管理

[首页](../../README.md) | [Roadmap](../../docs/roadmap/README.md) | [从这里开始：S001](./S001-failure-recovery/README.md)

把失败后的继续与停止、长结果供给、摘要质量和跨进程恢复分别做成可验证的课程。原史、授权和文件效果的边界继续沿用 E03。

| Story | 主题 | 状态 |
| --- | --- | --- |
| [E04-S001](./S001-failure-recovery/README.md) | 失败恢复与运行预算 | 已通过 PR #23 合入 main |
| [E04-S002](./S002-result-references/README.md) | 大工具结果按需读取 | 已合入 main，含跟练与验收；当前课程稿 15 页；[PR #24](https://github.com/alienzhou/zero2agent/pull/24) |
| [E04-S003](./S003-summary-quality/README.md) | 摘要质量与事实保留 | 实现、课程、严格验收及最终复核完成；任务/关键项 56/56，交付见 PR #25 |
| [E04-S004](./S004-safe-resume/README.md) | 中断后的安全续跑 | 实现、测试、文档已交付；当前课程稿 14 页；[PR #26](https://github.com/alienzhou/zero2agent/pull/26) 交付 |

从 S001 的[离线跟练](./S001-failure-recovery/follow-along.md)开始。S002/S003 在已有压缩之上改善供给和质量；S004 增加逐工具持久执行事实与明确续跑入口。AGENTS、Skills、MCP、Hooks 留在 Epic 5。

2026-10-17 按必要性审阅课程：S001 保留 18 页，S002/S003 各 15 页，S004 为 14 页。此轮课程修订与阅读器导航修复通过最终 AI 复核，按用户授权由 [PR #28](https://github.com/alienzhou/zero2agent/pull/28) 交付；[取舍及延伸入口](../../docs/e04-course-reading-review.md)。原工程验收和发布状态不变。
