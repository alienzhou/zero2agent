# E03-S003 验收证据

[课程验收矩阵](../../../specs/E03-product-foundations/S003-runtime-tui/details/03-verification-checklist.md) | [交互兼容核对](../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/interaction-compatibility.md)

`summary.json` 是最近一次完整门禁的实际结果，包含时间、运行环境、命令、日志和 Core / TUI / E2E 源文件开始与结束时的 SHA-256。只有命令全部通过且源码保持一致时，`passed` 才为 true。Tag 与文档提交可以晚于检查时的 HEAD，源码哈希用于判断所验证代码是否仍相同。

## 分层证据

| 证据 | 实际范围 |
|---|---|
| `offline.txt` | 全仓库离线单元与契约回归，包括本地 SSE、真实生产 CLI 和真实 PTY；真实模型测试默认跳过 |
| `runtime-demo.txt` | 本地固定模型响应驱动生产 SDK / Core / 文件工具，验证拒绝、批准、结果配对和请求取消 |
| `live.txt`、`live-results.json`、`live-evidence/*.json.gz` | 已配置真实模型服务经过生产 TUI / PTY 的读取与重置、拒绝后批准、前台命令取消与续聊；断言真实文件和后续请求回执 |
| `terminal-restore.txt` | 正常 exit、SIGTERM、SIGHUP 后 `/bin/stty -g` 完全恢复，外层终端重新接受 canonical 输入 |
| [终端截图](./screens/) | 真实 PTY 原始字节重放到 xterm.js 6.0.0 的 8 个画面，96×30 与 42×18；响应来自本地夹具 |
| [课程检查](../../../.authoring/site/chapters/epic03-story003/review.md) | 18 页图解逐页排版与视觉检查、PC/H5 阅读、目录、文字展开和放大；源码和页面哈希另存 |
| [交叉审查](../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/review.md)、[Core 审查](../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/core-review.md) | 两名实现者交叉核对他人代码与需求，并按记录复验修复；是 AI 审查，未冒充人工签收 |

`raw-pty.ansi.gz` 是无损原始字节，SHA-256 见 `screens/capture.json`；对应 txt 是去掉行末填充空格的派生屏幕文本。`restorationEscapesObserved` 仅说明捕获了恢复转义码；真正的终端模式恢复以 stty 检查为据。独立初次终端恢复结果同时保存在 `terminal-restore.json`。

## 保留失败及修正过程

- `initial/`：初次门禁的离线 498 项通过，因终端原始填充空格未通过 whitespace。原始失败输出保存在 `whitespace.txt.gz`；随后使用原始 gzip 与规范派生文本分别保存。
- `failed-live-attempt/`：随后离线 500 项通过，真实模型 2 项通过、1 项失败。模型声称执行了命令却没有实际调用工具，测试因 `ready.txt` 不存在而失败。修正提示为明确要求真实工具调用，文件、副作用和回执断言未放宽；之后定向复验 3 项通过。最终完整门禁另见当前目录。

- `before-input-limit-fix/`：常用编辑键与业务兼容补齐后，508 项离线、3 项真实模型及其余门禁全部通过，源码稳定。随后审计发现超长粘贴仍会静默丢失，追加原子拒绝与反馈，再运行当前目录的最终门禁。

这些失败不被覆盖为“通过”，也不能据其推断当前源码仍有相同问题。

## 重复运行与边界

```sh
pnpm test:runtime
pnpm test:runtime --live
```

第二条需要配置真实模型；live 门禁要求三项实际执行且通过，跳过不算通过。脚本会更新当前目录日志，归档目录保持不变。演示不需要凭据，live 证据只保存请求正文和响应状态，不保存认证头；没有把真实密码输入人工终端。

本轮平台为 macOS arm64、Node 22.15.1；终端与进程检查为 POSIX 实机范围，未验证 Windows 或全部 Linux / 终端组合。取消不是回滚：不配合 signal 的自定义工具须等待其结束，后台任务由既有进程生命周期管理。界面历史有显示预算，不承担持久化日志职责。人工作者代码审查与站点部署状态在课程交付记录中单独说明。
