# Codex：通过事件关联运行状态与工具输出

## 基本信息

| 项目 | 值 |
|---|---|
| 官方仓库 | [openai/codex](https://github.com/openai/codex) |
| 调研 Commit | `5a3140176e668a2f72f3c098490eb7f7052d9d85` |
| Commit 日期 | `2026-10-07T04:24:56Z` |
| 最近 Tag | 浅克隆深度 100 内无可达 tag，以 SHA 为准 |
| 调研日期 | 2026-10-07（Asia/Shanghai） |
| 证据级别 | 固定源码静态核对；不代表已运行该产品 |

## 调研目标与结论

核对运行时状态到 TUI 的通道、审批焦点、取消范围与终端交接。关键结论是结构化事件、调用关联、独立后台清理，以及显式停止输入消费者。

## 详细分析

### 工具状态来自事件

[EventMsg](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/protocol/src/protocol.rs#L1447-L1569)分别定义 TurnStarted、TurnComplete、ExecCommandBegin/OutputDelta/End、审批与 TurnAborted。[命令开始结构](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/protocol/src/protocol.rs#L3593-L3628)有 call_id、turn_id 与可选 process_id；[输出增量](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/protocol/src/protocol.rs#L3691-L3701)携带 call_id、stdout/stderr 与字节。这让 UI 按事实更新，不必解析输出正文猜状态。

### 中断当前轮与清理后台分开

[Op 定义](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/protocol/src/protocol.rs#L583-L602)明确把 Interrupt 与 CleanBackgroundTerminals 分开；前者不终止后台 terminal，并由 TurnAborted 结算。本项目已存在后台命令，取消按钮必须说明范围。

### modal 先处理按键

[should_interrupt_running_task](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/tui/src/bottom_pane/mod.rs#L1712-L1727)要求运行中、没有 modal/popup，并避开 Vim Escape 语义。[默认中断键](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/tui/src/keymap.rs#L1660-L1672)为 Esc。[审批队列](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/tui/src/bottom_pane/approval_overlay.rs#L210-L237)按已结算请求清理当前项和队列，推进后续请求。界面关闭不等于授权。

### 外部程序拿到独占输入

[pause_events/resume_events](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/tui/src/tui.rs#L861-L871)暂停事件 broker，避免争抢 stdin；[with_restored](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/tui/src/tui.rs#L917-L938)封装临时终端恢复。这证明外部程序交接机制，不证明所有 PTY 都使用本项目的输入隐私策略。

## 关键源码与参考

以上链接均固定 SHA。[Cargo 依赖](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/tui/Cargo.toml#L90-L101)表明 TUI 使用 Ratatui；采用其事件原则不要求迁移 Rust。[官方 CLI 页面](https://learn.chatgpt.com/docs/codex/cli)作为产品入口，具体机制以固定源码为准。

本轮另做已安装版本的隔离 PTY 观察，见 [实机记录](./observations/2026-10-07/README.md)；该二进制版本不与上述源码 SHA 强行等同。
