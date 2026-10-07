# 从竞品输入体验推导本课交互

2026-10-07。运行状态只有在用户能编辑、检查和介入时才有意义。本报告把固定源码、官方文档和两款产品真实 PTY 观察对照，完整操作见 [实机记录](./observations/2026-10-07/README.md)。未执行模型任务，审批、忙时草稿和工具折叠以源码/文档为证，不写成实测通过。

## 一份输入不只有字符串

输入还包含光标位置、选择、粘贴区、历史遍历位置和草稿。Codex 的 [ChatComposer 概述](https://github.com/openai/codex/blob/5a3140176e668a2f72f3c098490eb7f7052d9d85/codex-rs/tui/src/bottom_pane/chat_composer.rs#L72-L149)区分历史、草稿、粘贴占位以及提交/排队；Gemini [useInputHistory](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/hooks/useInputHistory.ts#L35-L97)缓存每个历史位置的文本与光标，-1 表示未提交草稿。

本课建议把 input buffer 单独建模：浏览历史前保存草稿，回到最新位置恢复；界面更新状态不覆盖 input buffer；取消运行不等于清除草稿。这样比只把 readline.question 换成漂亮边框更能改善使用体验。

## 交互对照与本课选择

| 交互 | 证据 | 本课可执行的选择 |
|---|---|---|
| slash 可发现性 | Codex /stat 可筛到 /status；OpenCode /he 出现 /help 等候选，均实测 | 输入 / 展示命令名和用途；Tab 补全；Esc 只关候选并保留输入 |
| 多行粘贴 | 两产品 bracketed paste 不直接发送；OpenCode 三行变占位，两行原样保留，均实测 | 支持 bracketed paste 原子输入；Ctrl+J 换行；手动 Enter 才发送，不必首版做大文本占位 |
| 行编辑 | Codex Ctrl+A 后插入文字位于当前行开头，实测 | 支持左右、Home/End、Backspace/Delete 和常见 readline 编辑键 |
| 输入历史 | Codex Up 找回已执行的本地 /status，实测；Gemini 缓存草稿与光标为源码证据 | 上下键在适当行边界进入历史，回到底部恢复原草稿；审批答案和 PTY 输入不进聊天历史 |
| 草稿跨视图保留 | Codex Ctrl+R→Esc、OpenCode Ctrl+P→Esc 均还原原草稿，实测 | 详情/帮助/审批临时取得焦点，结束后恢复；不要用组件重挂载清空输入 |
| 忙时输入 | Claude 文档允许消息排队；Codex 源码区分 Enter 与忙时 Tab；Gemini 限制部分 slash/shell 并发 | 忙时可编辑，提交策略明确；不支持队列时保留草稿并提示，禁止静默丢弃 |
| 工具详情 | Gemini ToolMessage 按 callId 查询展开状态；OpenCode 有 tool_details 动作，源码证据 | 默认摘要含工具名、调用身份、状态、耗时；详情可展开和滚动，完整审批参数始终可达 |
| 审批与取消 | 各产品的焦点条件见本目录报告 | 审批 y/n 只对应当前请求；Ctrl+C 取消轮次走控制接口；PTY 模式显示另一套帮助 |
| resize | 两产品 100→44→100 列后草稿仍在，实测；Gemini useTerminalSize 监听 resize | 重新按列宽排版，优先保留输入与关键状态，缩短次要路径；中文/emoji 按显示宽度计算 |

Gemini 忙时提交条件见 [InputPrompt](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/components/InputPrompt.tsx#L445-L490)，尺寸监听见 [useTerminalSize](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/cli/src/ui/hooks/useTerminalSize.ts#L9-L29)。OpenCode 的 [默认键位](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/tui/src/config/keybind.ts#L149-L200)覆盖详情、换行、历史；键位存在不等于本轮已实测该动作。

## 两款产品给出的具体启发

Codex 在窄屏缩短底部目录，保留三行输入；OpenCode 把命令菜单放在输入上方，显示名称与说明，不要求用户背 slash 命令。两者都把当前输入视为需要保护的数据，打开其他视图后仍可回来继续写。

因此本课的可见成果应是一段连续操作：输入 / 找命令，粘贴多行并修改，运行时留下草稿，检查工具详情，审批后继续，取消后恢复输入，最后在人工终端与 Agent 之间交接。每一环都用真实 PTY 验证，而不是只给状态 reducer 写单元测试。
