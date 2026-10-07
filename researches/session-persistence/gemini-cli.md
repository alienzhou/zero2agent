# Gemini CLI：会话自动记录与浏览

| 项目 | 值 |
|---|---|
| 仓库 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| Commit | ef59c532f07fbb3a58dd68bac024ae217e9c73ce |
| Commit 日期 | 2026-10-06 22:11:30 +0000 |
| 最近 Tag | 当前浅克隆无可解析 Tag |
| 调研日期 | 2026-10-07 |

## 目标与结论

核对自动保存与恢复入口如何衔接。当前源码使用 JSONL 记录，元信息和消息分开写入；重写时先临时文件再 rename，保留不可读旧文件。/resume 打开 sessionBrowser 对话框，浏览后恢复。

本课借鉴“恢复可发现”和“失败保留证据”，选择更小的完整快照协议以减少教学前置知识。这是设计取舍，不是性能优劣结论。

## 关键源码

- [chatRecordingService.ts#L960-L1045](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/core/src/services/chatRecordingService.ts#L960-L1045)：重写与消息追加。
- [resumeCommand.ts](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/commands/resumeCommand.ts)：浏览器入口。

证据层级：固定版本源码阅读，未声称实测该版本二进制。
