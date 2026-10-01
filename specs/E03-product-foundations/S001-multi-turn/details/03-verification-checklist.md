# E03-S001：验收检查清单

> 多轮、自动分级压缩和手动 `/compact` 已实现。生产代码 `ea498a3` 未变，最终验收测试候选 `3829868` 已本地提交、未推送，全量复跑通过；旧多轮版本 `a5f72f7` 已推送。两项强化用例已纳入最终 379 项通过结果。真实模型试用未执行。

## 当前合并范围：3829868 验收测试通过（生产代码 ea498a3）

以下结果由本期工程全量复跑记录同步，范围为已覆盖的本地 mock、HTTP/SSE 与 CLI 场景，不证明真实摘要语义质量或任意提供商永久不超限。

| 检查项 | 级别 | 3829868 验收证据入口 |
|---|---|---|
| 旧多轮、工具配对、失败与隔离契约不回归 | P0 | 通过，session / loop / multi-turn-contract |
| 未知模型必须配置窗口，非法预算与阈值拒绝 | P0 | 通过，context-budget |
| system/tools/messages、多字节内容、输出安全预留纳入预算 | P0 | 通过，context-budget 与 CLI 请求快照 |
| provider count API 失败／超时不放行主请求 | P0 | 通过，context-budget |
| 大工具原文保留，长单行 JSONL 可用 read_file 读到末尾 | P0 | 通过，context-manager |
| 自动后台启动、前台等候／压缩、每次请求闸门 | P0 | 通过，context-manager / compact-contract |
| 稳定前缀采用保留尾部，取消与 reset 丢弃过期摘要 | P0 | 通过，context-manager / compact-contract |
| 摘要 token 与字节目标分离，输入分块及重试有界 | P0 | 通过，context-summary |
| 空摘要、截断、非文本、非缩减与普通异常不算成功 | P0 | 通过，context-summary / context-manager |
| 自动前台摘要失败：硬预算内可继续，超出必须拒绝 | P0 | 通过，context-manager；含固定提示占比高场景 |
| 最新输入及固定指令单独超限时拒绝，不静默截断 | P0 | 通过，context-manager |
| compact 与 run/reset 互斥，快照深拷贝 | P0 | 通过，session / compact-loop |
| 在途计数可取消，立即取消不启动后续计数 | P0 | 通过，context-manager |
| 精确 /compact 本地处理；变体仍是普通输入 | P0 | 通过，compact-contract |
| 手动失败续聊、/new 清摘要、长对话请求预算 | P0 | 通过，compact-contract |
| 主模型窗口拒绝最多两次恢复，不重放已完成工具 | P0 | 通过，compact-loop |
| CLI 配置与退出；一次性 Agent.run / runLoop 清理摘要 | P0 | 通过，CLI 契约 / compact-loop |
| 真实模型自然语言与摘要质量体验 | 可选 | 未执行；不是自动验收必过项，需单独确认费用与数据边界 |

### 最终工程结果（2026-10-01，验收测试3829868／生产代码ea498a3）

| 命令／专项 | 实测结果 |
|---|---|
| `pnpm build` | 生产代码基线检查通过；补测未改生产代码 |
| `pnpm test` | Core 316、E2E 62、cdp-debug 1，共 **379 通过**；25 项真实模型测试缺 API 配置跳过 |
| context-budget / context-summary / context-manager / compact-loop | 分别 29 / 20 / 22 / 12 项通过；属于上述总数，不重复相加 |
| Session 回归 | 34 项通过，属于上述 Core 总数 |
| E2E TypeScript | `pnpm --filter @zero2agent/e2e exec tsc --noEmit -p tsconfig.json` 通过 |
| `pnpm lint` | 0 errors / 15 既有 warnings |
| compact-loop strict 类型检查 | 通过，包含最终新增的两项用例 |

补测前 `ea498a3` 曾记录 Core314、E2E62、cdp-debug1，共377通过、25跳过，compact-loop为10项；此记录保留作阶段历史，最终结果以上表为准。

### 两项强化验证已通过

