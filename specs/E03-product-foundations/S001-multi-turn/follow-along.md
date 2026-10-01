# E03-S001：分步跟练

[Story](./README.md) | [验收清单](./details/03-verification-checklist.md)

## 版本与前提

实现与自动测试已完成，生产代码基线 `ea498a3` 未变，最终验收测试为 `3829868`，已推送至 `origin/feat/e03-s001-multi-turn` 的 `50d1c1a`。该分支包含下面的压缩练习，但尚未合入 `main`，也没有本期发布 Tag。

先确认工作区包含 `packages/core/src/context-budget.ts`、`context-summary.ts`、`context-manager.ts` 与 `e2e/src/compact-contract.test.ts`。可从已推送的功能分支获取；最终 `3829868` 验收测试已包含两项强化用例，生产代码仍为 `ea498a3`。不要覆盖已有未提交工作。

Node.js 22+、pnpm 9+。下列命令从仓库根目录运行；依赖尚未安装时先运行 `pnpm install`。

## 1. 先看到旧问题

阅读上一节的 `runLoop()`：它在函数内创建只有当前 user 的消息数组，end_turn 时直接返回文本。思考两处缺口：谁保存跨轮历史？最终回答为什么也必须保存？

本节基线是提交 `0ca861a`；可用 `git show 0ca861a:packages/core/src/loop.ts` 阅读，不必切换工作区。

## 2. 验证上下文真的跨轮传输

```sh
pnpm build
pnpm --filter @zero2agent/core test -- src/__tests__/session.test.ts
pnpm --filter @zero2agent/e2e test -- src/multi-turn-contract.test.ts
```

第一组捕获发送给 SDK 的消息快照。第二组启动本地 SSE 测试服务和真实 CLI，在临时目录调用 write_file，再发送下一轮输入；断言旧工具结果还在、`/new` 后只剩新消息，而且已经写入的文件没有消失。临时目录由测试清理。

这些测试不需要真实 API key，不向远端模型发送请求。它们验证消息契约与进程集成，不是假装模型理解了上下文。

## 3. 阅读与动手顺序

1. 看 Session 如何在 await 前上锁，以及 finally 如何解锁。试想 reset 在模型生成中执行会怎样。
2. 看 Agent 为什么只构造一次 Session，并固定创建时的 cwd。
3. 看 Loop 的 tool_use 与 max_tokens 分支：同样出现工具调用，为什么只有前者执行？
4. 查看网络错误测试：工具返回“file changed”之后请求失败，下一轮是否仍带有这条证据？
5. 自己补一个测试：连续两次失败后再成功，不应该出现孤立的 tool_use，也不能把上一次的未完成流式文本当成正式回答。

### 动手题：让失败后的第三轮还能接上

在你自己的练习分支中，打开 `packages/core/src/__tests__/session.test.ts`，放在 `failed and incomplete turns` 分组内。复用该文件的 `transport`、`reply`、`call`、`answer` 和 `expectPaired` 辅助函数；不要创建真实网络请求。

先按下面的时序画出第三轮将收到的历史，再补最后三处断言。参考实现已有同题测试，练习时可先折叠它。

```ts
it('exercise: continue after two failures', async () => {
  const execute = vi.fn(async () => 'saved once')
  const requests = transport(
    reply([call()], 'tool_use'),
    new Error('first failure'),
    new Error('second failure'),
    answer('recovered')
  )
  const agent = new Agent({ tools: [{ ...echo, execute }] })
  await expect(agent.run('change')).rejects.toThrow('first failure')
  await expect(agent.run('retry')).rejects.toThrow('second failure')
  await agent.run('inspect current state')
  // TODO：工具执行次数、第三轮历史条数、工具配对。
})
```

运行：`pnpm --filter @zero2agent/core test -- src/__tests__/session.test.ts -t 'exercise:'`。参考断言：`expect(execute).toHaveBeenCalledTimes(1)`、`expect(requests[3]).toHaveLength(7)`、`expectPaired(agent.getHistory())`。

七条消息依次是：首个请求、工具调用、工具结果、中断说明、第二个请求、中断说明、第三个请求。第四次模型请求正好发生在第三轮。工具虽然只执行了一次，用户已经经历了三轮。

为了验证测试真的能发现问题，可在个人练习分支暂时去掉 `Agent.run()` 传给 Loop 的 `session`，运行上述测试观察失败；再恢复该参数，确认测试变绿。不要修改真实工作文件来制造副作用。

## 4. 先验证自动层级，再体验手动命令

从一次读入大文件的场景出发：工具结果会让同一 Turn 内的下一次请求突然增大。预算检查必须放在每次模型请求前，而不是只在用户按回车时执行。

```sh
pnpm --filter @zero2agent/core test -- src/__tests__/context-budget.test.ts src/__tests__/context-summary.test.ts src/__tests__/context-manager.test.ts
pnpm --filter @zero2agent/core test -- src/__tests__/session.test.ts src/__tests__/loop.test.ts src/__tests__/compact-loop.test.ts
pnpm build
pnpm --filter @zero2agent/e2e test -- src/compact-contract.test.ts src/multi-turn-contract.test.ts
```

