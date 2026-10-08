# Gemini CLI：隐藏 Git 的文件 Checkpoint

## 基本信息

| 项目 | 值 |
| --- | --- |
| 仓库 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| 固定 Commit | ef59c532f07fbb3a58dd68bac024ae217e9c73ce |
| Commit 时间 | 2026-10-06T22:11:30Z |
| 调研日期 | 2026-10-07 |
| 二进制验证 | 未执行；本页是源码与官方文档调研 |

## 目标与结论

检查文件快照需要扫描哪些内容、是否依赖 Git、如何隔离用户仓库和序列化捕获。GitService 在历史目录初始化独立仓库，使用 GIT_DIR 和 GIT_WORK_TREE 对准项目工作树；捕获时 `add('.')`，再 status/commit。它隔离 Git 配置并对 stage→status→commit 加锁；这解决并发混入问题，但成本仍与工作树扫描有关。

恢复用 git restore 到指定提交，并 clean 新引入的未跟踪文件。这里应称为 shadow Git；shallow 是克隆历史深度概念，两者不是同一术语。用户拒绝的“第二套 Git 模拟快照”意图明确，本课不采用它。

## 关键源码

[packages/core/src/services/gitService.ts](https://github.com/google-gemini/gemini-cli/blob/ef59c532f07fbb3a58dd68bac024ae217e9c73ce/packages/core/src/services/gitService.ts)：setupShadowGitRepository、createFileSnapshot、restoreProjectFromSnapshot。重点是显式隔离配置、workspace 级锁和恢复范围。

[官方 Checkpoint 文档](https://geminicli.com/docs/cli/checkpointing/)用于核对用户功能说明；网页可能随产品更新，固定实现以以上源码为准。本页没有对 Git pack 后占用做性能判断。
