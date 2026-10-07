# Codex：运行记录与恢复入口

| 项目 | 值 |
|---|---|
| 仓库 | [openai/codex](https://github.com/openai/codex) |
| Commit | 5a3140176e668a2f72f3c098490eb7f7052d9d85 |
| Commit 日期 | 2026-10-07 04:24:56 +0000 |
| 最近 Tag | 当前浅克隆无可解析 Tag |
| 调研日期 | 2026-10-07 |

## 目标与结论

核对运行数据如何成为恢复输入。RolloutRecorder 将 canonical rollout items 写入 JSONL，由 writer task 处理写入与 flush；恢复会重新打开已有记录以追加。列表筛选还会判断 cwd。公开源码覆盖的能力远超本课，不把完整生产架构复制进教学实现。

本课借鉴：会话有稳定身份，记录有发布边界，恢复必须受工作区约束。选择全量 JSON 快照，是为了直接检查 raw history 与摘要一致性；付出的代价是额外磁盘增长，而不是宣称优于 JSONL。

## 关键源码

- [recorder.rs#L82-L99](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/rollout/src/recorder.rs#L82-L99)：JSONL recorder。
- [recorder.rs#L1066-L1103](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/rollout/src/recorder.rs#L1066-L1103)：持久化与 flush。
- [recorder.rs#L2034-L2055](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/rollout/src/recorder.rs#L2034-L2055)：打开已有记录追加。
- [recorder.rs#L2177-L2228](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/rollout/src/recorder.rs#L2177-L2228)：按 cwd 判断恢复候选。

证据层级：固定版本源码阅读，未声称实测该版本二进制。
