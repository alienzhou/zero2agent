# E01-S002：让 Agent 能在内容里定位信息

> 讨论始于 2026-03-16，目标是明确 S002 的需求、设计与实现方案，最终输出 Spec。

---

## 讨论进度

- [x] 确认讨论结构（对齐 Story 四段式模板 D02）
- [x] 明确 S002 vs S003 边界
- [x] 梳理问题场景
- [x] 搜索能力初步框架（Pattern + Scope 两个维度）
- [ ] **⏳ 竞品调研输入**（用户会调研其他 Coding Agent 的搜索工具设计，补充到讨论中）
- [ ] 工具粒度决策：一个工具还是多个
- [ ] 参数设计：必选/可选参数、默认行为
- [ ] 结果格式与截断策略
- [ ] 技术选型：Node.js 原生 vs 外部工具
- [ ] 对现有代码的影响评估
- [ ] 最终确认 → 输出 Spec

---

## 🔵 Current Focus
- 等待用户补充竞品调研（其他 Coding Agent 的搜索工具设计），再推进工具设计决策

## ⚪ Pending

### 一、问题和目标（待最终定稿）
- 问题场景已基本清楚（见 ✅ Confirmed），等竞品输入后最终确认措辞
- 目标：S002 完成后 Agent 多出什么能力
- 边界：S002 做什么、不做什么

### 二、实现的关键点（等竞品调研后重点讨论）
- 工具粒度：一个 `grep_search` 搞定，还是拆成多个工具
- 参数设计：哪些必选、哪些可选，默认行为是什么
- 结果格式：返回多少行上下文、对 LLM 最友好的格式
- 截断策略：结果太多时怎么处理
- 技术选型：Node.js 原生实现 vs 调用 ripgrep 等外部工具
- 对现有 Tool 接口（`packages/core/src/tools/types.ts`）和注册方式的影响

### 三、做完后的效果
- Agent 能力变化：学习者可观察到的行为差异
- 如何感知"这一步已经完成"

### 四、扩展阅读
- 设计取舍
- 业界常见但当前未采用的方案
- 后续可扩展方向

---

## ✅ Confirmed

### 讨论结构
- 讨论按 Story 四段式模板（D02）推进，四段为：
  1. 这次我们要解决的问题和目标
  2. 这次实现的关键点
  3. 做完后的效果
  4. 扩展阅读

### S002 vs S003 边界划分
- **S002 = 内容搜索（Grep 维度）**：给定 pattern，在文件内容中搜索匹配行
- **S003 = 文件集合搜索（Glob 维度）**：按文件名/路径模式查找文件
- "跨文件"不是 S002 vs S003 的分界线；S002 的 grep 天然可以在多个文件中搜索内容
- S003 解决的是"按文件名/路径找文件"的问题，不是"跨文件搜索内容"

### 问题场景
- **场景 1：文件很大** — 不知道信息在哪一行，只能通读浪费 token
- **场景 2：文件数量多** — 不可能逐个 read_file 去找
- **类比**：人类工程师在 IDE（如 VS Code）中用 Search（Ctrl+Shift+F）搜关键词定位代码
- **典型需求**：找函数定义、找变量引用、找错误信息出处
- 核心价值：从"只会通读"进化到"能搜着看"

### 搜索能力初步框架（待竞品输入后最终确认）
两个维度：
- **Pattern（搜索模式）**：
  - 关键词搜索（最基础）
  - 正则表达式（更灵活，如前缀/后缀匹配）
  - 复杂度渐进增强，MVP 可先只支持关键词或简单正则
- **Scope（搜索范围）**：
  - 排除三方依赖（如 node_modules）
  - 指定特定目录或模块
  - 框定特定文件集合
  - 默认行为的设计很关键（不指定路径时搜什么？默认排除什么？）

---

## ❌ Rejected
（暂无）

---

## 📎 相关上下文

### 现有代码结构（供接续讨论参考）
- Tool 接口：`packages/core/src/tools/types.ts` — `{ name, description, input_schema, execute }`
- 现有工具：`read_file`（读文件）、`list_directory`（列目录）
- 工具注册：`packages/core/src/tools/index.ts` 的 `allTools` 数组，新增工具只需实现 Tool 接口并加入数组
- Agent 循环：`packages/core/src/loop.ts` — `runLoop()` 中按 `stop_reason` 决定继续/结束
- S001 Backlog 中提到的搜索相关：`grep_search`、`codebase_search`（中优先级）

### 相关讨论文档
- Story 模板决策：`.discuss/2026-03-15/epic-presentation-form/decisions/D02-story-page-template.md`
- Epic 1 规划：`specs/E01-read-and-search/README.md`
- S001 Backlog：`specs/E01-read-and-search/S001-react-basic/04-backlog.md`
