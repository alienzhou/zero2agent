# 跟练：观察一次审批，再取消一次运行

[课程](./README.md) | [设计](./details/01-technical-design.md) | [验收](./details/03-verification-checklist.md)

需要 Node >=22、pnpm >=9，以及能运行项目 PTY 依赖的终端。从本课固定版本、仓库根目录开始：

```sh
git checkout E03-S003-runtime-tui
pnpm install --frozen-lockfile
pnpm build
node scripts/e03-s003-runtime-demo.mjs
```

最后一条命令使用本地 HTTP/SSE 固定响应，通过生产 SDK、Core 和文件工具验证两个同名调用分别拒绝与批准、工具结果配对、HTTP 请求取消和停止后续请求。成功输出 passed: true；文件位于临时目录，脚本退出后删除。它不依赖 API key，不消耗模型用量。

## 亲自操作 TUI

```sh
node scripts/e03-s003-runtime-demo.mjs --tui
```

依次操作：

1. 输入“重复”，查看第一份审批的工具名、调用 ID、目录和参数，按 n；第二份审批按 y。观察两个工具的不同终态。
2. 输入“慢速”。界面保持等待模型的运行状态；编辑下一条草稿，再按 Ctrl-C 取消。确认取消后可以继续发送草稿。
3. 输入“报错”，观察未知工具的失败回执与后续回答。
4. 输入“终端”，分别确认通用权限和人工交接，在人工终端输入一段虚构文本。返回后继续输入；模型只获得终端状态，不获得这段正文。
5. 粘贴含换行的文本，确认尚未发送；左右移动、删除后手动发送。输入 / 查看命令提示并试用 Tab。
6. 在有工具结果时展开详情、浏览历史；缩小终端再放大，确认当前输入仍在。用界面底部帮助查看相应快捷键。
7. 输入 exit。确认游标、回显和原终端恢复。

模型内容来自固定夹具，输入任意普通文字会提议创建 lesson.txt；“重复”“慢速”“报错”“终端”用于触发各场景。这不是智能问答模型。工作目录显示在启动信息和界面中，退出演示后自动删除。

## 常用操作

| 场景 | 操作 |
|---|---|
| 编辑与历史 | 方向键、Home/End、Ctrl-A/E、Ctrl-B/F；上下键先移动多行，再浏览历史 |
| 剪切与恢复 | Ctrl-U/K/W 剪切前文、行尾、前词；Ctrl-Y 恢复最近剪切 |
| 多行 | Ctrl-J 换行；支持 bracketed paste，结束后手动 Enter 发送 |
| 查看过程 | PgUp/PgDn 滚动、Ctrl-End 回到底部；Ctrl-O 展开工具、Alt-上下选择工具 |
| 审批 | 查看完整参数后 y 允许本次；n、Enter、Esc 拒绝；普通输入草稿保留 |
| 运行控制 | Ctrl-C 取消整轮；Ctrl-X 停止当前前台命令；满足既有等待条件后 Ctrl-S 转后台 |
| 会话与终端 | `/new`、`/compact`、`/terminal [command]`；`exit` 或 `quit` 退出 |

草稿最多 16,384 个 UTF-16 单元。超长粘贴整段拒绝并提示，原草稿和光标保留，不会截掉后半段后发送。界面历史和工具预览有显示容量上限，审批参数另有完整查看路径。高级 readline 编辑和作业控制习惯可继续使用 `--plain`；完整对照见[交互兼容矩阵](../../../.vibecoding/2026-10-07/e03-s003-runtime-tui/interaction-compatibility.md)。

## 比较 plain 与自动降级

```sh
node scripts/e03-s003-runtime-demo.mjs --plain
```

--plain 保留上一课逐行交互。普通 CLI 在 TTY 无消息参数时启用 TUI；TERM=dumb 或非 TTY 降级。带消息参数的单次 CLI 保留原行为。不要向管道塞 y 试图批准操作：审批要求交互式终端。

## 接入你自己的模型

配置已有 ANTHROPIC_API_KEY、ANTHROPIC_BASE_URL、MODEL_NAME；未知模型同时配置 CONTEXT_WINDOW。然后启动：

```sh
PERMISSION_MODE=default node packages/tui/dist/cli.js
```

先用临时目录请求读取一个文件、创建一个文件并手动拒绝，再发起新请求批准。观察同一次工具调用的参数、结果与实际文件是否一致。真实模型会使用对应 API 额度；无需为离线跟练配置它。

SDK 宿主可使用 events.onEvent 渲染自己的界面，用 permissions.requestApproval 返回相同 requestId 的决策，并在用户取消时调用 agent.cancelTurn()。捕获 TurnCancelledError 后再运行下一轮，不把取消解释成已回滚。

## 运行测试

```sh
pnpm test:runtime
# 已配置模型时，额外验证真实模型 + 生产 TUI + PTY 的三条流程
pnpm test:runtime --live
```

门禁依次执行构建、完整离线回归、类型、lint、改动 TypeScript 的格式检查、确定性 demo、真实终端恢复和课程检查。日志与源码哈希保存到 `researches/runtime-tui/acceptance/`，再次运行会更新该目录。验收保留既往失败归档，当前结果单独记录。

真实模型默认跳过。针对本课的精确测试、运行环境和结果见[验收清单](./details/03-verification-checklist.md)。
