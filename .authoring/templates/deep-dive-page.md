# Deep Dive 页面模板

> 单篇讲透一个「值得想下去」的话题；读者已读完 Story README 主线后再读。

---

```markdown
# <编号>. <人话标题：读者思考什么问题？>

（1～3 段：为什么主线实现之外还要谈这个话题；和本 Story 的哪个设计判断衔接。）

## <第一节标题>

...

## <第二节标题>

...

## <收束 | 小结 | 和主线对齐>

（回扣 Story 第一版边界：哪些本迭代刻意没做、和 `details/04-backlog.md` 哪几条呼应。可选：指回实现入口或讨论决策。）

---

[上一 Story README](../README.md) · [Backlog](../details/04-backlog.md)
```

## 使用说明

- **读者假设**：已读过对应 Story 的 `README.md`，不需要重复 Epic 总览或 Story 的问题/目标/边界全文。
- **篇幅与粒度**：可以明显长于 `details/` 里单节说明；允许展开对比、历史背景、多种方案，但每一段仍应服务同一主线问题。
- **与 `details/` 分工**：`details/` 服务「按 spec 实现与验收」；Deep Dive 服务「方法论、取舍、延伸对比、本版未实现的方向」。
- **与 backlog 分工**：`details/04-backlog.md` 用列表收话题池；Deep Dive 把其中高价值条目写成可读长文，两篇互链。
- **实现状态**：文中讨论的能力**可以尚未在代码里实现**；写清「当前版本」「若未来要做」即可，避免读者以为仓库里已经都有了。
- **命名与目录**：放在 Story 下的 `deep-dive/`。
- **文件名**：`NN-短横线-英文-slug.md`，编号与 Story README「深入了解」小节中的列举顺序一致。
- **标题**：问题导向的直述句，与 [写作风格规范](../writing-style.md) 一致。
- **链接**：文首可加面包屑（与 Story README 同风格）；文末至少能回到 Story README 或 Backlog。

## 不适合放进 Deep Dive 的内容

- 本迭代任务拆解、验收勾选（应留在 `details/02`、`details/03`）
- 与话题无关的泛泛科普
- 大段重复 Story README 已讲过的表格与结论（改为一句引用 + 链接）

参考：[写作风格规范](../writing-style.md) 中「Deep Dive 与三层学习」一节。
