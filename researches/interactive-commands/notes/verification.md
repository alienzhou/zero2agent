# 调研交付的验证范围

[调研总览](../README.md) | [版本清单](../sources.json) | [实验与原始结果](../experiments/README.md)

> 日期：2026-09-29，Asia/Shanghai。这里只报告实际执行的检查，不把阅读源码测试算成运行通过。

## 文档与来源检查

最终状态：待终检结果回填。

检查遍历本调研、对应讨论记录与协作记录：

1. Markdown 本地链接解析到仓库文件，确认目标存在。
2. 固定 SHA 的 GitHub blob 链接逐一对本地检出的 Git 对象读取，确认该 commit 下的文件存在。
3. 带 L 行号的链接检查起点、终点及顺序，没有以当前工作树行号冒充旧 SHA 行号。
4. sources.json 记录 15 个实际取得的仓库快照，其中旧 Kimi 只作迁移证据。
5. git diff --check 检查空白问题，并检查提交范围。

首轮检查发现 Qwen README 的引用终点超出文件两行；读取固定 SHA 原文后，已将范围缩为真正包含来源声明的 L212–L214。两处待创建文档链接在补齐验证记录与对话记录后复验。

这类检查能证明“链接指向存在的固定版本位置”，不能证明每句话的语义自动正确。关键结论还经过人工式源码复核，包括 Codex 旧/新 feature 默认与注册、DeepSeek Linux inspector/就绪分支、本项目 S003 执行与输出代码。

未进行全量公网链接健康检查；官方在线文档是读取当时的 D 级证据，可能继续更新。没有检查 GitHub 渲染锚点、所有第三方网页缓存或发行包与 SHA 的一致性。

## 实际运行的验证

| 检查 | 结果 | 证据 |
|---|---|---|
| 本地机制 probe | 12/12，通过 | experiments/results.json，脚本版本 02e17f7 |
| 真实 Python/Node REPL 对照 | 4/4，通过 | experiments/real-repls-results.json，脚本版本 02e17f7 |
| 首轮机制 probe | 11/12，保留失败 | experiments/first-run.json，observer 未等到 close |
| REPL 清理重复运行 | 曾遇 killpg EPERM；先自然回收后复测成功 | 实验说明保留异常与原因未完全证实的边界 |
| 七个 Agent 产品 E2E | 未执行 | 不安装产品、不使用模型账户或真实凭据 |
| 上游测试套件 | 未执行 | 报告仅阅读对应测试源代码 |
| 项目业务单测/build/lint | 未执行 | 本轮未修改 packages、e2e 或构建配置 |
| Linux/Windows 实机测试 | 未执行 | 当前实验节点只有 macOS |

实验通过不证明全屏程序、人机接管、真实凭据隔离、海量输出或逃逸进程回收；这些均在分报告和决策输入中保留缺口。

## Git 与协作记录

- 分支：feat/e02-s004-interactive-research。
- 起点：1b84fa2cbb151af2d3c9b5d4c683e532c976280c。
- 本轮修改范围：researches/interactive-commands、对应 .discuss 与 .vibecoding 新目录。
- 原 .discuss/.snapshot.yaml 未提交改动保持原样，不纳入本轮提交。
- 未修改业务代码、原 S003 调研、PR #12 内容；未创建 spec、tag、远端分支或 PR。
- 本地语义化提交保存了报告、实验失败与修正过程；没有 push。

后续复核应以 sources.json 和分报告的完整 SHA 为准。重新 clone 得到的新 HEAD 不自动代表本文证据版本。
