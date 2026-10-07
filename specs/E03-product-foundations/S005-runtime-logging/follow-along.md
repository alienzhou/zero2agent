# 跟练：执行一次工具，再用日志追查

[本课](README.md) | [验收范围](details/03-verification-checklist.md)

## 1. 在固定版本中构建

```bash
git clone https://github.com/alienzhou/zero2agent.git
cd zero2agent
git checkout E03-S005-runtime-logging
pnpm install --frozen-lockfile
pnpm build
```

固定 Tag 随本课交付发布；实现与验收版本可在本课交付记录中核对。Node >=22、pnpm >=9。当前终端交互实测平台是 macOS。

## 2. 跑离线实验

```bash
node scripts/e03-s005-logging-demo.mjs
```

这是本地 HTTP 夹具，不调用真实模型。CLI、SDK、权限控制、文件写入和 JSONL 使用生产代码。

观察顺序：实际生成 trace-demo.txt → 按 runId 找日志 → 找到 toolCallId=demo-write → 使用同一 requestId 找提出工具的请求。脚本核对文件内容与请求关联，然后删除 API key，再执行 --logs / --log，确认 HTTP 请求数和原文件字节没有变化。

第二轮故意返回 HTTP 401。Agent 会报告出错，日志保留 request/error、auth 和 401，记录不包含服务错误正文。最后 PASS 只表示这些离线契约经过验证，不表示真实模型完成同一任务。

## 3. 体验 TUI 浏览

```bash
node scripts/e03-s005-logging-demo.mjs --tui
```

进入后执行 `/logs`；用 ↑↓、PgUp/PgDn、Home/End 选择，Enter 查看，Esc / Ctrl-C 关闭列表。列表拥有输入焦点，粘贴不会成为聊天消息。独立查看器支持 ↑↓、PgUp/PgDn、Home/End；Esc / Ctrl-C 返回原日志列表，再按 Esc 返回对话。回到对话后可用 `/log` 看当前运行，用 `/help` 查看全部快捷键。查看器阻止键盘文本与粘贴进入草稿。

恢复的旧工具只供查看。重新发送一句话会产生新 operationId 和新的模型请求；浏览日志本身不会产生这些事件。

输入 `exit` 后示例删除临时工作区。它的会话和日志都在临时目录里，不留到下一次演示。

## 4. 在自己的任务中观察

按 [README 的配置说明](../../../README.md)提供真实模型配置，再启动 `pnpm --filter @zero2agent/tui start`。这一步会调用真实服务。

完成一轮后 `/log` 查看；关闭后运行：

```bash
pnpm --filter @zero2agent/tui start --logs
pnpm --filter @zero2agent/tui start --log <runUUID>
pnpm --filter @zero2agent/tui start --log <runUUID> --log-operation <operationUUID>
```

将尖括号替换为真实 ID。只读查看不需要 API key；它不会自动恢复会话。原始会话另按 sessionId 保存，文件效果需要实际查看工作区验证。

## 5. 分清三个开关与限制

| 设置 | 控制什么 |
| --- | --- |
| --no-save | 不保存新的会话快照 |
| --no-log | 不记录当前运行日志 |
| ZERO2AGENT_LOG_DIR | 日志根目录；不是模型上下文目录 |

独立人工终端沿用 `--terminal [command]` 参数格式，用 `ZERO2AGENT_NO_LOG=1 node packages/tui/dist/cli.js --terminal` 关闭该路径的新日志。

日志上限：单文件 64 MiB、队列 1 MiB、单行 8 KiB；默认展示最近 200 条，列表最多 500 个运行。不做自动删除，总磁盘用量仍需要管理。当前记录逻辑 SDK 调用，不能据它推断每次网络 retry；未闭环也不能证明副作用没发生。

[返回本课](README.md) | [自动化验收](details/03-verification-checklist.md)
