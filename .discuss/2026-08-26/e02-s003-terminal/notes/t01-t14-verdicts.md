# T01–T14 裁决建议（含理由）

> 服务对象：E02-S003（terminal）｜依据：[五竞品调研](../../../../researches/terminal/README.md)
> ＋ [non-interactive-execution-env.md](./non-interactive-execution-env.md)
> ＋ [production-agent-lessons.md](./production-agent-lessons.md)
>
> 状态：**建议**，未逐条确认。确认后迁入 [outline.md](../outline.md) 的 `Confirmed`。

| # | 议题 | 建议裁决 | 一句话理由 |
|---|---|---|---|
| T01 | 工具名与参数 | `terminal`；参数 `command`（必填）、`workdir`（可选，相对 cwd）、`timeout_ms`（可选） | 与既有工具的扁平参数风格一致；三个参数覆盖 90% 场景，不预留扩展位 |
| T02 | `workdir` | 支持，走 `resolveInsideCwd`，越界返回 `Error: ... outside the workspace` | 与 `write_file` 同一把尺子；同时替代 `cd`，避免模型用 `cd &&` 制造状态错觉 |
| T03 | 用哪个 shell | `bash -c`（POSIX 侧），**不加 `-l`、不加 `-i`** | `-i` 会让 zsh 忽略 SIGTERM 导致超时杀不掉；`-l` 无必要，因为 Agent 由用户终端启动，rc 成果已在 `process.env` |
| T04 | exit code / stdout / stderr | 三者全部进回执文本；退出非 0 时**显式追加** `Command exited with code N.` | OpenCode V1 把 exit 挂 metadata 导致模型看不见（`shell.ts:585-593` vs `message-v2.ts:292-295`）——同一提交的 V2 已改为显式追加（`bash.ts:118-121`） |
| T05 | 截断策略 | 超阈值时**保尾弃头** + 明确写「已截断」+ 全文落盘并给出路径 | 错误信息在尾部（`truncate.ts:162-167`）；落盘后模型可用现有 `read_file` / `grep_search` 挖回，是工具正交组合 |
| T06 | env 规范化 | **继承 `process.env` 为默认，定向覆盖为例外**：`TERM=xterm-256color`、`PAGER=cat`、`GIT_PAGER=cat`、`GIT_EDITOR=true`、`GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS=''`、`SSH_ASKPASS=''`、`GH_PROMPT_DISABLED=1`、`GCM_INTERACTIVE=never`、`DISPLAY=''`、`DBUS_SESSION_BUS_ADDRESS=''` | 能力要与用户终端一致（继承），呈现与交互要刻意不同（覆盖）；这份清单被两个独立团队分别收敛出来，置信度最高 |
| T07 | 不做 pty | 不做，且在 spec 里把它定位成**防线 #2**（`isatty()` 恒 false）而非成本妥协 | 无 pty 不是「省了功能」，而是主动关掉了一条「程序判断该不该问用户」的通道 |
| T08 | 防交互挂死 | 四通道全封：`stdio[0]='ignore'`（stdin 立即 EOF）＋ 无 pty ＋ env 关凭据代理 ＋ 超时杀进程组 | 挂死不是单点问题，是四条独立通道，任缺一条都能挂 |
| T09 | 超时 | 默认 120s，`timeout_ms` 可覆盖；实现上**必须在竞出后 `clearTimeout`** | 定时器不清理会泄漏 + 留悬空 promise，这是必然会踩的通用并发坑 |
| T10 | 进程清理 | `detached: true` spawn，超时时 `process.kill(-pid, 'SIGTERM')` → 宽限期 → `SIGKILL` | 单命令超时必须死透，不能污染后续命令；注意这与「停机回收只发 SIGTERM」是两条相反正确的路径 |
| T11 | cwd 硬校验失败 | 返回 `Error: ...`，不抛异常；spec 里**如实承认**这是物理边界第一次失效的地方 | 命令内部仍可 `cd /` 出去，`resolveInsideCwd` 只管住参数不管住命令文本 —— 明说比假装守住诚实 |
| T12 | 黑名单 / 沙箱 | **S003 一行命令解析都不写**，推到 Epic 3 的审批层 | 三方证伪：OpenCode 遇 `$()` 放弃解析仍执行、Gemini 硬拒过度误伤、生产样本 700+ 行仍要人工审批兜底 |
| T13 | 是否扩展 `ToolContext` | 如需超时配置只加**入参侧**可选字段；**坚决不动返回侧**（不加 metadata / 流式回调） | `execute: () => Promise<string>` 的单出口是现有架构的隐性优势，一旦分叉就复现 OpenCode 的 exit code 泄漏 |
| T14 | 交给 S004 的输入 | 后台/长时/交互命令；进程回收（env marker 方案 + 三个防事故细节）；停机与单命令超时的两条不同杀进程路径 | 边界一次性写清，避免 S004 抄错方向 |

## 三条必须写进工具描述的内容（T04/T05/T09 的延伸）

prompt 是执行环境的一部分，不是文档 —— 工具 `description` 里要显式说明：

1. 默认超时值与「超时会杀掉整个进程组」
2. 截断阈值、保尾策略、全文落盘路径可用 `read_file` 取回
3. **非交互环境**：需要 tty / 会等输入的命令必然失败；用 `workdir` 而非 `cd`；建议加 `--no-pager` 一类降噪参数
