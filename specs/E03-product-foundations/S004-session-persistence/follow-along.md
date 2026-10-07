# 跟练：退出一次，再接着聊

[返回本课](README.md)

## 固定版本

```sh
git fetch origin --tags
git checkout E03-S004-session-persistence
pnpm install --frozen-lockfile
pnpm build
```

要求 Node.js 22+、pnpm 9+。下列离线演示不读取本地 API key；模型响应来自本地 HTTP/SSE 夹具，CLI、SDK、保存与恢复均使用生产实现。

## 两个进程之间传递上下文

```sh
node scripts/e03-s004-session-demo.mjs
```

观察进程 A 的识别码、列表中的 UUID，以及后续进程不含识别码的新问题。脚本核对实际请求正文中有旧历史；最后输出 PASS。临时工作目录和会话在演示结束后删除，不写入日常会话目录。

## 在 TUI 中寻找和切换

在真实 POSIX 终端运行：

```sh
node scripts/e03-s004-session-demo.mjs --tui
```

1. 已恢复的历史出现在时间线；`/session` 查看完整 UUID。
2. `/new` 清空当前会话，再用 `/sessions` 找到旧标题。↑↓ 选择，Enter 恢复；Esc 返回输入。
3. 询问识别码，等状态栏显示已保存，再发下一条。忙时可编辑草稿，Enter 不自动排队。
4. 试用 Ctrl-J、多行粘贴、输入历史、Ctrl-O 工具详情、`/compact` 与 `/terminal`，按当前提示操作。这个演示的模型夹具只回答记忆问题，不伪装成完整通用模型；完整工具交互沿用上一课离线演示。
5. `exit` 退出。演示目录会清理；日常 CLI 会话则保存在用户目录。

## 使用真实模型

配置当前模型连接，在同一个工作目录运行：

```sh
node packages/tui/dist/cli.js "记住识别码 BLUE-731，先只回答收到"
node packages/tui/dist/cli.js --list-sessions
node packages/tui/dist/cli.js --continue "刚才的识别码是什么？"
```

启动时总是新会话，只有 `--resume UUID` / `--continue` 才恢复。单次消息、`--plain`、管道也使用同一自动保存逻辑。`--terminal` 仍可直接进入人工终端且不需要模型连接；人工输入输出不进入会话文件。

## 故障时看什么

| 观察 | 含义与操作 |
|---|---|
| 正在保存 | 等磁盘操作完成，再发送下一轮 |
| 尚未保存 | 内存仍在；排除磁盘问题后 `/save` 重试 |
| revision conflict | 另一进程已发布下一版本；协调写入者，不能靠覆盖消除冲突 |
| 上次运行中断 | 恢复上一结算边界，文件可能已改变；先检查实际工作区 |
| 旧进程仍在运行 | 回到原进程完成或结束它；不要同时操作同一会话 |
| 损坏 / 未知格式版本 | 保留文件用于排查，本课不自动降级或迁移 |

不要在真实工作目录中用破坏性操作制造崩溃。自动验收在临时目录执行工具后 SIGKILL，验证恢复不重放；具体证据见[验收清单](details/03-verification-checklist.md)。
