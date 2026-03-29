# 01 - 调研与技术选型

> Thread: E01-S003 需求讨论 + 竞品调研 + 底层选型 + 工具设计 + ToolContext
> 日期: 2026-03-29

---

## 背景

S001 实现了 `read_file` 和 `list_directory`，S002 实现了 `grep_search`。Agent 现在能读文件、列目录、搜内容，但不能按文件名模式找文件——只能靠 `list_directory` 扫目录树再自己筛，效率很低。

S003 要补上这个能力。

---

## Round 1: 开放式启动

**🧑 User:**

> 我想继续启动下一课程了，我们从哪开始呢？

**🤖 Agent:**

查看路线图和 CHANGELOG，确认下一个是 **E01-S003（glob / 按模式找文件）**。建议按迭代流程：先讨论需求 → 写 Spec → 实现 → 收尾。

**💡 技巧：** 开放式提问，让 AI 自己定位进度，不用手动翻文档。

---

## Round 2: 用 Skill 切入讨论模式

**🧑 User:**

> /discuss-for-specs

（手动附加 `discuss-for-specs` Skill 进入结构化讨论模式。）

**🤖 Agent:**

初始化讨论目录 `.discuss/2026-03-29/e01-s003-glob-repo-research/`，创建 `outline.md`。盘点已有资产（`repo-research` Skill、S002 竞品调研报告、五维评估框架），提出两个启动问题：

1. 调研方式——机械执行 Skill 还是先写"选型五问"？
2. 竞品列表——沿用 S002 四家还是增减？

**💡 技巧：** 用 Skill 附件控制 AI 的行为模式。同一个 AI，附不同 Skill 就切换成不同的"角色"（讨论者 vs 调研员 vs 实现者）。

---

## Round 3: 启动竞品仓库调研

**🧑 User:**

> 对，我觉得你可以采用这个研究方式，将这些项目仓库拉取到本地临时目录里，然后对它做一些研究。我们先调研。@repo-research

**🤖 Agent:**

按 `repo-research` Skill 的流程，克隆四家竞品仓库到临时目录，分析各自的 glob/find 实现，产出四份调研报告到 `researches/glob-search/`。

---

## Round 4: 推动深入

**🧑 User:**

> 继续深入研究，我感觉你研究浅了

**🤖 Agent:**

承认之前只看了顶层代码。重新深入四家仓库，追踪完整调用链、测试覆盖、Prompt 引导、错误处理、ignore 策略、与其他工具的协同。全面重写调研报告。

关键发现：
- `rg --files` 是最轻量路径（已有 rg 基础设施）
- Gemini CLI 的"双档分区排序"比 OpenCode 的纯 mtime 更优
- Codex 不做专用工具，直接在 shell 里调 `rg --files`
- 参数设计 2 个必选（pattern + path）就够

**💡 技巧：** 简短但直接的反馈——"研究浅了"四个字就足以推动 AI 从扫表面到追调用链。不需要具体指出哪里浅，让 AI 自己判断。

---

## Round 5: 引导复用已有方法论

**🧑 User:**

> 你看一下我们之前在 grep search 中 DeepDive 有一个技术调研，然后会分几个维度去看。我觉得我们现在也可以尝试这么去看一下：我们先选择底层的一些技术。

**🤖 Agent:**

参照 S002 的五维框架（工具能力、性能、生态、错误反馈、跨平台），梳理 glob 场景的四个候选方案：

1. ripgrep `--files` + `--glob`（OpenCode / Codex 用）
2. fd（Pi 用）
3. npm `glob` 包（Gemini CLI 用）
4. Node.js 内置 `fs.glob`（Node 22+，无竞品使用）

**💡 技巧：** 引导 AI 复用已有方法论，而非从零设计新框架。方法论的价值在于可复用——S002 建立的五维框架，S003 直接拿来套。

---

## Round 6: 确认候选 + 五维分析落地

**🧑 User:**

> 我觉得这四个候选方案可以

**🤖 Agent:**

产出决策文档 `D01-glob-underlying-tech.md`，五维横向对比四个方案。核心结论：**rg `--files` 是唯一"已经付过接入成本"的方案**。

- fd 性能最强但需要新增二进制管理
- npm `glob` 无 `.gitignore` 感知
- Node `fs.glob` 太新，AI 训练语料不足、文档不全

