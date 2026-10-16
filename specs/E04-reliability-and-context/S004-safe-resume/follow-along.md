# 跟练：进程退出以后，把剩余文件做完

本课处于 PR 审阅，使用 `codex/e04-s004-safe-resume` 分支。建议在独立目录克隆，避免覆盖自己的未提交改动。最终复核版本和归档校验信息见[验收资料](../../../researches/safe-resume/README.md)。

```sh
git clone https://github.com/alienzhou/zero2agent.git zero2agent-safe-resume
cd zero2agent-safe-resume
git fetch origin codex/e04-s004-safe-resume
git switch --detach FETCH_HEAD
pnpm install --frozen-lockfile
pnpm build
node researches/safe-resume/demo.mjs
```

预期 `passed: true`，第一进程 `signal: SIGKILL`，第二进程正常退出。`effects` 只有两项：`first.json` 与 `second.json`，各一次。模型请求来自本机确定性服务。

脚本输出 `evidenceDirectory`，在其中检查：

| 文件 | 看什么 |
| --- | --- |
| `workspace/first.json`、`second.json` | 两份实际文件的 stage 值 |
| `effects.jsonl` | 每次实际写入，不靠模型文字判定 |
| `sessions/` | 第一进程最后的 pending 快照和第二进程已结算版本 |
| `continued.log` | 恢复报告，包括第一项已结算、第二项未执行 |
| `summary.json` | 源码版本、进程退出结果、效果和分层结论 |

再运行故障矩阵：

```sh
pnpm --filter @zero2agent/e2e exec vitest run src/safe-resume.test.ts
```

比较 response、tool-start、effect、tool-settled 四个退出点。只有 response 能证明未执行；tool-start 即使尚未写文件也只能归为未知；tool-settled 可以恢复真实回执。测试还覆盖实际 CLI/PTY、人工新修改、预算停止、当前权限、存储失败和 S003 的完成检查。

`--live` 会使用已配置的真实服务并消耗请求额度，仅在想验证真实模型集成时运行：

```sh
node researches/safe-resume/demo.mjs --live
```

单次任务固定为两个 JSON 文件；失败保留原始目录，不自动重跑直到成功。离线回归用于判断机制，真实服务用于补充集成证据，两者分别记录。