1. **恢复上限与副作用**：本地受控模型响应连续拒绝上下文，执行两次真实恢复逻辑后，第三次拒绝停止；已完成工具的副作用仅发生一次。不是把 recoverContext 简单替换为成功返回，也不代表真实供应商模型测试。
2. **混合批次与前后台交接**：成功／失败混合工具批次完成后，保持后台摘要 pending，追加新的完整工具对；模型随后失败，前台接管等待并采用摘要，验证历史中的成功、失败及增量证据保留。

18 页图文已逐张检查主图与手机图，零溢出、零孤字；图片包与可编辑源包已完成，10 项打包保护测试、5 个预览视口和 41 个链接通过。源包独立安装重建后，38 张 PNG 与已审版本逐字节一致；依赖锁定为公开 npm 源，空缓存安装验证通过。课程仍仅本地成稿，未对外发布。

本轮文档更新只同步上述已报告结果，并检查本地链接与 diff；没有重新执行工程测试或真实模型请求。

### 可复现的无真实模型命令

从仓库根目录执行；先安装依赖，E2E 前必须重建。不要设置 `E2E_LIVE=1`，不使用 test:live。

```sh
pnpm --filter @zero2agent/core test -- src/__tests__/context-budget.test.ts src/__tests__/context-summary.test.ts src/__tests__/context-manager.test.ts
pnpm --filter @zero2agent/core test -- src/__tests__/session.test.ts src/__tests__/loop.test.ts src/__tests__/compact-loop.test.ts
pnpm build
pnpm --filter @zero2agent/e2e test -- src/multi-turn-contract.test.ts src/compact-contract.test.ts
pnpm --filter @zero2agent/e2e exec tsc --noEmit -p tsconfig.json
pnpm lint
```

专项之后运行 `pnpm test` 完整回归，分别记录通过、失败、跳过和环境条件。修改代码或追加测试后必须标明新基线，不沿用 `ea498a3` 的数字。单测 mock 与本地 HTTP/SSE 契约验证结构及预算，不证明真实摘要的语义质量；真实试用参见[跟练](../follow-along.md)。

源码入口：[预算测试](../../../../packages/core/src/__tests__/context-budget.test.ts)、[摘要测试](../../../../packages/core/src/__tests__/context-summary.test.ts)、[管理器测试](../../../../packages/core/src/__tests__/context-manager.test.ts)、[压缩循环集成](../../../../packages/core/src/__tests__/compact-loop.test.ts)、[CLI 压缩契约](../../../../e2e/src/compact-contract.test.ts)。

### 本次实现修正

- 分离摘要输出 token 与 UTF-8 字节紧凑目标，摘要作为后续输入重新计数，采用时再计入完整 system/tools/尾部。
- 计数与摘要共享可取消的操作生命周期，立即取消后不再继续启动新计数；过期结果不写回。
- 固定提示高占比不应把软阈值变成硬拒绝；自动前台摘要失败后仍须计数，硬预算内可继续，超限拒绝。
- 长单行工具正文额外保存 Unicode 字符切片 JSONL，保留原文件并用既有 read_file 验证末尾可读。
- 静态 Agent.run 与未传 Session 的 runLoop 在结束时取消无主后台摘要；持有会话的宿主负责退出清理。

## 历史记录：仅旧多轮范围

以下为 2026-10-01、代码基线 `b615f01` 的原验收记录，曾替代 `04894d5` 的旧记录；并非对 `a5f72f7` 之后压缩增量的复验。表中“通过”均限定为当时旧范围。

