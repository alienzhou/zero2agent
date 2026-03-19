# 导航与互链规范

> 仅供课程作者参考，不在读者阅读路径上。

---

## 核心原则

1. **按用户状态分流**。首次访问和回访是两条路径，入口设计要分开。
2. **导航靠互链**。Markdown 形态下所有导航通过链接实现。
3. **链接少而准**。只放"用户下一步最可能去哪里"，不堆链接。

---

## 面包屑格式

所有子页面顶部使用单行面包屑，紧跟标题和副标题之后：

```markdown
[首页](../../README.md) | [Roadmap](../../docs/roadmap/README.md) | [从这里开始：S001](./S001-react-basic/README.md)
```

规则：
- 用 `|` 分隔
- 不加前缀标签（如"入口导航："）
- 链接文字尽量短：`首页`、`Epic 1`、`迭代日志`

---

## 各页面互链要求

### README（总分流页）

链到：Roadmap、当前推荐 Epic、当前推荐 Story、CHANGELOG

入口区按用户状态分流，至少覆盖：
- 第一次了解项目
- 直接开始最新 Story
- 查看近期更新

### Roadmap

链到：首页、每个已开放 Epic、当前推荐 Story、CHANGELOG

### Epic README

面包屑：`[首页] | [Roadmap] | [从这里开始：Sxxx]`

链到：本 Epic 下各 Story、当前推荐 Story（末尾突出）

### Story README

面包屑：`[Epic x：...] | [首页] | [迭代日志]`

链到：所属 Epic、`details/` 下的 Story 技术资料、（若有）`deep-dive/` 延伸阅读、CHANGELOG 锚点

末尾加上一篇/下一篇导航。

### CHANGELOG

面包屑：`[首页] | [Roadmap] | [Epic 1]`

每条记录包含 Epic 链接和 Story 详情链接。

---

## 新增 Story / Epic 检查清单

新增 Story 时：
- [ ] 顶部加面包屑（Epic | 首页 | 迭代日志）
- [ ] `details/` 目录中的技术文档链接已接到 Story README
- [ ] 若有延伸长文，已设 `deep-dive/`（推荐）或沿用本 Epic 既有约定目录，且在 README 中有「深入了解」类入口
- [ ] 末尾加上一篇链接
- [ ] 前一篇 Story 末尾加下一篇链接
- [ ] Epic README 的 Story 表格加链接
- [ ] CHANGELOG 进度表加链接
- [ ] README 迭代进度表加链接
- [ ] README 最新更新行更新

新增 Epic 时：
- [ ] 顶部加面包屑（首页 | Roadmap | 从这里开始）
- [ ] Roadmap 表格加入口链接
- [ ] README 路线图表格加链接
