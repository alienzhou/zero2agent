# 02 - Benchmark 设计与实现

> Thread: Benchmark 方案讨论 + 自主实现 + Review
> 日期: 2026-03-29
> 涉及 3 个独立对话会话

---

## 背景

D01 完成了 glob 底层技术的定性分析。S002 的技术选型当时也是纯定性（读文档 + 看竞品），没有实测数据。用户希望用 benchmark 补上数据验证，同时把 benchmark 本身作为面向读者的教学内容——展示"如何用 AI 协作快速做技术选型 benchmark"。

---

## 第一阶段：方案设计（讨论对话）

### Round 1: 用户提出 Benchmark 想法

**🧑 User:**

> 你觉得针对这四个（候选方案），我们有没有可能去实现一些 benchmark 呢？为了搜索 glob 的文件，我们可以直接在 node_modules 里面去搜索。

**🤖 Agent:**

盘点了当前环境：项目 `node_modules` ~4261 文件、全项目 ~6431 文件，机器上 rg 和 fd 都未安装。五维框架中有三个可量化（工具能力 → pass/fail 矩阵、性能 → 计时、错误反馈 → 捕获输出），两个不适合 benchmark（生态 → 定性、跨平台 → 需多环境 CI）。

挑战性问题：`node_modules` 通常在 `.gitignore` 里，rg 和 fd 默认会跳过——用它做语料，测的是 "gitignore 行为差异"而非纯性能。

---

### Round 2: 确认方向 + 三梯度语料

**🧑 User:**

> Benchmark 未来也是面向读者的教学内容。整个语料的话，我觉得可以分为小、中、大三种。

**🤖 Agent:**

产出第一版设计文档 D02。三梯度语料选了真实项目：
- Small: 本项目 zero2agent（~6k files）
- Medium: Vite `v8.0.3`（~50k-80k files）
- Large: Next.js `v16.2.1`（~200k-400k files）

---

### Round 3: 用户纠正公平性

**🧑 User:**

> 不，我觉得 default 没有意义，因为我实际如果用其他的话，也会选择让它跳过这些，所以我觉得就纯比性能。
> 然后如果你要去克隆的话，一定要锁定某个 commit，不然它老是漂移。也不要把项目污染了。

三条关键修正：
1. 只跑 raw 模式（`--no-ignore`），纯比底层性能
2. 语料仓库锁定 commit
3. 语料隔离到临时目录

**💡 技巧：** 用户的判断力在于识别"哪些对比有意义"。AI 倾向于"做得更多"（两种模式都跑），用户砍掉了没意义的那一半。

---

### Round 4: 公平性原则确认

**🧑 User:**

> 你就要尽量确保大家是公平的，要控制变量。你别在 A、B 两个的 benchmark 上引入一些什么胶水语言、胶水代码或者中间层语言，然后导致它测得不准。

**🤖 Agent:**

重写 D02 为最终方案，核心强化公平性原则：
- CLI 工具（rg、fd、grep、ag）**直接调用**，零 wrapper
- Node API 工具用**最小化 .mjs 包装**（3-15 行）
- 全部通过 hyperfine 统一计时
- 单独测量 Node 空跑基线，让读者自行对照

**💡 技巧：** 公平性是 benchmark 的灵魂。用户不需要知道怎么实现，但需要确保"测的东西没被别的东西污染"这个大原则。

---

## 第二阶段：自主实现（Agent 对话）

### 唯一的一条用户指令

**🧑 User:**

> 你看我们最新做的这个 benchmark 相关的东西。有个 benchmark 的文档，你需要参照它来去做我们的 benchmark，开始实现吧。

（附上了设计讨论对话的 transcript，让 AI 了解完整背景。）

**从这里开始，用户没有任何中途干预——AI 完全自主完成了整个实现。**

