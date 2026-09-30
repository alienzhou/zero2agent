# 人工交互补充实验 · 2026-09-30

[交互对比结论](../notes/human-ux-verification-2026-09-30.md) | [用户试用入口](../../../specs/E02-act-and-execute/S004-interactive-commands/try-two-features.md)

## 范围

本次在 macOS arm64 上运行 Aider 原始执行模块和 Zero2Agent 的两个实际程序。Aider 不是完整产品 E2E，其他产品只做源码/官方文档核验。本项目生产代码与测试没有变化，候选仍为 `7438fa8`。

## E-UX-01：Aider 人工输入与输出捕获

- 源码：Aider `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` 的 `aider/run_cmd.py`。
- 依赖：uv 隔离环境，Python 3.14.7、pexpect 4.9.0、psutil 7.2.2；禁用 Python 字节码写入。
- 方式：通过 importlib 加载原文件，不改实现；从真实 PTY 调用 run_cmd，SHELL 指向 /bin/sh。
- 子命令：`read -r -p "Aider name: " value; printf "AIDER_VALUE=%s\n" "$value"`。
- 操作：出现提示后输入 `example` 加回车。
- 结果：屏幕出现 `AIDER_VALUE=example`；函数返回 exit_code=0；返回的 output 包含该字符串。

因此直接验证了真实人输入通道及输出捕获；没有运行模型、/run 上层 UI、批准或分享输出对话框，后者仍以源码和官方文档为依据。

另读取 pexpect 4.9.0 已安装实现，确认 `interact(self, escape_character='\x1d', ...)` 默认值及 finally 中恢复终端属性的代码。Ctrl-] 让 interact 返回，不等于本课的整组进程回收语义；本次没有对 Aider 的该键执行逃逸/后代清理实验。

## E-UX-02：Zero2Agent 运行 Node REPL

命令：`node packages/tui/dist/cli.js --terminal 'NODE_REPL_HISTORY= node'`。

| 操作 | 实际结果 |
|---|---|
| y 回车批准 | 进入 Node.js v22.15.1，出现 `>` |
| `const values = [1, 2, 3]` | 声明返回 undefined |
| `values.reduce((a, b) => a + b, 0)` | 得到 6，证明前一轮变量仍在 |
| `.exit` | completed、Exit code: 0，宿主正常结束 |

无模型调用；NODE_REPL_HISTORY 为空禁用该 REPL 的历史落盘。

## E-UX-03：Zero2Agent 运行 less

首轮命令只设 LESSHISTFILE=/dev/null，当前环境下中文显示为 `<E4>...`。没有把该结果记作中文正常。

修正试用配置后运行：`node packages/tui/dist/cli.js --terminal 'LESSCHARSET=utf-8 LESSHISTFILE=/dev/null less README.md'`。

| 操作 | 实际结果 |
|---|---|
| y 回车批准 | 进入备用屏幕，README 中文正常呈现 |
| `/迭代进度` 回车 | 定位并高亮对应标题 |
| 空格 | 向后翻页，出现快速开始段落 |
| b | 返回上一页，重新看到迭代进度 |
| q | 离开备用屏幕，completed、Exit code: 0 |

这里记录的是工具连接的真实 PTY 输出和按键反馈，不是用户本人对常用终端渲染器的视觉签收。没有修改 README；LESSHISTFILE 指向 /dev/null，未写 pager 历史。显式 UTF-8 是 less 配置，不是把字符集问题归因于 PTY 或修改宿主环境。

## 对试用的意义

这两项分别覆盖持续状态交互与分页/搜索界面。用户可以直接复用命令，只反馈是否正常、退出后终端是否恢复，以及直接入口再次确认是否显得多余。它们不能代表 Linux、所有 TUI 或实际模型决策链已验证。
