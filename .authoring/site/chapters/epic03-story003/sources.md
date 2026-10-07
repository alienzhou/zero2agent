# E03-S003 来源与事实边界

核对日期：2026-10-07。工程内容来自本分支 `codex/e03-s003-runtime-tui`，合并状态另行确认。本文件不声明已合入 main。课程源码入口指向固定 Tag `E03-S003-runtime-tui`，由主流程完成验收后创建。所有终端图形为原创 SVG 教学重排，非竞品截图；图内使用简写身份和示例目录。

| ID | 仓库路径 / 外部证据 | 支持内容 |
|---|---|---|
| C01 | specs/E03-product-foundations/S003-runtime-tui/README.md 与 details/01-technical-design.md | 学习目标、界面结构、状态与输入原则 |
| C02 | packages/core/src/runtime.ts、agent.ts、loop.ts | turnId/seq、工具身份、事件与控制、取消 |
| C03 | packages/core/src/permissions.ts、loop.ts | 待审批、请求失效、工具执行与结果配对 |
| C04 | packages/tui/src/runtime-state.ts、runtime-tui.ts、cli.ts | 阶段呈现、输入编辑、详情、草稿、审批和降级 |
| C05 | packages/tui/src/human-terminal.ts、setup-terminal-runtime.ts | 人工 PTY 独占与恢复、私密正文边界 |
| C06 | specs/E03-product-foundations/S003-runtime-tui/details/03-verification-checklist.md、deep-dive/01-cancellation-and-evidence.md | 取消收尾、已产生副作用、持久化边界；测试结果以实际验收记录为准 |
| C07 | scripts/e03-s003-runtime-demo.mjs、specs/E03-product-foundations/S003-runtime-tui/follow-along.md | 本地固定模型响应、拒绝/批准文件效果、慢速请求与人工终端练习 |
| C08 | packages/tui/src/display-text.ts | 安全文本、显示宽度与字符处理 |
| R01 | researches/runtime-tui/claude-code.md；[官方交互文档](https://code.claude.com/docs/en/interactive-mode) | 运行输入排队与上下文相关键位；无运行时源码证据 |
| R02 | researches/runtime-tui/codex.md | 事件关联、modal优先、取消与后台清理分离 |
| R03 | researches/runtime-tui/gemini-cli.md | core 工具状态与 UI 整轮状态聚合、shell 焦点 |
| R04 | researches/runtime-tui/opencode.md | store 事件、弹层焦点、中断语义、终端恢复 |
| R05 | researches/runtime-tui/interaction-design.md、observations/2026-10-07/README.md | 输入、粘贴、历史、详情、尺寸变化，以及两产品实机边界 |

所有开源竞品文件固定链接和 SHA-256 见 researches/runtime-tui/source-pins.json：Codex `5a3140176e668a2f72f3c098490eb7f7052d9d85`、Gemini CLI `ef59c532f07fbb3a58dd68bac024ae217e9c73ce`、OpenCode `ecc4916b5a9608c30e6dd58a67f2137b594407ca`；Ink 8 的比较固定到 `26d2c3f83008142061c22267482489588cc3823c`。

实机版本是 Codex 0.160.1 与 OpenCode 1.18.35，不强行等同源码提交；未执行竞品模型任务、审批或工具。课程 P04明确这一点。P13 本项目忙时可编辑，结束后手动发送，不宣称消息自动排队；P17 由本地夹具驱动生产路径，不是真实智能模型，退出会删除临时目录。P15 详情只展开界面保留的参数/结果，超长会截短；P16 区分模型发起的权限判断与人工交接，权限可以自动允许，直接 /terminal 只做人机交接确认。

图形与全文由 author.cjs 生成；所有文字可搜索、可选中。自动检查只证明其覆盖的排版或资源约束；作者视觉复核记录在 review.md。
