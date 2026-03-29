# 文档书写规范

> 本目录所有内容仅供课程作者参考，不在读者阅读路径上。

## 规范索引

| 规范 | 说明 |
|------|------|
| [写作风格](./writing-style.md) | 标题、语气、信息密度、结构，以及 Story README 专项写法 |
| [导航与互链](./navigation.md) | 面包屑格式、页面互链、新增 Story/Epic 检查清单 |
| [Story README 自检清单](./story-checklist.md) | 写完 Story README 后的快速检查项 |

## 模板索引

| 模板 | 用途 |
|------|------|
| [Epic 页面模板](./templates/epic-page.md) | 编写 Epic README |
| [Story 页面模板](./templates/story-page.md) | 编写面向跟练读者的 Story README |
| [Deep Dive 页面模板](./templates/deep-dive-page.md) | 编写 `deep-dive/` 下的单篇延伸讲解 |
| [复盘模板](./templates/retro.md) | 编写迭代复盘 |

### details/ 模板

每个 Story 的 `details/` 目录包含 5 份工程侧文档，对应以下模板：

| 模板 | 对应文件 | 用途 |
|------|----------|------|
| [details/00-overview](./templates/details/00-overview.md) | `details/00-overview.md` | 迭代总览：目标、设计原则、核心功能、技术选型、文档导航 |
| [details/01-technical-design](./templates/details/01-technical-design.md) | `details/01-technical-design.md` | 技术设计：各子系统设计判断 + ADR + 不做的事情 |
| [details/02-task-list](./templates/details/02-task-list.md) | `details/02-task-list.md` | 开发任务拆解 + 进度跟踪 |
| [details/03-verification-checklist](./templates/details/03-verification-checklist.md) | `details/03-verification-checklist.md` | 功能验收 + 边界场景 + 环境检查 + 已知限制 |
| [details/04-backlog](./templates/details/04-backlog.md) | `details/04-backlog.md` | 不做清单 + 开放性问题 + 被拒方案 + Deep Dive 话题池 |

### AI Skill 模板

以下模板嵌入在 AI Skill 中，由 Agent 执行时引用，此处仅索引。

| 模板 | 用途 | 位置 |
|------|------|------|
| 讨论大纲模板 | discuss-for-specs Skill | [outline-template.md](../.claude/skills/discuss-for-specs/references/outline-template.md) |
| 决策文档模板 | discuss-for-specs Skill | [decision-template.md](../.claude/skills/discuss-for-specs/references/decision-template.md) |
| 调研报告模板 | repo-research Skill | [SKILL.md](../.claude/skills/repo-research/SKILL.md)（内嵌） |
