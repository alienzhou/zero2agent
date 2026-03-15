# Zero2Agent 课程 Roadmap

> 先看全图，再进入 Epic，最后进入具体 Story。

---

## 这份 Roadmap 怎么看

Zero2Agent 的课程内容按四层结构组织：

1. **README / 首页**：快速理解项目定位与入口
2. **Roadmap 总览页**：看完整学习地图
3. **Epic 页**：理解一个阶段的目标、必要性和收获
4. **Story 页**：进入一个具体课题，理解如何观看实现

如果你是第一次进入项目，建议顺序是：

1. 看完本文，建立全图感
2. 进入 [Epic 1：能看 / 能查](../../specs/E01-read-and-search/README.md)
3. 再看 [E1-S1：让 Agent 跑起最小只读闭环](../../specs/E01-read-and-search/S001-react-basic/README.md)
4. 最后对照 `specs/`、`packages/`、`CHANGELOG.md` 看真实实现

---

## 当前学习地图

| Epic | 阶段目标 | 完成后你会得到什么 | 状态 | 入口 |
|------|----------|--------------------|------|------|
| Epic 1：能看 / 能查 | 让 Agent 跑起安全、可解释的最小只读闭环 | 理解 ReAct 循环、只读工具和基础 Prompt 结构 | 🚧 In Progress | [进入 Epic 1](../../specs/E01-read-and-search/README.md) |
| Epic 2：能动 / 能改 / 能执行 | 让 Agent 从“会看”升级为“能动手做事” | 理解文件修改、终端执行与执行边界 | 📝 Planned | Coming soon |
| Epic 3：基础能力与产品化 | 让 Agent 从 demo 走向可使用的产品形态 | 理解 TUI、会话、日志、Checkpoint 与安全边界 | 📝 Planned | Coming soon |
| Epic 4：健壮性与上下文管理 | 处理复杂异常与长上下文问题 | 理解异常处理、上下文管理与稳定性优化 | 📝 Planned | Coming soon |
| Epic 5：扩展能力 | 在核心能力稳定后继续扩展 | 理解 AGENTS、Skills、MCP、Hooks 等扩展能力 | 📝 Planned | Coming soon |

---

## 当前推荐起点

如果你想直接开始跟练，最适合的入口是：

- [Epic 1：能看 / 能查](../../specs/E01-read-and-search/README.md)
- [E1-S1：让 Agent 跑起最小只读闭环](../../specs/E01-read-and-search/S001-react-basic/README.md)

这两个页面分别对应：

- **Epic 页**：为什么这一阶段存在
- **Story 页**：这一步在解决什么，以及你可以如何观看实现

---

## 相关资料

- [README / 首页](../../README.md)
- [文档中心](../README.md)
- [迭代日志](../../CHANGELOG.md)
- [设计文档目录](../../specs/README.md)
