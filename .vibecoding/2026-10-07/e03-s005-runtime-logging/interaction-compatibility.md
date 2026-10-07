# 交互兼容矩阵

| 既有能力 | 本课行为 | 验证入口 |
| --- | --- | --- |
| 草稿、Unicode、历史、编辑与多行粘贴 | 编辑器原路径；日志列表独占焦点，不发送粘贴 | runtime-tui.test.ts、runtime-logging.test.ts |
| 审批与拒绝 | 同一权限控制接口；记录动作，不保存参数/原因原文 | permissions.test.ts、permission-contract.test.ts |
| Ctrl-C 取消并继续 | 原取消结算协议；请求取消与操作取消分别记录 | runtime-sdk.test.ts、runtime-live.test.ts |
| Ctrl-X / Ctrl-S | 原命令控制；原生结果/PID/后台完成保持旧请求身份 | terminal-cancellation.test.ts、runtime-logging.test.ts |
| /compact、自动/后台压缩 | 原摘要策略；摘要/计数请求有独立目的与身份 | diagnostics.test.ts、compaction tests |
| /sessions /resume /new /session /save | 原快照协议；宿主生命周期留元信息 | session-persistence.test.ts、session-live.test.ts |
| /terminal、--terminal | 原 PTY 交接；只记录原生退出结果，不采集正文 | human-terminal-contract.test.ts、runtime-logging.test.ts |
| plain、单次调用、管道 | 同一日志宿主；只读日志不需要 API key | cli-contract.test.ts、runtime-logging.test.ts |
| --no-save | 只关快照；与 --no-log 分开配置 | runtime-logging.test.ts |
| 正常退出 / SIGTERM / SIGHUP | 原终端恢复；日志退出刷新 | e03-s003-terminal-restore.mjs |
| SIGKILL | 保留可读前缀并报告未闭环；没有恢复旧进程 | runtime-logging.test.ts |

各项通过状态以完整验收报告为准，不用此矩阵本身代替运行证据。查看日志不导入上下文、不复活进程、不执行旧工具。
