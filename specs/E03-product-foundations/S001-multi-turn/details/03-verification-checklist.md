# E03-S001：验收检查清单

> 2026-10-01 工程验收通过，代码基线 `04894d5`。P0 必须通过；P1 为补充体验检查。

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
| 真实模型两轮自然语言跟练 | P1 | 未执行；用户可按跟练试用 |

## 工程命令与结果

| 命令／检查 | 结果 |
|---|---|
| `pnpm build` | 通过 |
| `pnpm test` | Core 226、E2E 53、cdp-debug 1，共 280 通过；25 项 E2E 按配置跳过 |
| Core Session 专项 | 27/27 通过 |
| CLI 多轮 SSE 专项 | 4/4 通过，独立测试审查复跑同样通过 |
| E2E TypeScript 检查 | `pnpm --filter @zero2agent/e2e exec tsc --noEmit -p tsconfig.json` 通过 |
| 新增 Core 测试类型检查 | tsc strict / NodeNext / ES2022 / noEmit 检查 session.test.ts 通过 |
| `pnpm lint` | 0 errors / 15 warnings；未新增告警 |
| 改动的 7 个 TypeScript 文件格式 | 通过；未声称全仓格式无历史问题 |
| 文档本地链接与 `git diff --check` | 通过 |

测试入口：[Session 单测](../../../../packages/core/src/__tests__/session.test.ts)、[真实 CLI 契约](../../../../e2e/src/multi-turn-contract.test.ts)。

## 审查闭环

- 代码审查发现不可打印异常会使整批工具结果丢失；安全格式化兜底与三类回归测试已修复，复核关闭。
- 测试审查要求真实半截 SSE 证据；新增 text delta + 半截 tool input + SSE error 路径，确认原文件副作用保留、半截调用未执行、下一轮无片段与原始错误，复核关闭。
- 本次审查范围内无剩余 P0/P1 阻塞，不等于用户人工验收或其他平台认证。

## 已知限制

仅内存会话；无 token 裁剪；重启丢失；不恢复进程；本地 SSE 不能证明远端模型对指代的理解。未新增全局取消操作；进程被杀时内存不可恢复。
