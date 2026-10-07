# Claude Code：运行过程、权限提示与输入语义

## 基本信息

| 项目 | 值 |
|---|---|
| 官方资料 | [Interactive mode](https://code.claude.com/docs/en/interactive-mode)、[Permissions](https://code.claude.com/docs/en/permissions)、[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works) |
| 调研日期 | 2026-10-07（Asia/Shanghai） |
| 调研 Commit / Tag | 不适用：没有可核对的运行时源码 |
| 证据级别 | 官方文档，未做实机交互 |

## 调研目标与结论

观察产品如何让用户在工具循环中检查进度、审批和中断。官方把运行描述为收集上下文、执行动作、验证结果的循环，用户可以介入；这个划分不等于实现状态枚举。[循环说明](https://code.claude.com/docs/en/how-claude-code-works#the-agentic-loop)

权限提示展示具体动作和选项；权限由宿主执行，模型指令不能改变授权边界。TUI 是控制入口，不能替代权限层。[权限规则](https://code.claude.com/docs/en/permissions#permission-system)

## 详细分析

### 相同按键按当前界面解释

文档区分运行中 Ctrl+C 与空闲时清空输入、再次退出。transcript viewer 中 Ctrl+C 或 Esc 可退出该视图，Ctrl+O 可打开详细工具记录。应借鉴其输入上下文原则，而非照抄一张全局快捷键表。[快捷键](https://code.claude.com/docs/en/interactive-mode#keyboard-shortcuts)

### 运行期间仍能编辑下一条输入

运行中提交消息进入队列，消息与命令的发送时机不同；Ctrl+B 可后台化任务。这需要输入、队列和运行调度一起设计。只显示一个可输入提示符，不能等同于实现了排队。[输入排队](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works)

### PTY 交接不超出证据

文档描述 shell mode、后台任务和外部编辑器，未公开本报告可验证的 stdin/raw mode 切换实现。不能据此声明其采用某框架，或具有本项目人工终端私密输入策略。

## 关键源码引用

无。公开文档和分发仓库不能替代运行时源码，故不填伪造 SHA。后续有实机观察时另记版本与范围。

## 本课采用的判断

界面要明确表示在做什么、在等谁、用户按键会影响什么。忙时输入应可编辑且行为明确；审批与运行取消不共用含糊语义。
