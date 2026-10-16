# E04-S002：大工具结果的引用与按需读取

[Epic 4](../README.md) | [首页](../../../README.md) | [迭代日志](../../../CHANGELOG.md)

一份测试日志有几十万字，用户只问最后的证据编号。如果每轮请求都重复带上整份日志，模型还没开始推理，上下文就被重复信息占满了。你需要同时保留完整证据，以及决定这一轮读多少。

E02-S003 已经让终端大输出流式落盘。这里复用它，给终端、读文件、搜索等工具的结果建立统一的引用与回读契约。

## 先看一个完整过程

```text
read_file("large.log") → 约 300 KB 输出
                           ↓ 完整保存与校验
                  tool_result_reference
                  reference / bytes / source / sha256
                           ↓ 模型选择范围
read_tool_result(reference, offset=bytes-512, limit=512)
                           ↓
                  末尾证据 + next_offset + eof
```

你可以先运行[跟练](follow-along.md)。它通过真实 CLI 与本地 HTTP/SSE 服务检查：第一次保存、结束进程、重启回读、更改权限、删除正文。答案来自配对工具结果与文件字节，不以模型一句“已找到”作为验收。

## 三种身份不要混淆

| 字段 | 回答的问题 |
| --- | --- |
| `source.toolCallId` / `toolName` | 这份证据来自哪次工具调用？ |
| `reference` | 当前会话用哪个不透明 UUID 请求读取？ |
| `sha256` / `bytes` | 正文的实际字节有没有改变？ |

不同调用可以产生相同正文；在同一会话中只保存一份内容文件，但各自保留来源和失效时间。模型不能传入任意路径来冒充结果引用。

超过 20 KiB 的新工具结果在进入历史前保存，历史里只保留短回执；工具返回错误或抛出的大错误信息同样处理，`is_error` 继续配对原调用。终端另有超过 800 行的落盘阈值。已有旧会话则保留原始历史，ContextManager 仅在发送视图建立引用，不追溯改写既有事实。

## 为什么按字节读

`read_file` 的行范围仍会先读取整份源文件。一条超长行也可能超过上下文预算。本课新增 `read_tool_result`，按 UTF-8 字节偏移读取，每页默认及最多 4096 字节，最少 4 字节。它不生成额外的 `chunks.jsonl` 副本。

```json
{"reference":"完整 UUID","offset":0,"limit":4096}
```

回执包含 `untrusted_text`、`next_offset`、`eof`、来源及完整结果的哈希。沿 `next_offset` 继续读不会拆开有效 UTF-8 字符；手动偏移落在字符内部会明确拒绝。终端可能输出非法 UTF-8，展示文本以替代字符呈现，同时用 `raw_base64` 保留该页原始字节。

每次读取用固定 64 KiB 缓冲校验整份正文，同时只收集请求的一页及少量字符边界字节。**返回量和内存有界，磁盘 I/O 仍与文件大小相关**。JSON 转义和来源元信息会增加实际回执长度；最终请求继续经过 ContextBudget，回读也消耗 S001 的工具调用额度。

## 引用不保存旧授权

回读走当前 PermissionController。来源保存为原工具读取时的真实路径：工作区内来源可以在 read-only 模式读取，外部来源仍需当前授权；read-only 不允许外部来源。显式 `read_tool_result` 或 `*` deny 规则继续生效。终端结果回读不执行原命令，也不继承旧执行审批。任意 shell 的实际文件来源无法自动枚举，终端结果归属执行工作区；如需禁止其历史数据回读，可使用 read_tool_result deny 规则。

保存的目录身份绑定原工作区。换工作区恢复后无法回读原正文；改坏的快照在替换当前状态前被拒绝。

## 结果何时失效

默认正文在 `~/.zero2agent/results/<工作区哈希>/<会话范围>/` 保存，目录按 0700 创建、文件按 0600 创建。CLI 可用 `ZERO2AGENT_RESULT_DIR` 指定根目录，Core 可通过 `AgentOptions.results` 设置目录或降低容量/时效。

| 默认边界 | 行为 |
| --- | --- |
| 单份 16 MiB | 超限不发布完整结果引用；终端继续排空进程，明确输出不完整 |
| 会话 64 MiB / 128 条引用 | 拒绝继续占用，不静默挤掉有效证据；过期引用元信息也占引用数 |
| 引用有效 7 天 | 到期报 `RESULT_EXPIRED`；新引用可延长共享正文的存储租约 |
| 正文被清理或移动 | `RESULT_MISSING`，不等同原工具没有执行 |
| 大小或哈希不一致 | `RESULT_CHANGED`，不返回可疑正文 |

保存新结果或显式调用 `ResultStore.cleanupExpired()` 时，在写锁内回收当前范围中租约到期的正文。旧快照不能删除另一个新引用仍有效的共享正文。没有后台定时清理；不再使用的会话目录、未封存的后台日志和异常留下的 pending 文件需要人工清理。全机所有会话的总磁盘用量没有全局配额。

会话 JSON 只保存引用目录身份和元信息，正文保留在本机。`--no-save` 关闭会话自动保存，不关闭工具大输出的落盘；若需要一次性隔离，可以给这次运行指定临时结果目录，结束后清理。跨机器迁移需要同时搬运正文；本课没有迁移工具。

## 终端与失败处理

终端执行前先为单份最大输出预留容量；后台仍在写入时保留预留，短命令结束后释放，后台关闭后按实际文件大小计入。容量不足会在启动新命令前拒绝。

已结算的终端输出关闭写流后，通过硬链接把现有 spool 封存为内容文件，再移除 pending 名称。写流施加背压；容量超限或写盘失败会明确报告，不能用部分文件冒充完整结果。取消或 drain 超时的回执仍会说明输出可能不完整。

Ctrl-S 转后台的文件仍在增长，回执标记 `unsealed`，沿用原日志路径和当前文件权限。人工终端的私密输入与输出继续不采集。直接调用底层工具且未注入 ResultStore 的宿主保留原临时路径行为。

工具执行后如果存储失败，错误会说明执行已经结算，副作用未回滚。不能为了重新拿到输出而自动重跑原工具。写锁冲突或异常遗留锁会报 `RESULT_STORE_BUSY`；确认没有活跃写者后才可处理遗留锁，自动恢复执行属于后续课程。

## 代码阅读顺序

1. [result-store.ts](../../../packages/core/src/result-store.ts)：正文身份、存储租约、容量、快照目录与范围读取。
2. [read-tool-result.ts](../../../packages/core/src/tools/read-tool-result.ts) 与 [loop.ts](../../../packages/core/src/loop.ts)：可信来源路径、当前权限、配对回执与运行预算。
3. [terminal.ts](../../../packages/core/src/tools/terminal.ts)：既有流式收集、背压、封存与未封存状态。
4. [session.ts](../../../packages/core/src/session.ts) 与 [context-manager.ts](../../../packages/core/src/context-manager.ts)：新会话引用持久化与旧历史兼容。

[设计总览](details/00-overview.md) | [技术设计](details/01-technical-design.md) | [任务](details/02-task-list.md) | [验收证据](details/03-verification-checklist.md) | [Backlog](details/04-backlog.md)

上一篇：[失败恢复与运行预算](../S001-failure-recovery/README.md) · 下一课：[摘要质量与事实保留（开发稿）](../S003-summary-quality/README.md)
