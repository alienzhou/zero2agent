# Gemini CLI：分开工具状态、整轮状态与 shell 焦点

## 基本信息

| 项目 | 值 |
|---|---|
| 官方仓库 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| 调研 Commit | `ef59c532f07fbb3a58dd68bac024ae217e9c73ce` |
| Commit 日期 | `2026-10-06T22:11:30Z` |
| 最近 Tag | 浅克隆深度 100 内无可达 tag，以 SHA 为准 |
| 调研日期 | 2026-10-07（Asia/Shanghai） |
| 证据级别 | 固定源码静态核对；不代表已运行该产品 |

`package.json` 声明 `0.65.0-nightly.20261006.gfb972b2f8`，不能作为稳定版保证。

## 调研目标与结论

核对 TypeScript TUI 的状态聚合、取消和嵌入 shell 输入。工具完成不等于整轮结束；取消包含异步请求和待执行队列；shell 有独立输入焦点。

## 详细分析

### 整轮状态由模型与工具共同决定

[core 状态](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/core/src/scheduler/types.ts#L24-L39)包含 validating、scheduled、executing、awaiting_approval、success、error、cancelled，调用有 callId。[UI 状态](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/types.ts#L49-L54)聚合为 idle、responding、waiting_for_confirmation。[计算逻辑](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/hooks/useGeminiStream.ts#L179-L218)优先显示审批等待；工具 success/error/cancelled 但结果未交回模型时，仍视为 responding。这解释了工具打勾后 Agent 为什么继续工作。

### 工具输出与焦点分别更新

[执行与等待结构](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/core/src/scheduler/types.ts#L132-L179)分别保留 liveOutput/progress 与 confirmationDetails/correlationId。[ToolMessage](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/components/messages/ToolMessage.tsx#L68-L166)按调用 ID 查询展开状态，并只在有数据时显示进度；没有 total 时不可编造百分比。

### 取消清理待执行队列

[cancelOngoingRequest](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/hooks/useGeminiStream.ts#L837-L927)先 abort，再 cancelAllToolCalls，整理待显示历史。[Escape 处理](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/hooks/useGeminiStream.ts#L944-L959)还要求 shell 未聚焦。这是该处理器的证据，不是所有系统进程都能立即结束的保证。

### PTY 接收器有 focus 条件

[ShellInputPrompt](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/components/ShellInputPrompt.tsx#L22-L95)检查 focus 与 activeShellPtyId；焦点切换键向上冒泡，其余按键转 ANSI 后送 writeToPty。这条嵌入 shell 路线比本项目临时完整交接终端更复杂。

## 关键源码与参考

[依赖清单](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/package.json#L48-L62)使用 React 19 与 `npm:@jrichman/ink@6.6.9`，是定制 Ink 分发，不能等同上游。[官方快捷键](https://geminicli.com/docs/reference/keyboard-shortcuts/)说明 Ctrl+C、Esc 和 shell 焦点；动态文档与 pinned nightly 可能不同步。
