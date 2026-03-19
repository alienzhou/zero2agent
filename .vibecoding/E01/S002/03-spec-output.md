# 03 - Spec 输出过程

> Thread: 讨论收尾、Commit 整理、Spec 生成
> 日期: 2026-03-16

---

## Round 1: 沉淀与精简

**🧑 User:**

> 好的，该沉淀的就沉淀一下。你看 outline 里不要放太多东西，该沉淀的就沉淀，然后 Decision and Notes 就写一下。

**🤖 Agent:**

精简 outline，从 258 行减到约 100 行。竞品对比表移除（已在 `researches/`），outline 只保留决策索引和设计总览。10 个 decision 文档完整保留。

---

## Round 2: Commit 与评估顺序

**🧑 User:**

> 评估一下，然后你看一下：你要输出 spec 的话，输出一套什么东西？
> 在这个之前，我们是不是把我们的 commit 整理一下？因为我们现在还在讨论阶段，把 commit 整理一下再去评估，然后再输出，看看怎么输出这个 spec。

**🤖 Agent:**

整理 commit：Gemini CLI 调研 + outline 精简 + 10 个 decision 文档，一次性提交。工作区干净后继续。

---

## Round 3: 影响评估与 Spec 结构

**🤖 Agent:**

**对现有代码影响评估**：纯新增，不改现有代码

| 改动 | 说明 |
|------|------|
| 新增 `packages/core/src/tools/grep-search.ts` | grep_search 工具实现 |
| 修改 `packages/core/src/tools/index.ts` | 在 allTools 数组里加一项 |
| 新增 `@vscode/ripgrep` 依赖 | pnpm add 到 packages/core |

**Spec 结构**（同构 S001）：

```
specs/E01-read-and-search/S002-content-search/
├── README.md                    # 四段式入口
└── details/
    ├── 00-overview.md               # 设计概述
    ├── 01-technical-design.md       # 技术设计
    ├── 02-task-list.md              # 开发任务清单
    ├── 03-verification-checklist.md # 验收检查
    └── 04-backlog.md                # 扩展阅读
```

**🧑 User:**

> 可以的，可以的

---

## Round 4: 讨论完成与 Spec 输出

**🤖 Agent:**

输出 Discussion Complete 模板，给出下一步选项。

**🧑 User:**

> Option 1

**🤖 Agent:**

基于 11 个决策输出 6 个 Spec 文件，提交完成。

---

## 产出总结

**讨论产出**（`.discuss/2026-03-16/e01-s002-content-search/`）：
- 11 个决策文档（D01-D11）
- 精简后的 outline

**Spec 产出**（`specs/E01-read-and-search/S002-content-search/`）：
- README.md — 四段式入口
- details/00-overview.md — 设计概述
- details/01-technical-design.md — 技术设计
- details/02-task-list.md — 6 步开发任务
- details/03-verification-checklist.md — P0/P1/P2 验收项
- details/04-backlog.md — 扩展阅读话题池