---

## Round 7: 多对话并行——Benchmark 分叉

**🧑 User:**

> 我在另外两个对话里面已经分叉出去，把 benchmark 继续搞了。你可以认为 benchmark 已经解决了，然后我们可以继续讨论。然后我觉得这个 rg 似乎是一个不错的方案。

（用户附上了其他对话的 transcript，给 AI 上下文。）

**🤖 Agent:**

D01 底层选型正式确认为 `rg --files --glob`。转入工具参数设计讨论。

**💡 技巧：** 多会话并行——把需要深入钻研的子任务（benchmark）分叉到独立对话，主对话保持推进节奏。用 `@` 引用其他对话的 transcript 同步结果。

---

## Round 8: 工具参数设计

**🧑 User:**

用户逐一给出设计偏好：
- 工具名建议叫 `FindFiles`
- 参数需要 `include` 和 `exclude`
- `list_directory` 和 glob 不一样（目录结构 vs 模式搜索）
- Limit 先做简单截断

不确定的点（输出格式、排序）甩给 AI 去调研对比。

**🤖 Agent:**

做了四家竞品的输出格式和排序策略横向对比，产出决策文档 D03：

| 对比项 | 决策 | 理由 |
|--------|------|------|
| 路径格式 | 相对路径 | 省 token，工具链已支持 |
| 排序 | mtime 降序 | 与 `grep_search` 一致 |
| Limit | 100 条硬截断 | 与 S002 对齐，MVP 够用 |

最终参数：`find_files(pattern, path?, include?, exclude?)`

---

## Round 9: 用户发现技术债

**🧑 User:**

> 还有一点需要注意：我觉得我们在 Agent 运行的时候，需要给它确定一个工作目录。因为我们使用的是相对路径，所以像之前的 read file、grep、list，以及现在的 glob，其实都需要一个统一的相对工作目录。

**🤖 Agent:**

全面调查当前代码后发现：三个现有工具全部隐式依赖 `process.cwd()`，`Tool.execute` 签名无上下文参数。提出三种方案：

- **方案 A（推荐）**：ToolContext 注入 — `Tool.execute(input, ctx: ToolContext)`
- **方案 B**：闭包工厂 — 不改接口但样板多
- **方案 C**：`process.chdir()` — 零改动但全局状态脆弱

**💡 技巧：** 用户主动发现技术债并推动解决。这比等 AI 自己发现更高效——用户有全局视野，能看到跨工具的一致性问题。

---

## Round 10: 决策沉淀

**🧑 User:**

> 你先沉淀一下我们的讨论决策吧。

**🤖 Agent:**

创建 D04（ToolContext cwd），与 D03（find_files 契约）一起落地为正式决策文档。ToolContext 只放 `cwd`，后续按需扩展。改动纳入 S003，不单独拆 Story。

**💡 技巧：** 明确下达"沉淀"指令，确保讨论结论从对话流转化为持久化文档。

---

## Round 11-12: Spec 编写与瘦身

**🧑 User:**

> 好的，编写完整的 S003 的 spec

（Spec 输出后）

> 看一下最新的 spec 的要求，你阅读一下。我觉得你这一套里面的代码太多了

**🤖 Agent:**

先产出完整 Spec（README + 5 个 details + deep-dive），然后根据反馈对照写作规范，大幅删减 TypeScript 代码块——保留设计判断（调用链表格、竞品对比表、流程图、ADR），去掉 interface 定义、参数数组、排序实现等重复性代码。

**💡 技巧：** 简短质量反馈——"代码太多了"五个字，让 AI 自己去对照规范找问题。不需要逐行指出哪段代码该删。

---

## 关键决策摘要

| 编号 | 决策 | 来源 |
|------|------|------|
| D01 | 底层选型 = `rg --files --glob`（零增量成本） | 竞品调研 + 五维分析 |
| D02 | Benchmark 方案（见 02 文档） | 另两个对话 |
| D03 | `find_files(pattern, path?, include?, exclude?)`，相对路径，mtime 降序，limit 100 | 竞品输出格式对比 |
| D04 | ToolContext 注入 cwd（`Tool.execute(input, ctx)`） | 用户发现 + 方案对比 |
