# Gemini CLI 的有限重试与通知

| 项目 | 固定值 |
| --- | --- |
| 仓库 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| Commit | ef59c532f07fbb3a58dd68bac024ae217e9c73ce |
| 最近 Tag | 当前浅克隆未找到，git describe 输出 ef59c53 |
| Commit 日期 | 2026-10-06T22:11:30Z |
| 调研日期 | 2026-10-08 |

固定版本的 retryWithBackoff 有最大尝试、指数等待与抖动；等待接收 signal，并在等待前调用 onRetry。错误分类包括状态、有限深度 cause 链和网络码。它还有 quota/验证/模型切换分支，依赖其认证与模型策略；这些不直接移植到 Zero2Agent。

本课借鉴显式预算、可取消等待和通知，选择更小的默认重试范围；鉴权/参数/协议错误交还调用者，工具效果从传输层中分离。

源码：[packages/core/src/utils/retry.ts](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/core/src/utils/retry.ts)。本次是源码研究，没有声称同版本二进制实机测量。
