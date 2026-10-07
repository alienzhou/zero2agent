# 技术设计

## 事实来源

DiagnosticEmitter 为 run/compact 创建 operationId 和操作内 seq。主请求、摘要请求、provider 计数各有 requestId、purpose、状态、durationMs 和已观测用量；工具保留 toolCallId、工具名、权限动作、状态、参数字段数、结果字符数。时间用于显示，文件 seq 用于顺序。

RuntimeEvent 继续供 TUI 使用，不改变其原契约。诊断 sink 是通知：同步异常、异步拒绝不影响任务执行。诊断只选择白名单元信息，无 console 抓取、无 JSON.stringify(Agent)、无 payload 原文。

## 本地 JSONL

路径 ~/.zero2agent/logs/<sha256(realpath(cwd))>/<runUUID>.jsonl，可用 ZERO2AGENT_LOG_DIR 改根目录。默认启用；--no-log / ZERO2AGENT_NO_LOG=1 关闭当前运行记录，与 --no-save 分别控制。每个文件 wx 独占创建，目录 0700、文件 0600。

文件版本与 runId、seq 在每行保存；写队列有 1 MiB 上限，单文件 64 MiB 上限，单行 8 KiB 上限。串行完整写入，结算/退出 flush + fsync；失败转为可见降级，不把日志错误替换为 Agent 错误。

## 查看与异常

--logs 列表、--log UUID 查看，均不需要 API key；可按 operationId 过滤。TUI /logs 使用焦点独占列表，/log 查看当前/指定运行，查看器支持方向键、PgUp/PgDn、Home/End；Esc 或 Ctrl-C 返回原日志列表或对话。读取时捕获只读快照，不不断追尾。查看焦点阻止文本/粘贴进入草稿，草稿和审批输入继续遵守旧约束。读取限制在当前工作区，用 UUID 拒绝目录穿越，O_NOFOLLOW 拒绝文件软链接。

只接受已知版本与字段。末尾残缺行标记不完整并保留之前完整行，中部损坏拒绝；正常 host-end、操作结束与请求结束分别检查。显示最多近期 200 行，并报告省略数量；记录仍留在文件中。

恢复会话不重写旧日志；新进程创建新 runId，恢复的 sessionId 跨运行相同。后台摘要沿用原 operationId。日志对模型历史没有写入接口。
