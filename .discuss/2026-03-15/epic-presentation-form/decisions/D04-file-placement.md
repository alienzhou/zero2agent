# D04：课程导览文档的实际落点

## 状态
✅ Confirmed

## 决策

课程导览内容的实际落点收敛为：

1. **Roadmap 总览页** 放在 `docs/roadmap/README.md`
2. **Epic 导览页** 放在 `specs/E0x-epic-slug/README.md`
3. **Story 导览页** 放在 `specs/E0x-epic-slug/S0xx-story-slug/README.md`
4. **Story 的技术文档** 继续放在同一 Story 目录下的 `00+` 文件中

对应目录结构示例：

```text
docs/
└── roadmap/
    └── README.md

specs/
└── E01-read-and-search/
    ├── README.md
    └── S001-react-basic/
        ├── README.md
        ├── 00-overview.md
        ├── 01-technical-design.md
        ├── 02-task-list.md
        ├── 03-verification-checklist.md
        ├── 04-backlog.md
        └── learnings/
```

此外：

- 保留 slug 信息
- Epic 与 Story 都使用分层目录，而不是继续使用 `E01-S001-xxx` 这种单层目录
- `specs/README.md` 不承担 Roadmap 总览页职责

## 理由

1. `docs/roadmap` 适合承载完整学习地图，保持总览视角。
2. `specs` 已经天然承接 Story 级实现文档，把 Epic / Story 导览放回这里更统一。
3. 分层目录能显式表达 Epic 与 Story 的关系，同时保留 slug 信息，兼顾结构清晰与语义可读性。
