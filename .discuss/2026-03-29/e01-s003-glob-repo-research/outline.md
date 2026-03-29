# E01-S003：Glob / 文件搜索 —— 外部仓库调研与技术选型

## 🔵 Current Focus

- 所有技术决策已沉淀为文档，可进入 Spec 编写阶段

## ✅ Confirmed

- 沿用 S002 四家竞品，`researches/glob-search/` 四份深入报告已完成
- **D01 底层选型：rg `--files` + `--glob`** ✅
- **D02 Benchmark 已完成** ✅
- **D03 find_files 工具契约** ✅
  - 工具名：`find_files`
  - 参数：`pattern`、`path?`、`include?`、`exclude?`
  - 输出格式：相对路径（POSIX）
  - 排序策略：mtime 降序
  - 截断：简单策略（默认 100 条）
  - 与 `list_directory` 分工明确
- **D04 Agent 统一工作目录：ToolContext 注入方案** ✅
  - `Tool.execute(input, ctx: ToolContext)` 加第二参数
  - `ToolContext { cwd: string }`（当前只放 cwd，后续按需扩展）
  - 改动纳入 S003
  - 实现节奏：基础设施 → 适配现有工具 → 实现 find_files
- 四份调研文档已补充 "zero2agent 设计参考" 横向对比段

## ⚪ Pending

- 基于以上进入 Spec 编写

## ❌ Rejected

- 性能 benchmark 的 default 模式（`.gitignore` 行为放入功能矩阵测试）
- 闭包工厂方案（D04 对比后拒绝）
- process.chdir 方案（D04 对比后拒绝）

---

## 决策索引

| ID | 主题 | 状态 | 文件 |
|----|------|------|------|
| D01 | Glob 底层技术选型（五维定性分析） | ✅ 已确认：rg `--files` | `decisions/D01-glob-underlying-tech.md` |
| D02 | Benchmark 设计方案 | ✅ 方案确认 | `decisions/D02-benchmark-design.md` |
| D03 | find_files 工具参数与行为契约 | ✅ 已确认 | `decisions/D03-find-files-tool-contract.md` |
| D04 | Agent 统一工作目录（ToolContext） | ✅ 已确认：ToolContext 注入 | `decisions/D04-tool-context-cwd.md` |
