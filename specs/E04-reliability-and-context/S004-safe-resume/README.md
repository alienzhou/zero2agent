# E04-S004：中断后的安全续跑

课程阅读稿经 2026-10-17 审阅，当前含封面 14 页；[查看保留/合并依据](../../../docs/e04-course-reading-review.md)。本轮课程修订待 PR review，下文原交付证据保留其验证版本。

[Epic 4](../README.md) · [离线跟练](./follow-along.md) · [验收](./details/03-verification-checklist.md)

Agent 已经写好第一个文件，宿主却在保存整轮会话前崩溃。重启后，它应该知道第一项已经完成、第二项尚未执行。如果只恢复上一轮对话，就会丢失这段执行事实；如果重新执行整批工具，又可能重复产生副作用。

本课把持久化边界推进到每个工具前后：保存完整响应、保存执行标记、保存真实回执。恢复时展示工具状态，用户核对后明确开启新一轮。实现、回归、跟练与 18 页课程完成最终复核，按用户授权通过 [PR #26](https://github.com/alienzhou/zero2agent/pull/26) 交付；固定版本 `E04-S004-safe-resume`，网站未部署。

## 先观察两个真实进程

在本仓库构建后运行：

```sh
node researches/safe-resume/demo.mjs
```

默认使用本机确定性 HTTP/SSE 服务。进程 A 写入 `first.json`，保存回执后被 SIGKILL；进程 B 从磁盘装载进度，再写 `second.json`。脚本检查两个文件的内容、写入次数、恢复控制状态和最终会话。原始输出在忽略目录 `tmp/e04-s004/`，不修改业务文件，也不需要 API key。

## 恢复时看三种状态

| 状态 | 可以确认什么 | 下一步 |
| --- | --- | --- |
| 未执行 | 未进入持久协议的执行边界 | 保留中断记录，由新的任务决定后续动作 |
| 已结算 | 真实回执已保存，可能是成功也可能是错误 | 恢复调用与回执，不执行旧调用 |
| 效果未知 | 执行标记已保存，但缺少真实回执 | 核对实际文件、相关 Checkpoint 和外部效果 |

执行标记保存后、工具实际调用前也可能崩溃。这个窗口只能报告未知。文件存在或内容相同，只能证明检查时的文件状态，不能补造旧工具的成功回执。

## 查看以后，明确选择继续

```sh
node packages/tui/dist/cli.js --list-sessions
node packages/tui/dist/cli.js --resume <UUID>
```

在 CLI/TUI 中使用 `/recovery` 查看原运行身份、工具状态、关联 Checkpoint、预算的已记录范围及未完成检查。普通提问在待恢复状态下被阻止。核对后输入：

```text
/recovery continue 我已核对第一个文件，完成剩余文件
```

单次调用可用：

```sh
node packages/tui/dist/cli.js --resume <UUID> --resume-task "我已核对效果，完成剩余工作"
```

这会使用当前配置、当前权限和新一轮预算。旧预算的停止事实仍保留；S003 的原产物契约、未解决读取与已经使用的修复机会继续约束任务。加载和查看本身不发模型请求、不重放旧工具。旧进程仍存活或来自其他主机时拒绝抢占。

可以保留中断状态并退出，或 `/new` 开始独立会话。现有 `/diff UUID`、`/undo UUID` 和 `/recover UUID` 仍负责文件检查与回退；`/recovery` 则负责执行恢复，两个入口分工明确。未知 shell 效果需要人工核对，旧进程不会复活。

## 一份完整版本如何发布

Core 通过等待完成的 `ExecutionPersistence` 接口把配对历史、摘要边界、结果与来源目录、恢复控制一起交给宿主。SessionStore 继续采用“写临时文件 → fsync → 独占发布 generation”。保存失败阻止后续工具和模型请求，已经发生的效果与可保留的内存不撤销。

未结算调用的配对占位明确标为宿主中断记录，区别于真实工具回执。同一响应只完成部分工具时，每项分别恢复。重复装载同一份完整版本不会重复追加工具历史。

## 存储与兼容边界

- 单份快照最多 32 MiB；单会话已发布版本合计最多 512 MiB、2048 份。达到门槛会失败并保留证据，不自动删除中断记录。可以另开会话；历史归档和自动压缩留待后续。
- 存储包含对话和工具正文，沿用私有目录 0700、文件 0600，不是加密。诊断日志继续只收集元信息。
- 工具结果正文沿用 S002 的本机生命周期。恢复引用不延长 TTL；缺失、过期、损坏仍明确失败。
- 没有 recovery 字段的旧快照继续可读；旧 pending 会话保持原来的中断提醒，无法补回从未保存过的工具结果。首次保存执行恢复状态会将会话存储版本升级为 2，结算后也不降级；旧程序将明确拒绝读取。
- 本课验证 macOS 本机进程崩溃，不把 SIGKILL 测试等同于断电或所有文件系统保证。

## 代码入口

1. [执行循环](../../../packages/core/src/loop.ts)：保存边界、工具结算、未完成检查。
2. [恢复协议](../../../packages/core/src/execution-recovery.ts)：控制状态、校验、明确的中断占位。
3. [会话存储](../../../packages/tui/src/session-store.ts)：版本发布、冲突、损坏及容量。
4. [宿主恢复](../../../packages/tui/src/conversations.ts)：加载、检查报告与明确续跑。
5. [真实进程回归](../../../e2e/src/safe-resume.test.ts)：SIGKILL、部分批次、文件效果及权限。

[总览](./details/00-overview.md) · [设计](./details/01-technical-design.md) · [任务](./details/02-task-list.md) · [Backlog](./details/04-backlog.md)

上一篇：[摘要质量与事实保留](../S003-summary-quality/README.md)。本课完成 E04 的实现链条，下一阶段是 E05 的 AGENTS、Skills、MCP、Hooks。