| 检查项 | 级别 | 实际证据 |
|---|---|---|
| 第二轮包含第一轮请求、最终回答及工具对 | P0 | 通过，SDK 快照与 CLI SSE 请求断言 |
| 两个 Agent、静态调用与默认 runLoop 隔离 | P0 | 通过，Session 单测 |
| reset 清空；运行中 reset / run 拒绝 | P0 | 通过，Session 单测 |
| 返回快照与观察者／工具参数不可修改历史 | P0 | 通过，深层修改测试 |
| 工具执行后网络错误仍保留回执，下一轮可用 | P0 | 通过，单测、HTTP 400 与真实 SSE error |
| 工具错误与同步／异步通知异常不破坏配对 | P0 | 通过，含三类不可打印异常 |
| 截断调用不执行，迭代上限不留悬空调用 | P0 | 通过，Session 单测 |
| `/new` 不发模型请求，之后只含新对话 | P0 | 通过，真实 CLI + 本地 SSE |
| 既有 CLI、terminal 与 PTY 契约不回归 | P0 | 通过，本机完整测试集 |
| exit 在输入管道保持打开时独立退出 | P0 | 修复前失败；修复后真实 CLI 回归通过，不依赖 EOF |
| 空模型响应同时进入历史、返回值与界面提示 | P0 | 修复前失败；修复后单测通过 |
| 已有历史时运行中快照稳定、配置保留、连续失败恢复 | P0 | 新增单测通过 |
| reset 不杀已登记后台进程、不删除已有日志 | P0 | 实际子进程、日志文件与登记表断言通过 |
| /new extra、/newish 不清空会话 | P0 | 真实 CLI 请求快照通过 |
| 真实模型两轮自然语言跟练 | P1 | 未执行；用户可按跟练试用 |

### 旧工程命令与结果

| 命令／检查 | 结果 |
|---|---|
| `pnpm build` | 通过 |
| `pnpm test` | Core 232、E2E 55、cdp-debug 1，共 288 通过；25 项 E2E 按配置跳过 |
| Core Session 专项 | 33/33 通过 |
| CLI 多轮 SSE 专项 | 6/6 通过，包含保持输入打开的退出测试 |
| E2E TypeScript 检查 | `pnpm --filter @zero2agent/e2e exec tsc --noEmit -p tsconfig.json` 通过 |
| 新增 Core 测试类型检查 | tsc strict / NodeNext / ES2022 / noEmit 检查 session.test.ts 通过 |
| `pnpm lint` | 0 errors / 15 warnings；未新增告警 |
| 改动的 7 个 TypeScript 文件格式 | 通过；未声称全仓格式无历史问题 |
| 文档本地链接与 `git diff --check` | 通过 |

测试入口：[Session 单测](../../../../packages/core/src/__tests__/session.test.ts)、[真实 CLI 契约](../../../../e2e/src/multi-turn-contract.test.ts)。

### 旧审查闭环

- 完整复核发现旧 CLI 只关闭 readline，保持 stdin 管道打开时输出“再见”仍不退出。先增加失败测试，再在后台清理完成后销毁非 TTY 输入，保留 TTY 行为；重建与全部 CLI／PTY 测试通过。
- 空响应原先只留下历史占位、返回空字符串，用户无法看到说明；补上返回值和 onText 通知并完成红绿验证。
- 旧复核新增配置、非空快照、连续失败、后台进程与日志、命令精确匹配测试；当时不含压缩。本期已纳入压缩，须独立验收，不沿用旧排除范围。
- 课程跟练加入可操作的测试骨架与红绿练习；图文补循环出口、术语中文释义、快照语义和安装前置，来源与版本同步。

- 代码审查发现不可打印异常会使整批工具结果丢失；安全格式化兜底与三类回归测试已修复，复核关闭。
- 测试审查要求真实半截 SSE 证据；新增 text delta + 半截 tool input + SSE error 路径，确认原文件副作用保留、半截调用未执行、下一轮无片段与原始错误，复核关闭。
- 旧审查范围内当时无剩余 P0/P1 阻塞，不等于当前压缩范围无阻塞，也不等于人工验收或其他平台认证。

## 当前已知限制

仅内存会话，原始历史仍会增长；摘要是有损上下文，不保证语义无遗漏。默认 UTF-8 字节计数是保守估算，不是精确 tokenizer；provider 模式要求服务支持计数。临时结果文件不是持久化保证，进程重启不恢复会话或后台任务。仅承诺文本／工具消息，不承诺多模态压缩。最新输入及固定开销过大时仍会拒绝请求；取消不能退回已产生的 API 费用。本地服务不能证明远端模型理解或摘要质量，未新增全局取消 UI。
