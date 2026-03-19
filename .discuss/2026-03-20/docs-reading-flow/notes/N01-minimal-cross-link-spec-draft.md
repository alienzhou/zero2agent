# 最小互链规范草案

## 目标

在不引入产品级交互的前提下，仅通过 Markdown 链接，让读者在关键文档之间能够自然前进、返回和横向跳转。

## 最小闭环

第一版先保证五类页面形成基础闭环：

1. `README`
2. `docs/roadmap/README.md`
3. Epic `README.md`
4. Story `README.md`
5. `CHANGELOG.md`

## 页面级互链要求

### 1. README

至少应链接到：

- `docs/roadmap/README.md`
- 当前推荐的 Epic
- 当前推荐的 Story
- `CHANGELOG.md`

作用：

- 作为总分流页
- 承接首次访问与回访用户

### 2. Roadmap

至少应链接到：

- `README.md`
- 每个已开放 Epic 的 `README.md`
- 当前推荐的 Epic
- 当前推荐的 Story
- `CHANGELOG.md`

作用：

- 提供全图视角
- 把用户继续送往 Epic 或 Story，而不是停留在总览页

### 3. Epic README

至少应链接到：

- 项目 `README.md` 或 Roadmap
- 本 Epic 下的各 Story `README.md`
- 当前推荐 Story
- 相关 Epic（如存在明显前置 / 后续关系）

作用：

- 承担阶段导览
- 帮助用户从阶段认知进入具体学习入口

### 4. Story README

至少应链接到：

- 所属 Epic `README.md`
- Story 内部关键资料，如 overview / technical design / task list / checklist
- `CHANGELOG.md` 中对应迭代锚点
- 明显相关的前后 Story（如存在）

作用：

- 作为真正学习入口
- 支持返回上层、进入细节、横向跳转

### 5. CHANGELOG

至少应链接到：

- 对应 Epic `README.md`
- 对应 Story `README.md`
- 必要时链接到关键 tag 或补充说明文档

作用：

- 作为回访用户的完整更新入口
- 让“看更新”能够自然过渡到“进入学习”

## 互链优先级

建议分两层实施：

### P0：必须有

- `README -> Roadmap / 推荐 Epic / 推荐 Story / CHANGELOG`
- `Roadmap -> Epic / 推荐 Story`
- `Epic -> Story`
- `Story -> Epic`
- `CHANGELOG -> Epic / Story`

### P1：有则更好

- `Epic -> 相关 Epic`
- `Story -> 相关 Story`
- `Story -> 上一篇 / 下一篇`

## 约束

- 链接要少而准，不追求“所有东西互相可达”
- 优先补“用户下一步最可能去哪里”的链接
- 避免在同一页面堆过多“相关阅读”，导致主线被打散

## 当前建议

如果只做第一批优化，优先顺序应是：

1. `README` 分流链接
2. `Story -> Epic` 回链
3. `CHANGELOG -> Story / Epic`
4. `Epic -> Story`
