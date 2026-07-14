# Epic 2：能动 / 能改 / 能执行

> Epic 1 让 Agent 学会了"看"和"查"。Epic 2 要让它真正"动手做事"——修改文件、执行命令，同时守住安全边界。

[首页](../../README.md) | [Roadmap](../../docs/roadmap/README.md) | [上一阶段：Epic 1](../E01-read-and-search/README.md)

---

## 这个 Epic 做什么

Epic 1 的终点是一个**只读、安全、可解释**的最小 Agent：能读文件、搜内容、找文件，但碰不了工作区里的任何东西。

Epic 2 的主轴是让 Agent 跨过"只读"这条线：

> 从"会看 / 会查"，成长为"能动手做事"的 Coding Agent。

做完这个 Epic 后，Agent 会具备以下能力：

1. **改动工作区**——创建、写入、删除文件
2. **高效修改**——对已有文件做局部替换，而不是整篇重写
3. **驱动执行环境**——执行 shell 命令，拿到真实运行结果
4. **应对特殊命令**——不被长时间运行、前台阻塞、交互式命令拖住

这一阶段的重点不是堆工具数量，而是建立**行动力**，以及行动力背后必须配套的**执行边界**。

---

## Story 列表

| Story | 做什么 | 状态 |
|-------|--------|------|
| S001：直接改动工作区 | 引入 `write_file` + `delete`，让 Agent 能创建 / 写入 / 删除文件 | 🚧 讨论中 |
| S002：高效修改已有内容 | 引入 `replace_in_file`，做局部替换而非整篇重写 | 📝 Planned |
| S003：驱动执行环境 | 引入 `terminal`，让 Agent 能执行命令（正常执行路径） | 📝 Planned |
| S004：应对特殊命令 | 处理长时间运行 / 前台阻塞 / 交互式命令 | 📝 Planned |

> Story 顺序与边界依据课程 Roadmap 讨论 [D04：Epic 2 规划](../../.discuss/2026-03-14/zero2agent-course-roadmap/decisions/D04-stage2-roadmap.md)。浏览器能力暂不进入 Epic 2 主线。

---

## 从哪里开始

从第一个 Story 开始：

👉 **[S001：直接改动工作区](./S001-write-file/README.md)**

每个 Story 页面里有完整的阅读顺序、代码指引和跟练说明，跟着走就行。