这些专项使用 mock 或本地 HTTP/SSE 服务，不需要真实模型、真实 API key，也不设置 `E2E_LIVE=1`。CLI 契约测试隔离本地密钥和模型环境，并显式配置测试模型窗口；构建失败时先修复再运行 E2E，以免测试旧 dist。生产代码 `ea498a3`、验收测试候选 `3829868` 最终全量 379 通过、25 项真实模型测试因缺 API 配置跳过；compact-loop 12/12 和 strict 类型检查通过，详见[验收清单](./details/03-verification-checklist.md)。你自己的运行仍应分别记录成功、失败与跳过。

按以下顺序观察断言：

1. **预算完整性**：system、工具 schema、多字节消息与工具结果都计入；未知模型无窗口时拒绝，provider 计数失败不放行。
2. **先做便宜的缩短**：大工具结果写入临时文件；读回全文与原结果一致，原始历史和 tool_use_id 不变。长单行另有 `.chunks.jsonl`，检查 read_file 能按行读到末尾，而不只是文件存在。
3. **后台不丢增量**：打开 `context-manager.test.ts` 中使用 deferred 的测试，让摘要 Promise 暂不完成；继续追加回答和用户修正，再 resolve，检查尾部原样保留。
4. **前台等待与硬上限分开**：让新增文本超过前台阈值；在 resolve 前断言 prepare 没有返回。摘要失败但完整请求仍在硬预算内可以继续，超过则必须拒绝。reset/cancel 后旧摘要不得采用，立即取消也不得继续启动计数。
5. **摘要也会超长**：阅读 `context-summary.test.ts` 的分块与失败用例，检查输出 token 上限、字节目标和后续输入预算分别约束，输出截断不能算成功。
6. **最后看手动入口**：CLI 契约区分主请求和摘要请求，断言 `/compact` 不成为 user 消息、`/compact extra` 是普通输入、失败后原史仍在、`/new` 清掉摘要。

可在个人练习分支给后台增量测试追加一条“保留 public API”的用户修正，再断言压缩后最新输入仍完整存在。不要只断言摘要字符串出现：那样发现不了丢失增量。另检查溢出恢复用例的工具调用次数，确认重试的是模型请求而非工具副作用。

## 5. 可选：真实模型两轮与前台压缩

只有确认 API 费用与数据边界后才做这一步。SDK 和 CLI 的摘要也请求同一个配置模型；长历史可能被分成多次摘要请求，后台摘要与主请求可能并发。`provider` 还会增加计数请求，兼容服务未必支持该 API；按供应商实际规则计费。不要用大量重复文本向真实模型强行压测阈值，用上面的本地测试即可。

先按仓库首页配置模型。以下示例仅适用于已知默认模型；改用其他 MODEL_NAME 时，必须按供应商文档显式填写对应 CONTEXT_WINDOW，不能照抄 200000：

```sh
MODEL_NAME=claude-sonnet-4-20250514 CONTEXT_WINDOW=200000 MAX_INPUT_TOKENS=190000 MAX_OUTPUT_TOKENS=4096 CONTEXT_COUNTING=conservative node packages/tui/dist/cli.js
```

MAX_INPUT_TOKENS 是含固定指令、工具定义与消息的输入上限，还需留出输出和安全空间；conservative 是 UTF-8 字节保守估算，不是精确 token 读数。四个变量只由 CLI 转为 context 选项；SDK 使用 `new Agent({ context: { ... } })`。

逐条输入，等每次重新出现 `你: ` 再继续：

```text
本次练习代号是 cedar-17。目标是只讨论测试组织；保留 public API，不修改文件、不调用工具。请用几句话复述约束与下一步。
刚才的代号、约束和下一步分别是什么？
/compact
继续：先复述必须保留的约束，不要执行任何工具。
/new
当前对话中，我是否告诉过你练习代号？不要猜测。
exit
```

`/compact` 前台等待，界面可能显示等待已有后台任务、前台压缩、完成或失败。短历史可能没有可采用的缩减，不能把“没有可压缩的历史”当作失败；失败时先检查预算及服务错误，别无限重复付费请求。自然语言回答不等于契约证据，仍以本地请求快照断言为准。本轮未自动执行真实模型体验。

在已有 SDK 集成中，可于空闲时观察两个视图（调用 compact 仍会请求真实模型，除非你已 mock 客户端）：

```ts
const original = agent.getHistory()
const changed = await agent.compact()
const context = agent.getContext()
console.log({ changed, historyMessages: original.length, contextMessages: context.length })
// 原史内容应保持不变；消息条数不是 token 数，也不能证明摘要质量。
agent.cancelCompaction() // 取消压缩，不是撤销工具或全局中断。
```

## 6. 知道哪些事情不会发生

- `/compact` 不删除原史，不回退文件；`/new` 清空会话，但不撤销文件、日志、后台命令，也不删除供应商记录。
- 摘要有损，不保证保留所有事实；重要操作应回读文件或重新检查当前状态，而非重跑有副作用的原工具。
- 自动压缩不能容纳任意大的最新输入或固定指令；安全请求无法构造时会报错，需拆分输入。
- 原始历史仍占内存，退出不会恢复会话；工具结果临时文件不等于持久化，会受系统清理影响。
- 本节没有新增全局中断 UI；手动 compact 与 run/reset 互斥，已有 terminal 中止继续通过工具结果反馈。
