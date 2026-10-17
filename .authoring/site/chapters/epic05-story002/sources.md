# 课程事实来源

课程中的图是机制示意，终端块是可执行入口示例，不是截图或已经发生的回执。每个 pages.json 条目列出下表的来源标识。规范事实与本产品选择分开；源码阅读、确定性集成、真实宿主和真实模型验证分别记录。

| 标识 | 来源及核对范围 |
| --- | --- |
| O01 | [Agent Skills 固定规范](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx)，2026-10-17 核对；三层披露、SKILL.md frontmatter、可选目录、相对资源、实验性 allowed-tools。Unicode 与参考库差异见 researches/skills/README.md。 |
| S01 | packages/core/src/skills.ts：默认/显式发现根、有界摘要、身份与重名、加载状态、读取根/权限/版本、按需资源、停用、当前请求覆盖层。 |
| S02 | packages/core/src/skill-format.ts：严格 YAML、名称/目录匹配、元数据类型、未实现权限语义的警告；packages/cdp-debug/skills/cdp-debug-node/SKILL.md：格式修正例。 |
| S03 | packages/core/src/agent.ts、loop.ts、tools/skill-tools.ts：用户/模型加载、激活与业务批次隔离、请求覆盖层、当前版本预检、结果配对及预算。 |
| S04 | packages/core/src/permissions.ts、tools/path-guard.ts、tools/terminal.ts：当前读取/执行许可及工作区边界；技能不授予权限，普通脚本没有本节新增的 OS 沙箱。 |
| S05 | packages/core/src/session.ts、agent.ts；packages/tui/src/session-store.ts：只保存选择元信息，恢复重新读取当前来源，旧历史不构成激活。 |
| S06 | packages/tui/src/cli.ts、conversations.ts、runtime-tui.ts、skill-view.ts：--skills/--skill/--skill-root/--no-skills 与 /skills 的查看、刷新、load/unload、off/on；元信息查看不发模型请求。 |
| T01 | packages/core/src/__tests__/skill-format.test.ts、skills.test.ts：格式、三层内容、来源、失败、当前权限、容量、版本和恢复的确定性覆盖；通过状态以实际测试记录为准。 |
| T02 | researches/skills/cases.mjs、demo.mjs：固定金额输入、按需哨兵、实际文件/测试进程/独立断言、read-only 脚本拒绝与零效果；离线/真实模型结果分列。 |
| T03 | e2e/src/skills.test.ts：CLI、管道/单次、plain、真实 PTY 的控制、请求和退出；通过状态以实际宿主记录为准。 |
| D01 | specs/E05-extensibility/S002-skills/details/01-technical-design.md、03-verification-checklist.md：本产品 API/策略及完整门槛。 |
| D02 | researches/skills/README.md、cases.mjs、demo.mjs；本节跟练：默认离线命令、证据输出、三处产物与独立金额断言。 |

2026-10-17 在课程生成与浏览器修订后，再次对照 S01/S03/S05/S06 及固定案例核对具体语义和 CLI 拼写；检查时的文件哈希与范围见 [source-audit.json](verification/source-audit.json)。该记录固定当前工作树内容，不用 Git HEAD 冒充尚未提交的并行修改。此源码审阅不代表完整运行验收已通过；最终源码若变化，应按实际差异重新核对。
