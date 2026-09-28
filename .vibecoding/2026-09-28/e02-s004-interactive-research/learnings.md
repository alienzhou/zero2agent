# 调研中的修正和可复用经验

[调研总览](../../../researches/interactive-commands/README.md) | [实验记录](../../../researches/interactive-commands/experiments/README.md)

## 先纠正证据链，再讨论方案

旧 Codex 结论遗漏 feature 默认值；新旧 SHA 对照发现非 Windows 原本就默认开启。刷新不能只改日期，也不能把本次才发现的事实包装成新功能。

完整链应该是 schema、registry、宿主配置、feature、运行时参数、底层 fd，最后才是运行结果。DeepSeek、Gemini、Grok 都有库默认与产品组合不同的具体例子。

## 多个“终端”可能属于不同能力面

DeepSeek 同时有默认 bash、minimal 持久 bash、模型六工具、人工 Web 终端；Grok 和 Kimi 也有彼此独立的模型命令与客户端 PTY。通过文件名、依赖名或功能宣传推断模型能续写，容易把宿主能力错算给模型。

## 机制实验需要独立验证观察者

E09 首轮未生成 JSON，不是 stdin 不可写，而是 observer 在 unref 后未等到 close。单独 data 诊断证实输入输出存在；增加有界 observer 生命周期后才得到正确终态证据。

真实 REPL 重复运行又在 killpg 清理时遇到 EPERM。修改为先回收自然退出的进程再考虑信号后成功；内核拒绝原因没有完整定位，文档没有伪称已确认竞态根因。

失败记录不应清掉，更不应把“实验代码修好了”偷换成“产品代码被验证”。最终机制 12/12、真实 REPL 4/4 均只覆盖对应断言。

## 反证比过早推荐更有用

pipe 写 0x03/0x04、raw PTY、EOF 后 WOULD_COMMIT、detached/unref 后 echo，都用很小的例子否定了初稿中的绝对判断。它们不自动导出某个最优 API，却把讨论从错误前提上移开。

Python/Node 显式交互模式的成功说明 pipe-only 仍可作为范围选择；默认模式等待 EOF 又说明“读 stdin”不是充分条件。需要把启动方式写进真实用例。

## 不要把平台局限说成不存在

DeepSeek Linux inspector 是“没人检测 stdin 等待”的反例，但也不是通用解决方案：架构 syscall 表、权限、设备与进程组校验，以及 macOS/Windows 退化路径，都要连同结论一起引用。

## 保存历史，不继承历史错误

没有覆写 researches/terminal 或 PR #12 初稿；本轮为 S004 建立新的证据基线并列出旧误读、真变化和验证缺口。这样读者既能回看当时如何判断，也能知道现在为什么修正。

## 不按品牌数投票

Grok 的 notices 明示 Codex/OpenCode 来源；Qwen 声明 Gemini 血缘及独立演进。共有祖先不等于今天完全一样，但也不能作为独立“多数共识”的票数。

## 调研何时可以收口

已能用证据解释关键选项及成本，并把未知列为验证任务，就可以进入讨论。无需为“全面”穷尽所有 fork；也不能因为写满七份报告，就把凭据隔离、跨平台和产品 E2E 说成完成。
