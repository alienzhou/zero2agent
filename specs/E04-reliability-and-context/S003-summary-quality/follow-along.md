# 跟练：发现坏摘要，再回到原始纠正

[课程](README.md) | [技术设计](details/01-technical-design.md) | [验收](details/03-verification-checklist.md)

## 先准备构建

在本仓库根目录使用 Node 22 与 pnpm 9。以下第一组练习不会调用模型，不需要 API key，也不会修改业务文件。

```bash
pnpm install
pnpm build
node researches/summary-quality/offline-demo.mjs
node --test researches/summary-quality/evaluation/scorer.test.mjs
```

## 观察“被采用”与“正确”之间的差别

演示先写入原史：D1 使用端口 8123，D2 明确改为 9237 并禁止部署。后面有足够长的无关记录，让生产 ContextManager 真正采用压缩。

脚本故意把摘要器替换成一个确定性坏摘要：仍说 8123。它足够短、格式合法，宿主不会假装具有自然语言真值判定能力，所以该自由文本可能被采用。随后观察输出：

- `acceptedWrongFreeText` 保留这个错值，证明“采用成功”不足以验收质量。
- `originalCorrectionReintroduced` 为 true，说明再次压缩时从原史重新带入了 9237。
- `recalled.untrusted_text` 是通过查询和完整来源引用读回的原话，带有原角色与分页信息。
- `wrongReportRejectedByOracle` 为 true，固定事实清单会拒绝使用旧端口的结果。

脚本的 oracle 剧本还有第三次纠正，最终值为 9461；前半部分的双纠正示例与评分器的三纠正剧本分别断言，不要把 9237 当成所有剧本的正确答案。修改脚本中的坏端口，观察哪项断言改变；只改摘要不改原史，原史应始终保留。

## 亲自走一遍回查协议

实际模型会调用类似参数，引用必须来自本次会话的真实目录，不能照抄教学中的短写值：

```json
{"query":"port", "cursor":0}
```

搜索用户原话后，以返回的 `reference` 读取：

```json
{"reference":"h2:完整的16位哈希", "offset":0, "limit":512}
```

示意中的中文不是合法引用；用脚本输出中的完整值替换。目录分页仅在 `eof=false` 时沿数字 `next_cursor` 继续；`eof=true` 时 `next_cursor=null`，应停止。新的回查记录本身不构成新的原始证据。单条正文也仅在 `eof=false` 时沿 `next_offset` 继续，偏移按 UTF-8 字节，不能按字符数计算。若要查看工具结果来源，用不带 query 的 cursor 目录，再按引用读取。旧工具缺原来源权限会拒绝新读取，但不会使已经可见的历史观察消失；只有真正的 S002 收据才可交给 `read_tool_result`，不要传 hN:hash 或重跑工具。

工具结果的 `eof=true` 只表示本页已到末尾。如果误把 offset 设为 total_bytes，会得到空页；total_bytes 大于零时，正文并没有消失。v8 候选会附 empty_page_hint：要看末页，用 `tail:true` 且不带 offset，或选较早的字节范围；不要继续递增越界偏移，也不要据空页推断整个结果为空。该提示不自动读取任何额外正文。

## 验证权限与进程边界

```bash
pnpm --filter @zero2agent/core test src/__tests__/history-evidence.test.ts
pnpm --filter @zero2agent/e2e exec vitest run src/history-references.test.ts
```

第二条启动本地确定性 HTTP/SSE 服务，运行五个真正的 CLI 子进程。它先读取一次外部来源，保存会话，再核对用户纠正、原回执、收紧后的当前权限，以及缺少来源目录的旧快照。检查最终历史只有一次原 `read_file` 调用，不能拿模型的“我没有重跑”作为证明。

测试手工写入错误的旧格式交接以覆盖恢复契约，因此它不证明真实模型会生成那份摘要；真实摘要语义由下一组独立评测负责。

## 再跑真实服务对照

配置根目录 `.env.local` 的 ANTHROPIC_API_KEY 与兼容服务地址。使用你自己的输出目录；已有 manifest 不可覆盖。

```bash
node researches/summary-quality/evaluation/run.mjs --run researches/summary-quality/evaluation/my-run
node researches/summary-quality/evaluation/analyze.mjs researches/summary-quality/evaluation/my-run
```

这会产生 56 个真实服务任务，有时间和 token 开销。保持同一模型、相同预算和相同 fixtures，运行期间不要重建该运行使用的 Core dist。0 次组不是“无上下文”，而是携带原始历史；1/3 次组要求实际采用对应次数，额外自动采用视为协议失败。

读 analysis.json 时同时看文件效果、禁止调用、事实错误、来源标签、实际回查、截断与传输失败。不能只读 taskPassed 的总平均值；来源标签命中也不能证明结论真实。缺用量记未知，字节缩小比例不是 token 成本比例。

## 同时查看请求名和回执名

生产诊断的 `model` 取自请求，完整主模型/摘要响应的 `responseModel` 取自 SDK 回执，两者按 requestId 关联。CLI/TUI 日志分别显示 requested-model 和 reported-model；计数、缺失/非法标签及未完成响应不猜测回执名。回执是服务自报，不能当作真实模型身份认证。

不调用外部服务也能验证这条路径：

```bash
pnpm --filter @zero2agent/core test src/__tests__/diagnostics.test.ts
pnpm --filter @zero2agent/e2e exec vitest run src/run-log.test.ts src/runtime-logging.test.ts
```

