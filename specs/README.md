# Specs

> 设计文档目录，记录每个 Epic / Story 的课程入口与技术规格。

---

## 文档结构

当前 Specs 目录采用两层半结构：

```text
specs/
├── E01-<epic-slug>/
│   ├── README.md              # Epic 导览页
│   └── S001-<story-slug>/
│       ├── README.md          # Story 导览页
│       ├── details/           # Story 技术文档
│       │   ├── 00-overview.md
│       │   ├── 01-technical-design.md
│       │   ├── 02-task-list.md
│       │   ├── 03-verification-checklist.md
│       │   └── 04-backlog.md
│       └── deep-dive/         # 可选：深度延伸（方法论、对比、本版未实现方向）
```

其中：

- `E0x-.../README.md` 负责阶段导览
- `S0xx-.../README.md` 负责具体 Story 的课程入口
- `details/00+` 文档负责技术设计与实现细节
- `deep-dive/` 负责可选的深度讲解；**不等于本迭代交付范围**，详见 `.authoring/writing-style.md` 中「Deep Dive 与三层学习」

每个 Story 的 Spec 包含以下文档：

| 编号 | 文档 | 说明 |
|------|------|------|
| 00 | Overview | 整体需求与设计的高层概述 |
| 01 | Technical Design | 结构、职责和关键决策 |
| 02 | Task List | 当前版本开发任务清单 |
| 03 | Verification Checklist | 验收时的检查项 |
| 04 | Backlog | 当前版本不做的事项 |

> 说明：Story 的 `README.md` 偏课程导览；`details/00+` 偏设计与交付；`deep-dive/` 为可选纵深阅读，见 `.authoring/`。

---

## Epic 1：能看 / 能查

> 核心目标：先建立“能看 / 能查”的最小闭环，再逐步扩展搜索与 Prompt 结构。

<p align="center">
  <a href="./E01-read-and-search/README.md">
    <img src="../assets/E01-read-search-banner.png" alt="Epic 1 Banner" width="600" />
  </a>
</p>

| 层级 | 名称 | 状态 | 入口 |
|------|------|------|------|
| Epic | [E01：能看 / 能查](./E01-read-and-search/README.md) | 🚧 进行中 | 阶段导览 |
| Story | [E01-S001：让 Agent 跑起最小只读闭环](./E01-read-and-search/S001-react-basic/README.md) | ✅ 已完成 | Story 入口 + `details/` + `deep-dive/` |

---

## 历史迭代

| 迭代 | 名称 | 状态 | 说明 |
|------|------|------|------|
| S000 | Repository Init | ✅ 已完成 | 仓库初始化、Monorepo 结构搭建 |

---

## 相关目录

- `.discuss/` - 讨论记录（Spec 形成前的讨论过程）
- `retros/` - 复盘笔记（迭代完成后的反思）
- `CHANGELOG.md` - 迭代日志
- `docs/roadmap/README.md` - 课程总览页
