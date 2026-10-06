# E02-S001 小红书内容规划（v1）

> **当前阶段**：E · 出图完成（8 页 PNG 已校验，待阶段 F 文案确认）
> **叙事策略**：从具体工具带出通用道理——write_file/delete → 工具接口四要素 → Harness 与模型双向协同
> **风格**：方向 A（期刊 + 工程制图，延续 S004 editorial-print 基底）

## 页面规划表（8 页 · v1 已完成）

| 页 | 文件 | 分区名 | 主视觉 | 核心信息 |
|---|---|---|---|---|
| 01 | 01-cover.html | 封面 | 系列封面模板 | Epic.02 / Story 001；AGENT HARNESS (05) |
| 02 | 02-cross-readonly.html | 核心机制 | 对比行（旧 vs 新）+ 高亮盒 | Epic 1 只读 → Epic 2 能写；重点不是实现是接口 |
| 03 | 03-two-tools.html | 工具设计 | 工具条 ×2 | write_file 全量写(path+content)；delete 批量、不递归、逐条汇总 |
| 04 | 04-interface-language.html | 产品洞察 | 四要素卡 → 三个面 | 粒度/参数/边界/回执 → 表达/约束/观测 |
| 05 | 05-granularity.html | 技术选型 | 数据卡（浅色）+ 取舍盒 | SWE-agent 去编辑动作 18.0%→10.3%；我们：全量写与局部改拆两个工具 |
| 06 | 06-coevolution.html | 行业分析（深色·高光） | 数据卡 ×2 + 机制条 + 边界三层 | Aider 20%→61%、SWE-agent ≈9×；模型吸收 Harness × Harness 精简；call back S004 |
| 07 | 07-receipt.html | 深度解析 | 回执对比 + 高亮盒 | 新建vs覆盖、逐条汇总；回执是模型唯一观测窗口；收束回双向协同 |
| 08 | 08-cta.html | CTA（深色） | 系列 CTA 模板 | Next: Story 002 / replace_in_file |

## 关键决策记录

- [x] 叙事重心：双向协同（模型吸收 Harness × Harness 随模型精简），反差页放行业分析
- [x] P06 数据全部用文件编辑工具维度，不用 prompt 数据（prompt 是 S004 的料）
- [x] P06 主角是 write_file 格式：Aider 20%→61%（从 P05 挪入）+ SWE-agent ≈9×
- [x] delete 的 0/5 数据不用（做不做都行，不突出）
- [x] P06 金色一行 call back 上一章「prompt 结构决定效果」
- [x] P05 聚焦粒度：SWE-agent 18.0%→10.3% + 我们的粒度取舍
- [x] P06 配色：暖金旧数字 #C98A2B + 高饱和红 #E04840，次级文字暖米灰 #B8B2A6（解决深色页沉闷发灰）
- [x] 主体 HTML 手绘（精确技术制图），未用 AI 生图
- [x] 封面副标题不用「接口设计比实现更重要」（方法论抽象、与封面承诺错位），改为「让 Agent 第一次动手改变世界」——对准 Epic 2 ACT & EXECUTE 的核心

## 文件状态

| 文件 | 状态 |
|---|---|
| `01-cover.html` ~ `08-cta.html` + `output/*.png` | ✅ 8 页完整出图（已逐张校验） |
| `post-copy.md` | ✅ v1（待确认） |
