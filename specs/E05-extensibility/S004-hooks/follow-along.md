# 从一次后置检查失败开始

需要 Node 22+、pnpm 9+。默认跟练使用确定性模型响应，但真正启动 MCP、Hook、终端与 Node 测试；不需要模型凭据，也不连接业务系统。

```bash
pnpm install --frozen-lockfile
pnpm build
node researches/hooks/demo.mjs
```

脚本创建全新的 `tmp/e05-s004/offline-*`，不覆盖旧记录。

- normal：根规则与 API 目录规则 → 已明确选择的 fix-with-tests → 按需读取报告资源 → MCP issue/长日志及尾页 → 修改金额函数与测试 → 真实测试 → 三处 Hook → JSON 产物契约。首次单调用进入 API 目录触发补载，再按当前规则成对读取；整轮仍限 8 请求、12 工具、120 秒。
- denied：一次写入 blocked.txt 后，afterTool 返回 block。本轮失败、原回执仍成功、文件内容保留、后续没有工作。这个结果是负例的正确停止，不能称为正常完成。

查看输出目录的 `verification.json`、每例 `workspace/`、`requests.jsonl`、`responses.raw`（真实模型时）、`protocol.jsonl`、`hooks.jsonl`、`snapshot.json`、`events.json` 和 `terminal-metadata.json`。原始文件只用于本地验收，不提交 Git。

## 最小命令检查

创建自己审阅过的 `/absolute/check.mjs`：

```js
import fs from 'node:fs'
const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const blocked = input.stage === 'beforeTool' &&
  input.tool?.paths.some(p => p.endsWith('/readonly.json'))
process.stdout.write(JSON.stringify({version: 1, decision: blocked ? 'block' : 'pass'}))
```

创建 `/absolute/hooks.json`。command 填 `node -p process.execPath` 显示的绝对路径；脚本路径同时放入 args 与 sources，后者用于当前内容和物理身份的核对。

```json
{
  "version": 1,
  "hooks": [{
    "id": "gate",
    "stage": "beforeTool",
    "command": "/absolute/path/to/node",
    "args": ["/absolute/check.mjs"],
    "sources": ["/absolute/check.mjs"],
    "env": {},
    "timeoutMs": 5000
  }],
  "watch": ["readonly.json"]
}
```

先查看，不启动检查程序，也不需要 API key：

```bash
node packages/tui/dist/cli.js --hooks-config /absolute/hooks.json --hooks
```

审阅程序和参数后，将返回的真实 identity 复制到启用参数。下面的 `<identity>` 是占位符：

```bash
node packages/tui/dist/cli.js --hooks-config /absolute/hooks.json --hook-trust gate:<identity> --plain
```

普通任务需要当前模型配置；同样参数支持单次任务、管道、plain 与 TUI。只提供配置不等于信任，未信任项不执行。配置不接受 enabled、shell、自动批准或参数改写字段；没有隐式仓库脚本执行。

## 三个检查点的顺序

| 阶段 | 何时执行 | 不通过后的事实 |
| --- | --- | --- |
| beforeTool | 当前权限允许后，Checkpoint 与实际工具前 | 工具未执行；剩余项配对为未开始 |
| afterTool | 真实回执与待检查义务一起保存后 | 工具和文件效果保留；停止后续调用 |
| beforeComplete | 原未解决读取门槛通过后，最终产物校验前 | 当前任务未完成，不由 Hook 自动发起模型修复 |

Hook 只返回 pass/block，不改变参数、宿主许可或工具回执。命令用 argv 执行，环境不继承模型密钥或父进程配置；macOS 可能自行加入系统编码元信息，不把它当成父凭据继承。

stdin JSON v1 只含 stage、cwd、checkId，以及适用时的 `tool:{id,name,paths}`、`receipt:{isError,sha256}`。paths 是可信工具声明的受控写入路径；不推断普通 terminal 的任意文件效果。默认不传整段会话、工具正文或人工终端内容。

stdout 必须是 `{ "version":1, "decision":"pass" }` 或 block，可带最多 512 字符 reason；未知字段拒绝。reason 和 stderr 不进入模型历史或诊断。诊断只保存阶段、身份、状态和检查 ID。可信脚本具有宿主进程权限，这些约束不提供 OS 沙箱。

## 中断以后运行新检查

`/recovery` 同时显示工具与 Hook 状态。工具 settled 和 Hook unknown 可以同时成立；已经执行的操作不会回滚。保存回执时已记录 afterTool 未开始，宿主即使在后置检查启动前崩溃，也不会丢掉必要检查。

