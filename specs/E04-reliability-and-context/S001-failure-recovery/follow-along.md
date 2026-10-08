# 跟练：失败后继续，预算用完停止

[课程](./README.md) | [验收范围](./details/03-verification-checklist.md)

需要 Node >=22、pnpm >=9。固定课程版本：`E04-S001-failure-recovery`。实现尚未合入main，课程网站未部署；版本状态与验收范围独立记录。

```bash
git fetch origin tag E04-S001-failure-recovery
git switch --detach E04-S001-failure-recovery
```

## 不用密钥的离线演示

在工程根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm build
node scripts/e04-s001-recovery-demo.mjs
```

脚本的 API key 只是本地占位符，地址固定为它自己启动的回环 HTTP 服务。真实生产 SDK 和 CLI 运行，不调用远端模型；所有文件、保存、日志与 Checkpoint 在临时目录，退出删除。

观察五件事：请求重试经过 3 次 HTTP；先写文件再遇到服务失败，整个过程 4 次 HTTP 但只有 1 条写入 Checkpoint；同一缺失文件读 2 次后停止；半截流显示草稿后重新生成，共 2 次 HTTP；鉴权失败只请求 1 次。PASS 来自实际请求、文件、日志和退出码断言。

## 在 TUI 中取消等待

```bash
node scripts/e04-s001-recovery-demo.mjs --tui
```

脚本先完成上述验证，再打开真实 TUI。输入“演示等待取消”，看到 20000ms 等待后按 Ctrl-C。等界面恢复输入，再输入“演示半截流”；比较未完成草稿与完整回复。用 `/logs` 查看运行，Enter 查看，Esc先返回日志列表、再按Esc回到输入；确认请求的 logical/attempt 字段。输入 exit 清理临时目录。

## 改变运行限制

自己的工程可用这些参数：

```bash
pnpm --filter @zero2agent/tui start -- --max-retries 0 --max-tool-calls 8 --max-duration-ms 120000
```

上面的普通 CLI 使用当前环境配置，可能请求真实服务并产生费用；与离线脚本分开选择。max-retries=0 关闭传输重试，不关闭 E03 的独立上下文拒绝恢复。总时间达到后仍需等正在执行的工具结算。

## 从自动测试核对故障

```bash
pnpm --filter @zero2agent/core test -- src/__tests__/failure-recovery.test.ts
pnpm --filter @zero2agent/e2e test -- src/failure-recovery.test.ts
```

Core 专项使用真实 SDK 与本地 HTTP/SSE；E2E 驱动生产构建和真实 CLI/PTY。它们分别核对流结束、请求次数、配对、参数覆盖、文件效果、日志隐私、取消及终端恢复，不证明真实供应商永远返回同样内容。

## 对照实际终端证据

[等待画面](../../../researches/failure-recovery/acceptance/screens/02-backoff.png)、[取消后](../../../researches/failure-recovery/acceptance/screens/03-cancelled.png)、[草稿与完整回复](../../../researches/failure-recovery/acceptance/screens/04-draft-and-recovered.png)和[尝试日志](../../../researches/failure-recovery/acceptance/screens/07-attempt-log.png)来自生产CLI的真实PTY字节，在xterm.js中重放为PNG。它们是本地确定性故障，不是自然供应商故障。

[原始PTY](../../../researches/failure-recovery/acceptance/screens/raw-pty.ansi.gz)无损保存；屏幕txt和课程P09的文字显示为派生内容，课程显示只去行末空白。[取证元信息](../../../researches/failure-recovery/acceptance/screens/capture.json)列出平台、版本和源哈希。

已运行的真实服务补验由本地代理分别在首请求、真实写入后的请求注入500/503，其余响应来自当前配置服务。核对4次本地HTTP、2次远端成功响应、1条写入Checkpoint；[证据](../../../researches/failure-recovery/acceptance/live/failure-recovery-live.json.gz)不含密钥，不能由此断言供应商自然故障频率或所有模型任务质量。

有自己的服务配置时，可单独运行：

```bash
E2E_LIVE=1 pnpm --filter @zero2agent/e2e test src/failure-recovery-live.test.ts
```

该命令请求真实服务，会消耗实际token。离线脚本不依赖这个步骤。
