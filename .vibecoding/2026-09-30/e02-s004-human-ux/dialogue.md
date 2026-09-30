# 人工交互追加核验：公开交流与工作纪要

> 本页记录本轮请求、公开进度与核验结果，不包含工具原始日志或内部推理；完整历史仍以会话为准。

## 用户请求

> 别的产品也是这个交互么？你再调研确认下，最后我用1-2个功能来试试

## Assistant：核验方向

我会重点核对“用户实际怎么操作”：怎么进入交互、谁输入、怎样返回，以及终端内容是否会发给模型。

确认后，我会明确哪些做法来自成熟产品、哪些是本课自己的取舍，再给你挑两个可直接试用的场景。

## Assistant：阶段性发现

已确认一个重要区别：几家产品都有人操作终端的路径，但交互并不完全一样。

Gemini 当前是 `Tab` 聚焦终端、`Shift+Tab` 返回；Aider 的 `/run` 可在结束后询问是否把输出加入聊天；pi 的示例扩展则暂停 TUI，结束后只回摘要。我们“直接入口也再次确认、正文一律不入模”的做法，需要明确标为课程取舍，不能说成行业统一做法。

## 实验与交付纪要

- 刷新四家 main 源码对象，不覆盖旧快照工作树；新结论固定 SHA，旧 sources.json 保留历史含义。
- 官方网页和源码纠正了搜索摘要中 Gemini 旧 Ctrl+F 的说法，当前映射为 Tab/Shift+Tab。
- 实际运行 Aider 原始 run_cmd 模块，输入 example 并确认返回正文捕获；没有冒充完整 Aider 产品 E2E。
- 本课 Node REPL 两轮输入得到 6，.exit 正常退出。
- less 首轮中文显示为字节码，显式设置 UTF-8 后显示、搜索、翻页及 q 退出通过；保留首次现象。
- 补充[交互复核报告](../../../researches/interactive-commands/notes/human-ux-verification-2026-09-30.md)、[实验记录](../../../researches/interactive-commands/experiments/human-ux-smoke-2026-09-30.md)和[两项试用](../../../specs/E02-act-and-execute/S004-interactive-commands/try-two-features.md)。
- 不改业务实现，不代用户签收，不上传或发布课程；输出分享、直接入口重复确认等体验取舍留待用户试用反馈。
