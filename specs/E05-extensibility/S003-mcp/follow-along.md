# 接入一个本地工单服务

完成后，你能观察固定工单和长日志进入 Agent，实际修复金额函数并通过测试，以及外部工具拒绝或效果未知时如何停止。需要 Node 22+、pnpm 9+；默认跟练不用模型凭据，不连接业务服务。

## 先跑完整离线流程

在仓库根目录：

```bash
pnpm install --frozen-lockfile
pnpm build
node researches/mcp/demo.mjs
```

`normal` 使用确定性 HTTP 模型响应，但真正启动 MCP 子进程、执行工具、写文件并运行 Node 测试：

1. 分页发现 `get_issue`、`get_logs`、`record_action`，查询固定 ISSUE-42 和长日志。
2. 大日志变成 `tool_result_reference`；用 `{reference, tail:true}` 读取最终 4096 字节，不重跑服务工具。
3. 读取并修改 `packages/api/amount.mjs`、`amount.test.mjs`，累加整数分再转回金额。
4. 真实运行测试后写 `artifacts/change-report.json`。独立校验确认 `[0.1, 0.2]` 恰好为 `0.3`，空数组为 0，web 文件不变。

`denied` 明确拒绝 `record_action`。虽然服务自报 readOnlyHint 和 idempotentHint，宿主仍拒绝；效果事件为 0，文件不变。真实模型可能先正确拒绝，此例允许这种停止；确定性测试另行验证了实际调用的权限门。

输出末尾给出新建的 `tmp/e05-s003/...` 目录。查看 `verification.json` 的逐项结果，再查看每例的 `protocol.jsonl`、`events.json`、`terminal-metadata.json`、`snapshot.json` 和 `workspace/`。请求与响应仅用于本地验收，不提交到 Git。

## 在 CLI 中查看工具表

创建一个自己检查过的配置文件，例如 `/tmp/z2a-mcp.json`。`command` 填 `node -p process.execPath` 显示的绝对路径；服务脚本填本仓库 `researches/mcp/issue-server.mjs` 的绝对路径。

```json
{
  "servers": [{
    "id": "issues",
    "command": "/absolute/path/to/node",
    "args": ["/absolute/path/to/zero2agent/researches/mcp/issue-server.mjs"],
    "env": {}
  }]
}
```

```bash
node packages/tui/dist/cli.js --mcp-config /tmp/z2a-mcp.json --mcp
node packages/tui/dist/cli.js --mcp-config /tmp/z2a-mcp.json --mcp-enable issues --mcp
```

第一条只显示 disabled，不启动服务。第二条明确授权启动，握手和发现后显示映射的工具名，等待关闭完成再退出；都不需要 API key。配置文件中不接受 enabled 字段，也不自动发现仓库里的配置。参数与环境键值原样传入，不经过 shell，不继承父进程环境。

带同样的配置和 enable 参数启动普通 CLI、管道、`--plain` 或 TUI，外部工具会进入每轮模型工具表。每个工具的描述注明服务 ID 和原名；模型名是 `mcp_<server>_<原名哈希前24位>`。有两个服务都叫 get_issue 时，两者仍分别路由。

## 调用还需要当前授权

启用服务本身会运行本地代码，具有宿主进程权限；本节没有 OS 沙箱。启动信任与工具调用授权分开：

| 当前模式 | 外部调用 |
| --- | --- |
| default | 走审批；无处理器则拒绝 |
| accept-edits | 不自动允许 execute；仍需审批或明确规则 |
| read-only | 拒绝外部调用，allow 规则也不能扩大模式 |
| bypass | 宿主明确选择后允许；显式 deny 仍优先 |

对具体工具配置 `PERMISSION_RULES` 时，使用 `--mcp` 显示的映射名称，例如 `[{"tool":"mcp_issues_<实际哈希>","action":"allow"}]`，不要把占位符当成实际名称。普通文件读写、terminal 和检查点继续沿用既有规则。跟练脚本只允许 issue、日志与必要的本地测试，拒绝 record_action。

长结果和 `read_history` 回读另外校验当前启用配置、服务身份和原工具权限；受输入字段限定的 allow 规则不能直接当作通用回读授权，可能需要新的审批。结果/历史目录升级为 v2，磁盘会话升级 v4，v1/v2/v3 普通旧会话继续支持。快照不保存命令、环境、凭据、进程或批准。

## 用真实故障理解 unknown

```bash
pnpm --filter @zero2agent/core exec vitest run src/__tests__/mcp.test.ts src/__tests__/mcp-integration.test.ts
pnpm --filter @zero2agent/e2e exec vitest run src/mcp.test.ts
```

`effect-disconnect` 和 `effect-hang` 在 record_action 产生一次本地效果后断线、等待超时或被取消。用例断言效果为 1、后续调用未执行、历史完整配对；恢复或新连接不会重放旧调用。CLI 提示 outcome unknown；先核对效果，再使用 `/recovery` 和 `/recovery continue <核对结果与下一步>`，或恢复会话时 `--resume-task <说明>`。这是显式新轮次，重新使用当前权限与预算。

收到 `isError:true` 是已收到的工具失败；合法 JSON-RPC 拒绝单独标记为协议错误。已发出的请求若结果缺失、格式损坏、超时、取消、内容不支持或输出 Schema 不符，本节保守视为 unknown 并停止。清理报错也保留未知状态，不能继续自动调用。

## 容量与生命周期

| 对象 | 上限 / 行为 |
| --- | --- |
| 配置 | 32 KiB、4 服务；ID 1–32 字符；argv 最多 64 项 |
| 每服务目录 | 32 工具、8 页；单工具元信息 32 KiB；游标最多 2048 字符并拒绝循环 |
| Schema | 16 KiB、256 节点、12 层；不支持的约束明确失败 |
| 传输 | 单条 1 MiB、单连接累计 stdout 16 MiB；UTF-8 严格校验；发出消息 256 KiB |
| 时间 | 每服务启动加发现共 10 秒，单次调用 30 秒，同时受整轮预算约束；SDK 可配置更短时间 |
| 关闭 | 关管道、TERM 等最多 250ms、KILL 再等最多 250ms；验证实际 PID 已退出 |
| 回读 | 沿用结果存储的引用/有效期/空间限制，每页最多 4096 字节 |

目录在本轮固定，list_changed 或连接关闭后禁止旧表继续调用；下一次用户明确操作重新发现。正常轮次、错误、取消都等待关闭。本地清理覆盖普通进程组；主动逃离进程组的代码不在此保证范围。

## 真实模型与阅读材料

`node researches/mcp/demo.mjs --live` 使用当前 `.env.local` 配置，预算与输入在 `cases.mjs` 冻结，日志区分请求名称与服务自报名称。每次执行创建独立记录，不能把失败附件删掉后改称通过。

课程图解聚焦连接、授权、结果来源和未知效果。完整协议调查见 [researches/mcp](../../../researches/mcp/README.md)，详细设计与验收见本 Story 的 `details/`。