第一条使用本地 HTTP/SSE 与实际 SDK；第二条检查落盘、凭据过滤、旧日志及 CLI 只读查看。先完成页首构建，再运行依赖 dist 的宿主测试。真实服务另存 [model-identity-live.json.gz（归档）](https://github.com/alienzhou/zero2agent/releases/tag/E04-S003-summary-quality)：两个请求名保持原配置，回执和生产诊断均为 MiniMax-M3。这一次的报告成功不替换正式 v8 的失败，成本单独记录。

## 显式声明产物，再观察一次有界修复

新增能力必须由调用方显式选择，不会从任意 prompt 自动推断 schema。先跑可重复的本地示例：

```bash
pnpm build
node researches/summary-quality/contract-demo.mjs
```

它启动一个本机 HTTP 替身，通过真实 SDK 依次返回“已完成但没有文件”、写入工具调用、完成答复；Core 核对临时目录里的实际 JSON。预期三个请求和 `started → failed → repair → started → passed`，结束时清理本机服务与临时文件。不需要真实 API key，不调用外部模型；它验证机制，不能证明真实模型修复率。

在已有 Agent 上使用同一接口：

```ts
await agent.runWithContract('把实际构建结果写入 artifact.json。', {
  version: 1,
  artifacts: [{
    path: 'artifact.json',
    format: 'json',
    schema: {
      kind: 'object',
      allowAdditional: false,
      fields: {
        build: { kind: 'value', type: 'number' },
        stage: { kind: 'value', choices: ['queued', 'finished', 'unknown'] },
      },
    },
  }],
})
```

`agent` 使用你当前的工作区、工具和权限；契约不会授予写文件权限。构建编号或观察状态仍须由真实证据决定，结构规则不提供答案。读取每个声明文件消耗原回合一个工具额度；仅一个修复阶段，不能通过新建预算、重放旧副作用或自动修改 JSON 获得通过。普通 `agent.run()` 和恢复后的下一回合不会继承这次契约。

新增成对实验将同一份序列化契约交给现有基线和候选，各固定 56 次。`formatArtifactTask` 可以生成基线的同字节输入。原 504 份历史记录保持不变，新增实验的结果与费用单列，见[协议](../../../researches/summary-quality/evaluation/contract-pair-v1/protocol.md)。

## 复查“格式通过、事实仍错”

两组成对完整结果见 [v1](../../../researches/summary-quality/evaluation/contract-pair-v1/README.md) 和 [v2](../../../researches/summary-quality/evaluation/contract-pair-v2/README.md)。v2 候选 55/56，仍有零压缩的事实错误。随后读取纠错版沿用相同输入完整运行 56 次，任务和关键项 56/56、普通事实 63/63，见[最终验收](../../../researches/summary-quality/evaluation/read-recovery-v1/README.md)；不会替换旧失败。

构建后运行 `node --test researches/summary-quality/evaluation/contract-pair-v2/failure-regression.test.mjs`：它读入保留的失败原件，确认结构修复不能覆盖事实评分，再用真实工具接口复现互斥参数拒绝和合法尾页读取。合成正文先按原收据 SHA-256 核对；这是离线重建，不调用模型、不替换失败成绩。


## 保存结果的读取参数纠错

`read_tool_result` 的 `tail: true` 与 `offset` 互斥。参数错误不证明正文不存在；工具返回明确示例，由模型发起新的读取，每次仍重新授权、计入同一回合额度。宿主不自行猜测范围或重放源工具。

`ResultReadRecovery` 只跟踪内置工具抛出的 `ResultReadInputError`。同一引用返回已校验的非空页（或长度确为零的正文）后才能清除 pending；不同引用、EOF 空页或 assistant 声称成功都不能清除。模型准备结束时若仍 pending，宿主在原预算内最多开启一次纠错阶段；仍失败则抛 `EvidenceReadIncompleteError`，结构合法的文件不能将它变成成功。拒绝、取消及失败/未知副作用阻止继续纠错。两个阶段——结构修复和读取纠错——各最多一次，合计仍受原 requests/iterations/tools/duration 上限控制。

纠错反馈只用于发送视图并计入上下文，不保存为新的用户指令。控制状态只属于当前回合，普通下一回合及恢复会话不继承；原错误调用与结果仍留在历史中。`evidence-read` 诊断只保留 invalid-input/correcting/resolved/blocked 阶段，不保存引用或正文。成功读取只证明取得了该页，不认证模型是否正确解释事实。

定向 HTTP/SDK 测试在 `packages/core/src/__tests__/artifact-completion.test.ts` 的 unresolved saved-evidence reads 组，覆盖实际文件、配对、当前权限、预算、取消和恢复；完整同输入真实验证在 `researches/summary-quality/evaluation/read-recovery-v1/` 单列，不覆盖旧失败。


直接运行本机演示：

```bash
pnpm build
node researches/summary-quality/read-recovery-demo.mjs
```

脚本先创建结构合法但值未知的报告，模拟一次非法读取和一句“任务完成”。真实 Core 必须拒绝提前完成，第三个 SDK 请求收到纠错提示，随后正确读取并更新报告。输出 5 个请求、invalid-input → correcting → resolved 及最终实际文件；自动清理临时文件，不调用外部模型。同一脚本在旧 51edb15 运行时仅请求两次就结束，保留错误文件并触发断言失败；前后日志见 acceptance/read-recovery-demo-*。这是确定性机制验证，不充当真实模型评分。

## 按需阅读的实现与验收细节

课程中移出的快照恢复细目见 [技术设计](details/01-technical-design.md)；历史基线、候选与读取纠错版的完整分母、失败和成本见 [验收清单](details/03-verification-checklist.md) 及 [研究资料](../../../researches/summary-quality/README.md)。课程保留“先冻结答案、再公平比较”的方法，不要求记忆每轮实验成绩。
