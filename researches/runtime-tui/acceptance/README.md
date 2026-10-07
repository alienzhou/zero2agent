# E03-S003 验收证据

[课程验收矩阵](../../../specs/E03-product-foundations/S003-runtime-tui/details/03-verification-checklist.md) | [交互兼容核对](../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/interaction-compatibility.md)

最终结果见 [final-verification.json](./final-verification.json)：**509 项离线通过、53 项真实模型用例默认跳过；本课真实模型定向复验 3 项通过、0 跳过**。离线由 Core 394、E2E 114、cdp-debug 1 项组成，TUI 27 项包含在 E2E 中。

最终验收采用完整离线门禁加真实模型定向复验。`summary.json` 保留最后一次全量命令的原始结果（其 live 当时失败），不改写为成功。之后只修改 `e2e/src/runtime-live.test.ts` 的对话与证据清理，重新执行该测试、E2E 类型、该文件 lint 与格式检查。SHA-256 比对确认生产代码与其余测试均未变化。最终记录明确各项证据来源，没有冒称又运行了一遍整库。

## 分层证据

| 证据 | 实际范围 |
|---|---|
| `offline.txt.gz` | 全仓库离线单元与契约回归，包括本地 SSE、真实生产 CLI 和真实 PTY；真实模型测试默认跳过 |
| `runtime-demo.txt` | 本地固定模型响应驱动生产 SDK / Core / 文件工具，验证拒绝、批准、结果配对和请求取消 |
| `live-recheck/results.json`、`live-recheck/evidence/*.json.gz` | 已配置真实模型服务经过生产 TUI / PTY 的读取与重置、拒绝后批准、前台命令取消与续聊；断言真实文件和后续请求回执 |
| `terminal-restore.txt` | 正常 exit、SIGTERM、SIGHUP 后 `/bin/stty -g` 完全恢复，外层终端重新接受 canonical 输入 |
| [终端截图](./screens/) | 真实 PTY 原始字节重放到 xterm.js 6.0.0 的 8 个画面，96×30 与 42×18；响应来自本地夹具 |
| [课程检查](../../../.authoring/site/chapters/epic03-story003/review.md) | 18 页图解逐页排版与视觉检查、PC/H5 阅读、目录、文字展开和放大；源码和页面哈希另存 |
| [交叉审查](../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/review.md)、[Core 审查](../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/core-review.md) | 两名实现者交叉核对他人代码与需求，并按记录复验修复；是 AI 审查，未冒充人工签收 |

`raw-pty.ansi.gz` 是无损原始字节，SHA-256 见 `screens/capture.json`；对应 txt 是去掉行末填充空格的派生屏幕文本。`restorationEscapesObserved` 仅说明捕获了恢复转义码；真正的终端模式恢复以 stty 检查为据。独立初次终端恢复结果同时保存在 `terminal-restore.json`。

## 保留失败及修正过程

- `initial/`：初次门禁的离线 498 项通过，因终端原始填充空格未通过 whitespace。原始失败输出保存在 `whitespace.txt.gz`；随后使用原始 gzip 与规范派生文本分别保存。
- `failed-live-attempt/`：随后离线 500 项通过，真实模型 2 项通过、1 项失败。模型声称执行了命令却没有实际调用工具，测试因 `ready.txt` 不存在而失败。修正提示为明确要求真实工具调用，文件、副作用和回执断言未放宽；之后定向复验 3 项通过。最终完整门禁另见当前目录。

- `before-input-limit-fix/`：常用编辑键与业务兼容补齐后，508 项离线、3 项真实模型及其余门禁全部通过，源码稳定。随后审计发现超长粘贴仍会静默丢失，追加原子拒绝与反馈，再运行当前目录的最终门禁。

离线、lint 与含终端字节的 live 原始日志包含尾部空行，采用 gzip 无损保留；归档 summary 的 log 路径同步记录压缩形式。

- `provider-dialogue-attempt/`：最终生产代码的 509 项离线及其余门禁通过；真实模型把重试拒绝请求和长命令执行理解为需要另一次对话确认，两项未实际调用工具。
- `live-dialogue-recheck/`：独立文件请求修正后，读文件和取消通过；模型在文字中等待新批准，审批测试仍判失败。最终测试允许经生产 TUI 最多回复一次明确确认，仍强制宿主审批、文件和回执断言。

- `before-continuation-answer-check/`：曾返回 3 项通过，但独立审阅发现续聊断言匹配了用户回显。随后改为等待 `Agent › READY_TO_CONTINUE` 和空闲，再验证请求回执；最新 `live-recheck/` 的 3 项通过已包含实际续聊回答，请求与响应均为 2 次。旧记录仅作缺口证据，不用于证明回答完成。

这些失败不被覆盖为“通过”，也不能据其推断当前源码仍有相同问题。

## 重复运行与边界

```sh
pnpm test:runtime
pnpm test:runtime --live
```

第二条需要配置真实模型；live 门禁要求三项实际执行且通过，跳过不算通过。脚本会更新当前目录日志，归档目录保持不变。演示不需要凭据，live 证据只保存请求正文和响应状态，不保存认证头；没有把真实密码输入人工终端。

本轮平台为 macOS arm64、Node 22.15.1；终端与进程检查为 POSIX 实机范围，未验证 Windows 或全部 Linux / 终端组合。取消不是回滚：不配合 signal 的自定义工具须等待其结束，后台任务由既有进程生命周期管理。界面历史有显示预算，不承担持久化日志职责。人工作者代码审查与站点部署状态在课程交付记录中单独说明。
