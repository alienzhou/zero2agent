# 交互兼容矩阵

| 既有能力 | 保持方式 | 证据 |
| --- | --- | --- |
| 输入编辑、多行粘贴、运行中草稿 | 原编辑器保留，文件弹层沿用焦点屏蔽 | 全量 runtime-tui 测试 + checkpoint-runtime PTY |
| Approval 与取消 | checkpoint 在授权后；取消等待后复查；不自动回滚 | Core 4 新测试与原权限/取消套件 |
| Ctrl-X / Ctrl-S / 人工终端 | 原接口保留；登记后台进程时禁止交互回退 | 原 runtime/terminal/人机交接套件与真实服务 |
| /new /sessions /resume /save | 会话原史不倒退；新恢复语义事实正常保存 | 原 session + 新恢复后快照断言 |
| /compact 与自动摘要 | 文件存储不参与模型历史裁剪 | 原 context/compact 套件 |
| /logs /log | 只通过操作与调用 ID 关联，不加入文件正文 | 原 logging + 新关联断言 |
| 单次/管道/plain | 同一捕获控制接口；新命令本地处理 | CLI 实际进程、旧 multi-turn 契约 |
| 无密钥列表/查看/恢复 | 解析参数后在 Agent 创建前返回 | 新 CLI 请求计数和实际恢复 |
| 正常退出/异常/信号恢复终端 | 保留原终端所有权代码 | stty 脚本 exit/SIGTERM/SIGHUP |

新限制是文件保护范围，显式记录到使用文档；并不扩大 shell 或人工终端回退承诺。源码版本与最终运行统计见 acceptance/summary.json。
