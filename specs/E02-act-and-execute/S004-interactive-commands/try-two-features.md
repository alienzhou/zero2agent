# 用两个功能试一下人工终端

> 工具驱动验证已通过；2026-09-30 19:36 用户回复「正常」，两项试用通过。固定代码候选仍为 `7438fa892a9887595d91070731dab6eba6237370`，尚未公开发布。

[Story](./README.md) | [完整跟练与版本准备](./follow-along.md) | [其他产品怎么做](../../../researches/interactive-commands/notes/human-ux-verification-2026-09-30.md)

当前本地分支已有功能，在 Zero2Agent 仓库根目录先运行 `pnpm build`。以下两项均无需 API key，不调用模型，不修改项目文件；历史记录已通过命令环境变量关闭。

## 1. Node REPL：连续输入，保留同一个程序的状态

```sh
node packages/tui/dist/cli.js --terminal 'NODE_REPL_HISTORY= node'
```

1. 确认命令后输入 `y` 回车，等待 Node 的 `>` 提示。
2. 输入 `const values = [1, 2, 3]`，回车。声明结果显示 `undefined` 是正常现象。
3. 再输入 `values.reduce((a, b) => a + b, 0)`，回车，应得到 **6**。
4. 输入 `.exit`，回车，应退出 Node，看到 `completed` 和 `Exit code: 0`，回到原命令行。

这验证程序在两次输入间保留状态、按键由人直接交给程序，以及结束后归还控制权。可以顺便用上方向键调出上一行、修改再执行。

## 2. less：分页、搜索中文，再退出全屏界面

```sh
node packages/tui/dist/cli.js --terminal 'LESSCHARSET=utf-8 LESSHISTFILE=/dev/null less README.md'
```

1. 输入 `y` 回车后，应进入 README 的分页阅读界面。
2. 按空格翻下一页，按 `b` 返回上一页。
3. 输入 `/迭代进度` 并回车，应定位到相应标题；也可以调整终端窗口大小观察显示。
4. 按 `q`，应退出 less，看到 `completed`、`Exit code: 0`，终端不应留下隐藏光标或异常输入状态。

首次验证未显式指定字符集时，当前环境的 less 曾将中文显示为 `<E4>...` 字节码；因此示例显式设置 LESSCHARSET=utf-8。它是 pager 的字符集配置，不是 PTY 自动转码。

## 只需要告诉我这几个结果

已收到[本次用户反馈](../../../.vibecoding/2026-09-30/e02-s004-acceptance/user-feedback.md)。以下问题保留供后续跟练；不把简短反馈扩展为逐项日志或交互改动授权。

- Node 是否得到 6，并正常退出？
- less 是否能正常显示中文、翻页、搜索和退出？
- 退出后，原终端的光标和键盘是否恢复？
- 用户主动输入命令后再确认一次，你觉得顺手还是多余？

若某个程序卡住，按 `Ctrl-]` 中止整个接管；它不是仅切回聊天。Ctrl-C/Ctrl-D 则由 Node 或 less 按自己的规则处理。

你也可以在已配置的 Agent REPL 内，用 `/terminal NODE_REPL_HISTORY= node` 和 `/terminal LESSCHARSET=utf-8 LESSHISTFILE=/dev/null less README.md` 运行相同功能；结束后会回到 Agent 的 `你:` 提示。两种入口仍共用确认与接管逻辑。

这两项是用户试用，不代替完整测试矩阵；不需要填写长验收报告。它们通过也不自动授权推送、合入或发布。
