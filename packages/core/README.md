# @zero2agent/core

Agent 核心逻辑包。

## 多轮会话与上下文压缩

一个 Agent 实例拥有一个进程内 Session，重复调用 `agent.run()` 延续原始历史；每次主请求前根据完整预算组织工作上下文，不保证始终发送全部原文。生产代码 `ea498a3` 未变，最终验收测试 `3829868` 自动验证通过，compact-loop 12/12 及 strict 类型检查通过；功能分支已推送至 `50d1c1a`，真实模型语义质量未验证。

```ts
import { Agent } from '@zero2agent/core'

const agent = new Agent({
  cwd: process.cwd(),
  config: { model: 'claude-sonnet-4-20250514' },
  context: { contextWindow: 200000, maxOutputTokens: 4096, counting: 'conservative' },
})
try {
  await agent.run('先分析测试结构')
  await agent.run('按刚才的建议补测试')
  const changed = await agent.compact()
  console.log({ changed, history: agent.getHistory(), context: agent.getContext() })
} finally {
  agent.cancelCompaction()
}
```

| API | 语义 |
|---|---|
| `run(message)` | 一次 Turn，内部可多次调用模型与工具；同 Session 不能并行 run/compact/reset |
| `compact(): Promise<boolean>` | 前台等候／压缩，返回是否采用新结果；失败抛错，不删除原史 |
| `getHistory()` | 最后已提交原始历史的深拷贝，运行中不含当前未提交轮 |
| `getContext()` | 当前摘要与保留消息的深拷贝，不含 system/tools；不主动计数，也不是获准发送的最终请求 |
| `cancelCompaction()` | 取消压缩与在途计数、使旧操作失效；不撤销工具，不是全局 Turn 取消 |
| `reset()` | 空闲时清空历史及摘要，保留配置与 cwd；不回退文件、不停止命令、不删除临时结果 |

`contextWindow` 对未知模型必须显式配置；仅上述精确模型名默认已知 200000。输入上限需留出主输出／摘要输出与安全空间；计入 system、工具 schema、消息和工具结果。conservative 是 UTF-8 字节保守估算，不是精确 token 数；provider 调用供应商 count API，失败不放行。

默认目标／后台／前台比例为输入预算的 0.45/0.65/0.85。先缩短工具正文并保留完整临时文件；长单行另存 Unicode 切片 JSONL 供 read_file 按行回读。随后后台总结稳定前缀，前台需要时等待并保留新增尾部。自动摘要失败但完整请求仍在硬预算内可继续，超限必须拒绝。摘要输出 token 与字节紧凑目标分别约束，最终发送仍检查完整请求；不承诺摘要无损或任意服务永不拒绝窗口。

静态 `Agent.run()` 和不传 session 的 `runLoop()` 是一次性调用，结束时取消后台摘要；显式持有实例或 Session 的宿主负责退出清理。CLI 的 `CONTEXT_WINDOW`、`MAX_INPUT_TOKENS`、`MAX_OUTPUT_TOKENS`、`CONTEXT_COUNTING` 不由 SDK 自动读取，SDK 使用 `AgentOptions.context`。

摘要可能增加模型费用，退出后会话丢失；临时结果不是持久化保证。更多预算参数、CLI 精确 `/compact` 与无真实模型测试见 [E03-S001](../../specs/E03-product-foundations/S001-multi-turn/README.md)。

## 受控文件副作用

`AgentOptions.fileMutations` 可接收 `FileMutationHandler`。受信任工具用 `Tool.checkpointPaths` 声明参数中代表写入路径的字段；权限允许和路径边界检查后，Core 等待 handler，由它在持久化前置数据后调用 `execute()`，并记录实际结果。接口带 cwd、paths、toolName、toolCallId 及可用的操作/会话身份和取消信号；该元数据不发送给模型。

这是可阻止尚未开始写入的控制接口。handler 失败会形成配对的工具错误；执行后的保存失败可能已有文件效果，宿主需保留恢复证据并明确报告，不重试工具。SDK 默认不配置文件存储；生产 CLI 的实现与可靠性边界见 [S006](../../specs/E03-product-foundations/S006-file-checkpoints/README.md)。

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
