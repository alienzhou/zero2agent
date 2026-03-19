# D11：现有代码影响评估 + Spec 输出结构

## 状态
✅ Confirmed

## 对现有代码的影响评估

**结论：纯新增，不改现有代码**

| 改动 | 说明 |
|------|------|
| 新增 `packages/core/src/tools/grep-search.ts` | grep_search 工具实现 |
| 修改 `packages/core/src/tools/index.ts` | 在 `allTools` 数组里加一项 |
| 新增 `@vscode/ripgrep` 依赖 | `pnpm add` 到 `packages/core` |

现有 `Tool` 接口、`loop.ts`、其他工具均不需要改动。

## Spec 输出结构

与 S001 同构（S001 已使用 `deep-dive/` 承载延伸阅读；规范见 `.authoring/writing-style.md`）：

```
specs/E01-read-and-search/S002-content-search/
├── README.md                    # Story 入口（含主线 + 「深入了解」链到 deep-dive）
├── details/
│   ├── 00-overview.md               # 设计概述
│   ├── 01-technical-design.md       # 技术设计
│   ├── 02-task-list.md              # 任务拆解
│   ├── 03-verification-checklist.md # 验收检查
│   └── 04-backlog.md                # 本版不做 + 话题池（可链到 deep-dive 长文）
└── deep-dive/                   # 可选；单篇讲透延伸话题，不要求本迭代实现
    ├── 01-....md
    └── ...
```

`details/` 服务交付与验收；`deep-dive/` 服务方法论、对照与「先写清再实现」的纵深阅读，二者不互相替代。
