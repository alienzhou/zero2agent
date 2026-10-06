# E03-S002 源码专项复核

2026-10-05，AI 阅读生产权限控制器、执行入口、内建工具元信息与路径校验、CLI/readline 以及专项测试。最终候选 `73ecdbc`。此记录不是 AGENTS 要求的人工签收。

核对：配置与整批调用快照、未知工具默认询问、deny/ask/allow 顺序、精确标量规则、只读硬约束、一次请求 ID、默认有限超时、错误与取消回执、晚到响应、timer/listener 清理、实例隔离、多工具配对、拒绝不触发 onToolStart。CLI 的展示和控制分开，TTY y/N 不消费管道中的批准文字，人工 PTY 仍有自己的交接确认。

发现并修复：单条输入快照不足以保护后续批次的名字和参数，因此先 structuredClone 整批 content；只读路径在显式审批等待后变成外部软链接时，二次检查必须直接拒绝，不能只返回 ask。对应测试验证不触发工具执行、不返回外部正文。

工作区边界使用已有祖先真实路径，支持未创建的路径尾部并拒绝悬空软链接；直接写、替换、删除仍自行守边界。删除内部软链接保留链接目标。没有新增 shell 安全分析或操作系统沙箱，文件系统并发替换和硬链接不在保证范围。

构建、e2e 类型检查、lint（0 错误，15 条既有告警）、改动 TS 格式、463 项离线和 2 项真实模型验收已通过。人工审阅重点：权限默认变化对外部 SDK 工具的影响、显式规则所表达的宿主信任、写边界与非隔离 shell 的教学表述。详见 [验收证据](../../../researches/permissions/acceptance/README.md)。

实测补验审查：新增辅助环境只用于旧 live fixture，按 read/edit/terminal 明确权限；未放宽生产默认值。真实请求记录器不保存认证头，最小父环境不能改写记录路由。输出落盘用例核对实际文件及 read/grep 回执，耗时直接核对工具结果。最新测试 `8e47cae`、生产仍 `73ecdbc`，50 live 与 463 离线通过，范围见 [本机补验](../../../researches/permissions/acceptance/runtime-audit/README.md)。

2026-10-06 合入准备：重新阅读权限 Controller、Loop/Agent 执行入口、物理路径守卫、TTY 宿主回答和回归覆盖，未发现本课范围内的新阻断。同步 main ce4d721 后，packages/ 与 73ecdbc、e2e/ 与 8e47cae 仍无差异；463 项离线重新通过，原 50 项真实模型证据及原始记录哈希通过核对。此 AI 复核不冒充人工签收；当前核验及日志见 [合入准备](../../../researches/permissions/acceptance/merge-review-2026-10-06/README.md)。
