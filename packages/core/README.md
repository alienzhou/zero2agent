# @zero2agent/core

Agent 核心逻辑包。

## 多轮会话与上下文压缩

一个 Agent 实例拥有一个进程内 Session，重复调用 `agent.run()` 延续原始历史；每次主请求前根据完整预算组织工作上下文，不保证始终发送全部原文。原史与发送视图分离；当前分支包含 S003 摘要来源候选，工程回归与真实语义评测分别记录，不保证任意摘要无损。

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

默认目标／后台／前台比例为输入预算的 0.45/0.65/0.85。新结果与旧历史大正文优先转换为 S002 结果引用，按 read_tool_result 分页回读；未注入结果存储的低层调用保留原临时路径兼容行为。随后后台总结稳定前缀，前台需要时等待并保留新增尾部。自动摘要失败但完整请求仍在硬预算内可继续，超限必须拒绝。摘要输出 token 与字节紧凑目标分别约束，最终发送仍检查完整请求；不承诺摘要无损或任意服务永不拒绝窗口。

静态 `Agent.run()` 和不传 session 的 `runLoop()` 是一次性调用，结束时取消后台摘要；显式持有实例或 Session 的宿主负责退出清理。CLI 的 `CONTEXT_WINDOW`、`MAX_INPUT_TOKENS`、`MAX_OUTPUT_TOKENS`、`CONTEXT_COUNTING` 不由 SDK 自动读取，SDK 使用 `AgentOptions.context`。

摘要可能增加模型费用；SDK 宿主需显式保存/恢复快照，CLI 支持会话持久化。快照不内嵌 S002 大正文，正文目录有独立租约与容量限制。更多预算参数、CLI 精确 `/compact` 与无真实模型测试见 [E03-S001](../../specs/E03-product-foundations/S001-multi-turn/README.md)。

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

## 大结果引用

默认工具新增 `read_tool_result`。Agent/Session 为大于 20 KiB 的工具结果提供本机有界存储与版本化引用；终端在 800 行或 20 KiB 后复用原流式输出封存。回读按 UTF-8 字节范围分页，最多 4096 字节，重新检查来源权限与 SHA-256，消耗当前工具预算。S003 候选另支持 `tail:true` 直接读末页，与 offset 互斥；返回实际字节范围，首行不完整时给出提示，权限和校验规则相同。

可通过 `AgentOptions.results` 设置私有 `directory`，或降低 `maxResultBytes`（默认 16 MiB）、`maxTotalBytes`（64 MiB）、`maxResults`（128）、`ttlMs`（7 天）。快照不含正文；新进程需要原工作区和结果目录。`RESULT_MISSING`、`RESULT_EXPIRED`、`RESULT_CHANGED` 都不授权重跑源工具。生命周期和后台未封存范围见 [S002 课程](../../specs/E04-reliability-and-context/S002-result-references/README.md)。

## 历史来源回查（S003 候选）

默认工具新增 `read_history`：query 仅做用户原话的字面匹配，不带 query 列举有界来源身份；按 reference/offset/limit 读取带原角色的原文，每页最多 4096 UTF-8 字节。目录最多扫描 64 条消息，单条记录最多 2 MiB。工具正文按原来源路径重新检查当前权限；旧快照无该绑定时明确拒绝工具正文，用户原话仍可查询。Session 快照带可选的 history.version=1 来源目录，校验完成后才替换状态。

模型交接仍可记错，宿主索引至多 4096 字节并显示遗漏。长未压缩历史（当前用户输入之前超过 16 KiB）添加来源提醒，新增成本也参与预算。v2 真实任务 49/56、v3 为 47/56，原质量门槛均未达到；复现与边界见 [S003](../../specs/E04-reliability-and-context/S003-summary-quality/README.md)。

v3 候选将已经完成且组合后满足最终字节/输入预算的分块按顺序保留，避免额外生成；超限仍进一步压缩。行内未结束的结果页增加 `continuation_hint`。已知采用失败在 CompactionEvent.failureReason / DiagnosticEvent.compactionFailure 中报告有限分类，未知原因留空，不输出异常正文。上述机制已通过工程测试，v3 完整任务结果 47/56，不能宣称有整体语义收益。

v4 在发送视图中显式包住当前用户请求，避免旧等待状态覆盖新请求；用户给定事实和要求无需工具执行证明，工具正文不成为许可。预算按实际发送视图计算，原史与权限不变。v4 完整对照 52/56，关键项及普通事实仍未达到原门槛。

S003 v5 开发候选对截断摘要最多重新生成一次：丢弃全部截断文本，从原始片段请求更短的完整交接，使用相同模型和硬上限，计入现有请求预算。再次失败直接拒绝，不重放工具。v5 完整对照 50/56，普通事实 59/63，仍未通过原门槛。

v6 开发候选在长/压缩会话的完整回查结果后附加原始当前纯文本任务，整块最多 4096 字节，超限或非文本任务跳过；只改发送视图并计入预算，不添加新授权。目录 EOF 的 next_cursor 为 null，避免继续追读回查自身；旧工具拒绝信息区分历史引用与存储收据。v6 完整对照 49/56，关键项 52/56，普通事实 58/63，仍未过线。

v7 保留上述边界，让原始当前请求位于消息末尾，不再添加结束标记；提醒明确用户禁令不依赖工具执行证明。完整同条件评测为 49/56，仍存在字段错误、状态混淆和请求取消，原门槛未过。

v8 为非空工具正文的 EOF 空页增加 empty_page_hint，说明空的是当前范围，可以用 tail:true（不带 offset）读末尾或请求较早范围。原范围、权限与校验不变，真正空正文不附提示。675 项工程测试通过，完整语义对照 52/56；普通事实 60/63 达线，但关键项 53/56 未全过。整轮未触发新空页提示，不能把分数变化归因于它。
