# S004 交互兼容审计

在 S003 已有矩阵上追加；不把新会话选择器当作替代旧交互的理由。

| 功能 | 本课处理 | 验证 |
|---|---|---|
| 单次消息 / --plain / 管道 / EOF | 共用 Conversations，结算后保存 | cli-contract、multi-turn、compact-contract |
| /new | 保存未落盘状态后新 UUID；旧记录保留 | 旧 TUI 回归 + S004 PTY 捕获 |
| /compact / 自动压缩 | 保存已采用摘要；临时作业不序列化 | 原压缩回归 + 恢复请求含摘要 |
| 编辑 / 剪切 / 历史 / Unicode / 超长粘贴 | 保留旧按键与整段拒绝策略 | runtime-tui 全部 22 项 |
| 运行中草稿 / Ctrl-C | 保存窗口也可取消；结束后手动发送 | runtime-tui + session-store 取消出版前测试 |
| 一次审批 / requestId / 默认拒绝 | 恢复重建当前 PermissionController | 原权限契约 + S004 当前策略写入验证 |
| Ctrl-X / Ctrl-S / 前后台命令 | 原终端控制接口不变 | 原 runtime / terminal 回归 |
| /terminal / --terminal / 私密输入输出 | 人工 PTY 保留独占输入；不入历史 | 原 human-terminal / TUI 隐私回归 |
| 退出 / SIGTERM / SIGHUP / raw mode | 等运行结算后保存，恢复终端 | terminal-restore 脚本 + 原 PTY 回归 |
| 工具详情 / 滚动 / 缩窄 | 历史重建为有界显示；旧工具不执行 | S004 PTY 恢复旧工具 + 42×18 捕获 |
| /sessions 焦点 / Escape | 独占按键，取消后保留已有草稿 | S004 PTY kept-draft 与私密输入隔离 |
| /resume / --resume / --continue | 完整校验后替换，使用当前配置 | 两进程 SDK、损坏文件、真实模型回忆 |
| /save / 保存失败 | 保留内存；失败阻止切换 | session-store 磁盘失败与重试 |

旧 TUI 测试修正的是观察时机，未放宽请求内容、文件副作用、私密数据排除或终端恢复断言。最终结果见 researches/session-persistence/acceptance/。
