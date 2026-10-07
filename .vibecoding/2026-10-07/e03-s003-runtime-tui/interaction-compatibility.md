# 旧 CLI 到运行状态 TUI 的兼容审计

2026-10-07。以 `caa47ea:packages/tui/src/cli.ts` 为旧入口，逐项对照当前 `cli.ts`、`runtime-tui.ts`、`approval.ts`、`setup-terminal-runtime.ts`、`human-terminal.ts` 和 Core Agent/Session。常用编辑修复为 `f4e6a42`，超长粘贴原子拒绝与明确反馈修复为 `5c8ed60`。只枚举仓库中真实存在的能力，不把其他 Agent 产品或开发环境中的能力当成本项目已实现功能。

## 业务入口与配置

| 旧能力 | 新 TUI 的行为 | 验证依据 / 结论 |
| --- | --- | --- |
| 无位置参数交互模式 | 双端 TTY 默认 TUI；复用同一个 Agent/Session。`--plain` 显式进入原 readline；非 TTY 或 `TERM=dumb` 自动走原分支。 | CLI 路由源码对照；旧 CLI 契约和新增默认 TUI 真实 PTY测试。路由改变为本课设计，旧分支保留。 |
| 单个位置参数任务 | 仍只取首个位置参数执行一次，不启动全屏 TUI，失败退出码 1。新增 `--plain` 可在此前缀下使用。 | `cli.ts` 与 `cli-contract.test.ts`。保留。 |
| `--terminal [command...]` | 仍在 API key 检查前执行独立人工终端；无命令启动 bash；返回子进程退出码、拒绝/取消/信号对应状态。 | 此入口代码保留，`human-terminal-contract.test.ts` 覆盖无 key、无 TTY、退出码与信号。 |
| 空输入 | 忽略，不发模型请求。 | 两个入口均 `trim` 后检查；旧 CLI 契约与 TUI 输入实现。 |
| `exit` / `quit` | 关闭 TUI、恢复终端，然后按既有规则处理后台进程清理。 | 所有 TUI 用例正常退出；新增默认 shell 用例以 `quit` 结束。 |
| `/new` | 清空会话和界面记录，不撤销文件，不杀后台进程，不发模型请求。 | 既有多轮契约、新 TUI reset 测试、真实模型 reset、新增后台进程存活断言。 |
| `/new extra` / `/compact extra` | 只有精确命令被本地处理；带额外内容的这些输入仍作为用户消息。 | 两个入口的精确字符串判断一致；旧多轮契约明确覆盖 `/new` 带参数。 |
| `/compact` | 仍调用同一个 Agent.compact，显示压缩事件及成功/无可压缩历史结果。新增 Ctrl-C 取消操作，历史证据保留。 | TUI 真实 SDK/SSE 的手动压缩用例；Core 实际 HTTP 覆盖 count/manual/automatic summary 取消。 |
| `/terminal [command]` | 仍直接执行用户请求的人工交接；无参数为交互 bash。宿主保留确认，结束后恢复 TUI 和草稿。 | 新 TUI 直接 handoff、默认 bash/Ctrl-D、跨粘贴交接、连续两次交接用例。 |
| `.env.local` 和跳过加载开关 | 文件位置和 `ZERO2AGENT_SKIP_LOCAL_ENV=1` 规则相同。 | `loadLocalEnv` 未改变。 |
| 模型配置 | `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`MODEL_NAME` 仍进入同一个 Core SDK 客户端。 | CLI/LLM 源码；本地 SSE 与实际模型测试都走生产入口。 |
| 上下文预算 | `CONTEXT_WINDOW`、`MAX_INPUT_TOKENS`、`MAX_OUTPUT_TOKENS`、`CONTEXT_COUNTING` 仍传给同一 Agent。自动 pruning/background/waiting/foreground/completed/failed 事件都有中文展示。 | CLI 配置源码与 `compactionLabel` 对照；Core 上下文测试保留，新 TUI 手动 compact 通过。 |
| 权限模式 | default、read-only、accept-edits、bypass 使用同一个 PermissionController；TUI 仅替换 requestApproval 宿主。 | 既有权限契约；新增默认 TUI 的 read-only、accept-edits、bypass 真实文件效果检查。 |
| 精确权限规则 | `PERMISSION_RULES` JSON 原样传入。deny/ask/allow 优先级及工作区硬边界仍由 Core 处理。 | 新 TUI 中 accept-edits + 精确 deny 规则仍拒绝写入；既有权限与路径边界测试。 |
| 审批内容与决定 | 完整工具名、调用身份、cwd、原因、JSON 参数可滚动查看；y 允许本次，n/Enter/Esc 拒绝。旧版 y+Enter 改为明确标识的单键操作，不扩大为会话永久授权。 | 真实 TUI 批准/拒绝、参数末尾滚动、粘贴 y 不批准、草稿恢复用例。 |
| 审批超时 | `APPROVAL_TIMEOUT_MS` 保留；超时关闭对话，Core 收到拒绝回执。超时后、下一审批出现前的晚到 y 进入未发送草稿，不能自动批准下一调用。 | 新增 500ms 真实超时 → 晚 y → 下一独立审批 → n 的 PTY用例，两份文件均未写入。 |
| 多轮与错误恢复 | 同一 Session 连续运行；失败后回到输入框，已完成的工具结果与文件保留，下轮包含配对证据。 | 新增 write_file 完成后 HTTP 400，再发送下一轮；检查文件和下一请求的 tool_result。 |
| 文件与 shell 工具 | read_file、list_directory、grep_search、find_files、write_file、delete、replace_in_file、terminal 注册列表未改变。TUI 用结构化工具事件展示它们。 | `allTools` 和 CLI Agent 创建路径对照；旧工具测试、真实模型读写、TUI 实际文件/终端副作用断言。 |

## 终端输入和进程交互

| 旧能力 | 当前行为与覆盖 |
| --- | --- |
| 输入编辑 | 左右、Home/End、Ctrl-A/E、Ctrl-B/F、Backspace/Delete 保留；中文、组合音标、emoji 使用字素边界。Home/End、Ctrl-A/E 在多行草稿中按逻辑行移动。 |
| Ctrl-U/K/W/Y | 审计发现原 TUI 缺 Ctrl-K/Y，已在 `f4e6a42` 补齐。Ctrl-U 剪切光标前文、Ctrl-K 剪切至行尾、Ctrl-W 剪切前词、Ctrl-Y 恢复最近剪切内容；真实 PTY 逐字检查传给 API 的中文/组合字符/emoji。 |
| Ctrl-D | 非空草稿前向删除一个完整字素，空闲空草稿退出。人工 PTY 期间传给子程序，默认 bash 退出后宿主仍可接收 `quit`。 |
| 历史和草稿 | 上下键在多行中移动，到输入首/尾逻辑行后浏览最多 50 项历史；离开历史可找回未发送草稿。运行过程中也可编辑草稿，完成后才发送。 |
| 多行粘贴 | 新增 bracketed paste 与 Ctrl-J；粘贴换行不提交，粘贴结束后 Enter 发送。审批期间粘贴不成为 y 授权；人工 PTY 接管清理粘贴状态并保留公有草稿。 |
| Ctrl-X | 仍只停止当前前台 shell 命令，Agent 随后能读取取消回执并继续本轮。新增真实 shell/SDK/PTY用例验证下一请求发生，进程已退出。 |
| Ctrl-S | 保留运行 10 秒后转后台的规则；Ctrl-S 只在前台 terminal controller 存在时处理。新增真实进程测试确认转后台后进程存活，`/new` 不杀它。 |
| 后台退出询问 | TUI 先释放 raw input / alternate screen，再复用既有“要一并结束吗？”询问。新增测试选择 y 后宿主正常退出、后台进程消失。选择 n 的原实现与原规则没有被替换。 |
| Ctrl-C | 本课明确调整为运行中取消整轮、保留草稿与已发生副作用；空闲先清草稿，空草稿再退出。人工终端期间仍只送给子程序，TUI 不抢键。 |
| 人工 PTY 私密性 | 宿主确认、Ctrl-C/Ctrl-D、Ctrl-]、resize、进程清理仍由原 human-terminal 处理；新包装只 suspend/acquire。两次模型触发 handoff 后，审计全部后续 API 请求，只有状态回执，没有私密输入/输出。 |
| EOF / 信号 / 终端恢复 | 非 TTY 沿用原 readline 的 EOF 防重入；TUI end/error/SIGTERM/SIGHUP 进入释放路径；exit handler 兜底恢复。新增 TUI SIGTERM 等待模型时退出 143 并恢复终端序列；底层人控终端原信号/断连契约仍保留。 |

## 不能冒称已迁移的内容

- **没有旧 Agent skills 入口**：基线 CLI 没有 `/skills`、`load_skill`、SKILL.md 自动发现/注入或技能选择器。`packages/cdp-debug/skills/SKILL.md` 是供 Cursor 等外部宿主使用的静态技能；其 `cdp-debug resume` 是调试器继续执行命令，不能算作本 CLI 的会话恢复。
- **没有旧持久化 resume**：Session 是内存会话；旧 CLI 没有 `/resume`、会话列表、磁盘保存或恢复选项。本课也未新增这些能力。
- **新增 `/help` / Tab / 工具详情**：这些是本课的新入口，不是对旧命令的改名。旧未知 slash 文本仍可作为普通用户输入。
- **不等于完整 readline 仿真**：旧 readline 隐含的 Ctrl-T 转置、Alt 词移动/删除、Ctrl-Z 作业控制和多项 kill ring 等高级编辑键没有全部移植。旧 readline 仍可通过 `--plain` 使用；本课优先迁移并验证上述常用编辑组合。
- **显示和输入有容量边界**：界面保留最多 100 条/约 120,000 字符历史，长条目显示明确截短提示；这不改变 Core 会话历史。草稿上限为 16,384 个 UTF-16 单元，`/help` 明示此限制。超限时显示提示并保留原草稿/光标；bracketed paste 使用独立有界缓冲，整段超限粘贴被拒绝，不留下可误提交的半段。与旧 readline 不设同样上限存在差异，不能将新界面描述为无限输入或无限回看。

## 本次复验

- `07963ad` 增加旧交互在默认 TUI 下的实测：权限模式/精确规则、默认 bash 和 Ctrl-D、Ctrl-X/S、后台退出清理、传输错误后继续。20 项该测试文件用例通过。
- `f4e6a42` 补常用编辑兼容后，`runtime-tui-state.test.ts` 与 `runtime-tui.test.ts` 合计 **26 项通过（20.62s）**；TUI build、E2E `tsc --noEmit` 通过。
- `5c8ed60` / `7ebf9e0` 补超长粘贴保护后，以上两文件合计 **27 项通过（20.71s）**；其中真实 PTY 输入 17,000 字符的 bracketed paste，断言提示出现、没有 API 请求、原中文/emoji 草稿和中间光标保留，之后发送的内容完全准确。TUI build、E2E 类型检查与新 TUI 源码 ESLint 均通过。
- 没有重复运行整库测试。最终全量结果与最新源码哈希由主代理的验收记录负责，不以本次定向验证替代。
