# @zero2agent/core

Agent 核心逻辑包。

## 多轮会话

一个 Agent 实例拥有一个进程内 Session，重复调用 `agent.run()` 会携带此前完整历史。`agent.reset()` 清空对话，`agent.getHistory()` 返回上次已提交历史的深拷贝；运行中 reset 或再次 run 会被拒绝。

```ts
const agent = new Agent({ cwd: process.cwd() })
await agent.run('先分析测试结构')
await agent.run('按刚才的建议补测试')
agent.reset()
```

静态 `Agent.run()` 和不传 session 的 `runLoop()` 仍是一次性调用。reset 不回退文件、不停止进程；退出后历史丢失。详见 [E03-S001](../../specs/E03-product-foundations/S001-multi-turn/README.md)。

## 测试

### 单元测试

```bash
pnpm --filter @zero2agent/core test
```

### 端到端测试

E2E 测试已迁移到仓库根目录的 [`e2e/`](../../e2e/README.md) 包，被测对象是真实 CLI 进程而非本包的导出。

```bash
# 契约层，不调 LLM
pnpm test:e2e

# 含真实 LLM 层，需要 API KEY
pnpm test:e2e:live
```

配置方式见 [`e2e/README.md`](../../e2e/README.md)。