**💡 技巧：** "充分准备后一键委托"模式。所有关键决策（维度、工具、语料、公平性）在讨论阶段全部锁定，实现阶段完全交给 AI。这要求讨论阶段的决策文档足够详尽——D02 包含了精确的 hyperfine 命令模板、每个 wrapper 的完整代码、目录结构。

---

### AI 自主执行过程

**环境搭建：**
- 创建 `benchmarks/` 完整目录结构
- 安装 npm `glob` 依赖
- 编写 Node wrapper 脚本（npm-glob 4 行、node-fs-glob 5 行、node-grep 18 行）
- 编写 glob/grep 三维测试脚本（features / performance / errors × 2）

**关键技术发现：**

Node `fs.glob` 存在深度限制——用 `**/*.ts` 只找到 100 个文件，而其他三个工具找到 1270 个。AI 深入调查后发现 `fs.glob` 有 ~8 层的默认深度限制，pnpm 的 `node_modules/.pnpm/` 嵌套路径超过 11 层被截断。这是功能矩阵测试的一个真实有价值的发现——**定性分析无法提前预见**。

**平台兼容性 Bug 系列：**

| Bug | 原因 | 修复 |
|-----|------|------|
| `declare -A` 报错 | macOS 自带 bash 3.2 无关联数组 | 改为逐行构建 Markdown 表格 |
| `grep -P` 报错 | macOS BSD grep 不支持 PCRE | 改用 `grep -E`（扩展正则） |
| 变量解析失败 | 中文注释的全角逗号 `，` 被 bash 当作变量名一部分 | hexdump 定位后移除 |
| `count_lines` 返回异常 | `grep -c` 返回 0 时 exit code 是 1 | 修复回退逻辑 |
| `rg --type ts` 验证不准 | rg 的 `ts` 类型同时匹配 `.ts` 和 `.tsx` | 修正验证逻辑 |

---

## 第三阶段：Review + Deep Dive 输出（第三个对话）

### Review 发现

**🧑 User:**

> 你看我们最新做的这个 benchmark 相关的东西。我在另一个对话里面已经实现了 benchmark 了，你帮我 review 一下。同时……要不要往 spec 里放一下？我觉得在 deep dive 里面可以描述一下我们做这个 benchmark 的核心流程和方式。

**🤖 Agent:**

Review 发现的问题：
- P0: `grep/performance.sh` 用了 macOS 不支持的 `grep -P`
- P1: `node-fs-glob.mjs` 缺 `dot` 选项（遍历文件集不公平）
- P1: S-P04 Node pattern 缺 `\b` 词边界

同时在 S003 Spec 的 `deep-dive/` 目录创建了 `03-benchmark-driven-tech-selection.md`，叙事线：

1. 为什么定性分析不够 → 引出 benchmark 价值
2. 完整路径（讨论 → 实现 → 运行 → 解读）→ 展开每步的 AI 协作方式
3. 方法论模板 → "授人以渔"的五步可复用框架
4. 结果与工具索引
5. 回到主线 → benchmark 验证了 D01 的定性结论

**💡 技巧：** Deep Dive 的定位不是"贴 benchmark 数据"，而是教方法论——怎么用 AI 协作从零快速搭建一套 benchmark。数据读者自己跑就能看到，方法论才是需要教的。

---

## 关键 Benchmark 结果摘要

**Glob 性能（small 语料 ~5600 files）：**

| 工具 | 全量列文件 | `*.ts` 过滤 | 多扩展名 |
|------|-----------|------------|---------|
| rg `--files` | ~12ms | ~11ms | ~11ms |
| fd | ~12ms | ~11ms | ~12ms |
| npm `glob` | ~60ms | ~50ms | ~62ms |
| Node `fs.glob` | ~34ms | ~30ms | ~36ms |

**结论：** rg 和 fd 持平，npm `glob` 最慢（~5x），Node `fs.glob` 居中但功能有缺陷（深度限制）。结合零增量成本，**rg `--files`** 是综合最优解。
