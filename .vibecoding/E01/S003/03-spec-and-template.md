# 03 - Spec 编写与模板规范

> Thread: Spec 输出 + 写作规范审查 + details/ 模板体系建设
> 日期: 2026-03-29
> 涉及 2 个独立对话会话

---

## 背景

讨论阶段完成了 D01-D04 四个决策，benchmark 也已实现。下一步是把讨论结论编译成正式 Spec，以及在这个过程中发现的模板体系缺口。

---

## 第一阶段：Spec 编写与瘦身

### Round 1: 一条指令输出完整 Spec

**🧑 User:**

> 好的，编写完整的 S003 的 spec

**🤖 Agent:**

参照 S001/S002 的格式，一次性产出完整的 Spec 目录结构：

```
specs/E01-read-and-search/S003-file-search/
├── README.md
├── details/
│   ├── 00-overview.md
│   ├── 01-technical-design.md
│   ├── 02-task-list.md
│   ├── 03-verification-checklist.md
│   └── 04-backlog.md
└── deep-dive/
    └── 03-benchmark-driven-tech-selection.md
```

6 个实现步骤：ToolContext 基础设施 → 现有工具适配 → TUI 适配 → find_files 实现 → 注册集成 → 测试验证。

---

### Round 2: Spec 代码瘦身

**🧑 User:**

> 看一下最新的 spec 的要求，你阅读一下。我觉得你这一套里面的代码太多了

**🤖 Agent:**

对照 `.authoring/` 写作规范自查，承认 README 和 technical-design 中 TypeScript 代码块过多。大幅删减：

- README：去掉 ToolContext/Tool 接口代码块，用自然语言替代
- 01-technical-design：删掉 10+ 个代码块（三个工具适配模式重复、rg args 构造、mtime 排序实现等）
- 保留的内容：设计判断（调用链表格、竞品对比表、ADR）

**💡 技巧：** 简短质量反馈——"代码太多了"一句话就够。不用逐行指出删哪段，让 AI 自己对照规范做判断。核心原则：**Spec 记录设计意图，不是代码的副本**。

---

## 第二阶段：发现模板缺口

### Round 1: 主动检查规范完整性

**🧑 User:**

> 你研究一下 Story 1 和 Story 2 这一套 spec 的结构。你看一下在 authoring 里面有没有提及如何去输出这一套 spec。如果有缺失的话，我们就补充。

**🤖 Agent:**

对比 `.authoring/` 已有模板和实际 Spec 结构，发现关键缺口：

**已有模板：** Story README、Epic README、Deep Dive、Retro（4 个） ✅

**完全没有模板的：** `details/` 目录下 5 个文件 ❌

| 文件 | 职责 |
|------|------|
| `00-overview.md` | 迭代总览 |
| `01-technical-design.md` | 技术设计 + ADR |
| `02-task-list.md` | 开发任务拆解 |
| `03-verification-checklist.md` | 功能验收清单 |
| `04-backlog.md` | 不做清单 + 话题池 |

这 5 个文件是 Spec 中承载工程信息的核心载体，但既无模板也无书写指引。

---

### Round 2: 补全 5 个模板

**🤖 Agent:**

参照 S001/S002 的实际结构，提炼出 5 个模板到 `.authoring/templates/details/`。

---

### Round 3: 模板 Review — 不要太死板

**🧑 User:**

> 你 review 一下这个模板。我建议模板不要太严苛，但又不要太宽松；严苛的话，有点完全死板。

**🤖 Agent:**

自查后发现四个问题并修正：

| 问题 | 修正 |
|------|------|
| 没区分骨架和可选 | 每个模板标注"骨架"和"按需保留"两类 |
| 子分类预设过细 | 去掉强制的"输入边界/状态边界""安全性/性能/架构"等硬分类 |
| 01 的 N/N+1 编号不直观 | 去掉强制编号 |
| 02 进度表和 checkbox 双重追踪 | 进度总表标注为"Step 多时才用" |

**💡 技巧：** 模板的分寸——有骨架但不死板。每个模板分两层：**骨架**（每份文档必须有的结构）和**按需保留**（有内容才写的部分）。

---

### Round 4: 去除 Story 特定内容

**🧑 User:**

> 你要特别关注一个点，之前有一些模板，它其实里面的内容是因为我要做这件事，所以才有这样的结构。有很多东西是和实际开发的 story 相关的。

**🤖 Agent:**

识别并清理了从 S001/S002 具体场景"反推"出来的模板内容：

| 模板 | 问题 | 修正 |
|------|------|------|
| 00-overview | `迭代目标` 硬编码了"核心目标/定位/你将学到"三段式 | 改为一段引导语，三段式降级为"常见做法" |
| 00-overview | `核心功能` 写"按工具/接口/行为组织" | 改为"跟着内容走"，举了工具/架构/重构三种场景 |
| 02-task-list | 使用说明出现了 `packages/core/src/tools/grep-search.ts` | 换成泛化示例 |
| 04-backlog | "功能 Backlog"+"技术优化 Backlog"作为固定二级标题 | 合并为一个"Backlog"节，拆不拆由内容决定 |

**💡 技巧：** 模板只管骨架和意图，不管具体 Story 碰巧长什么样。S001/S002 的写法在使用说明里作为"参考做法"提一句就够，不该硬编码进模板正文。

---

### Round 5: 设计优于代码

**🧑 User:**

> 我感觉这个模板输出的内容不太好，因为我发现这个 spec 里面最好不要有那么多具象的代码，毕竟代码可能会有变化。

**🤖 Agent:**

在 01-technical-design 模板中加入显眼的"代码与设计的分寸"原则：

- **适合放进 spec 的**：设计判断和取舍理由、关键接口契约、数据流向、模块职责划分
- **需要谨慎的**：代码片段——只在"文字说不清"时用，且只保留关键几行
- **不适合放进 spec 的**：完整实现、参数列表全文、具体类型定义

核心思路：**Spec 记录的是设计意图，代码会变但意图不常变。**

---

## 关键产出

| 产出 | 说明 |
|------|------|
| S003 完整 Spec | README + 5 个 details + 1 个 deep-dive |
| `.authoring/templates/details/` × 5 | 补全了 Spec 体系中最大的模板缺口 |
| "代码与设计的分寸"原则 | 写入 01-technical-design 模板 |
| "骨架 vs 按需保留"分层 | 写入所有 5 个模板 |