恢复、普通继续和读取历史都不补跑旧 Hook。先核对真实文件及脚本可能的外部效果，再明确授权新检查：

```text
/recovery check 已检查现有文件与外部效果，请运行新的必要检查
/recovery continue 使用现有文件完成后续工作，不重复旧写入
```

非交互入口：

```bash
node packages/tui/dist/cli.js --resume <session-uuid> --hooks-config /absolute/hooks.json --hook-trust gate:<identity> --recheck-hooks '已核对效果，运行新检查'
```

这条命令不发模型请求，不要求 API key；仍使用当前目录与脚本信任，保留旧检查记录，新检查关联旧 ID。之后用 `--resume-task` 或交互 continue 明确开始新轮次。配置/脚本改动后，先重新 inspect 并审阅、信任新版本；仅显式 recheck 可采用同 ID/阶段的受信任替代版本，普通继续不会自动迁移，删除必要 Hook 也不能解除旧门槛。

恢复控制为 v2、磁盘会话为 v5；普通旧会话 1–4 继续支持。快照不存脚本、命令、环境、批准和进程对象，恢复不复活旧进程。

## SDK 控制入口

```ts
const inspector = new Agent({cwd, hooks: {file: '/absolute/hooks.json'}})
console.log(await inspector.inspectHooks()) // 只查看当前身份，不执行
// 宿主展示上述信息；用户审阅后明确选择 approvedIdentity。
const agent = new Agent({cwd, hooks: {
  file: '/absolute/hooks.json', trust: [`gate:${approvedIdentity}`]
}})
await agent.run('当前任务')
// 发生中断后，由用户独立发起，而不是由模型调用：
await agent.recheckHooks('已核对效果，请运行新检查')
await agent.continueInterrupted('保留已完成效果，继续必要工作')
await agent.close()
```

开启磁盘保存的 CLI 会在每个检查开始/结算边界等待保存；SDK 可通过 executionPersistence 提供同一控制。保存启动意图失败时不启动命令；保存结果失败时保留当前事实并停止，不自动重跑。

## 容量与真实故障验证

| 对象 | 边界 |
| --- | --- |
| 配置与脚本 | 配置 32 KiB / 8 Hook；sources 1–8；单脚本 64 KiB / 每 Hook 总 256 KiB；argv 64 项、路径/参数 4 KiB；watch 32 路径 |
| 输入/输出 | stdin 32 KiB；stdout 4 KiB；stderr 16 KiB；非法 UTF-8/JSON、非零退出均停止 |
| 执行 | 默认 5 秒 / 最大 10 秒；整轮最多 64 次；仍受 Turn 总时长约束；恢复记录最多 512 |
| 文件审计 | watch、契约与本轮受控写入共最多 64 路径，单文件 1 MiB / 总 8 MiB；完成前检查改动声明范围就失败 |
| 原生清理 | 宿主关闭 TERM 250ms → KILL 250ms；管道守护发现父管道 EOF 后终止检查；普通 POSIX 组实测，主动逃逸或 Windows 后代不作已验证保证 |

```bash
pnpm --filter @zero2agent/core test src/__tests__/hooks.test.ts src/__tests__/hooks-integration.test.ts
pnpm --filter @zero2agent/e2e test src/hooks.test.ts
```

宿主测试实际 SIGKILL 四个边界：启动意图已保存、工具已结算但 Hook 未开始、Hook 正在运行、Hook 已结算。组合故障另启用根规则、技能与 MCP：服务一次效果后断线；或文件已写入但 Hook 未结算时杀宿主。恢复不会重放，实际计数、文件和 PID 分别核对。

## 真实模型与证据

配置当前服务后可显式运行 `node researches/hooks/demo.mjs --live`。模型别名与服务回包名分别记录；每例仍是 8 请求/12 工具/120 秒、maxRetries=0。失败保留，不能改成无限重跑取成功。早期离线 v1 因重复 scope 批次撞预算，保留为历史；v2 在真实服务评测前固定了单项目录探测，门槛未提高。

紧凑结果见 [验收索引](../../../researches/hooks/verification.json)，原始请求、协议、PTY、截图与失败在 Git 外独立校验归档；下载后按 [归档索引](../../../researches/hooks/evidence-archive.json) 验证。E05 各课历史模型观察的版本和局限见 [组合验收说明](../acceptance.md)，不把不同版本记录合成同一次“8/8”。站点部署与图文发布单列。
