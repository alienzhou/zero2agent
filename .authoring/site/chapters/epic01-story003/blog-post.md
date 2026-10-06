# 从零开始，学习实现产品级 Agent Harness 系列（3）

这是 Zero2Agent 系列的第三课。

上一课我们实现了 `grep_search`，解决了「内容搜索」的问题。这一课要补齐另一个维度：文件搜索。不过 `find_files` 本身比较简单，所以拓展讨论下两个 AI Coding 时代的工程实践：Benchmark 驱动的技术选型，以及 Agent Debug 方法论。

## 搜索维度的补齐

Agent 需要的搜索能力至少有两个层次：

- **内容维度**：哪一行包含某个关键词？（已有 `grep_search`）
- **文件维度**：哪些文件匹配某个路径模式？（缺失）

用户问「帮我找一下项目里所有的测试文件」时，他关心的是文件名匹配 `*.test.ts`，而不是文件内容里出现了什么字符串。这个维度的缺失，会让 Agent 在回答文件定位类问题时束手无策。

于是 `find_files` 成了本课必须补齐的工具。

![搜索维度对比](output/02-intro.png)

## 实现很简单，选型才考验人

`find_files` 的接口设计很直接：接收 `pattern`、`path`、`exclude` 三个参数，返回匹配的文件列表。底层调用 `rg --files` 就能实现基本功能。

![find_files 接口设计](output/03-find-files.png)

但真正的考验在选型环节。

同样是文件搜索，主流 Agent 工具的选择各不相同：

- OpenCode/Codex 用 `rg`
- Pi 用 `fd`
- Gemini CLI 用 `npm glob`
- Node 22 新增了 `fs.glob`

谁更好？靠拍脑袋很难有说服力。

## Benchmark 驱动的技术选型

在 AI Coding 时代，技术选型的工作流正在发生变化。

以前做 Benchmark 是个重活：设计方案、写脚本、跑数据、解读结论，往往需要大半天。现在可以和 AI Agent 协同完成——重点是和它讨论清楚测试方案，剩下的执行工作可以大幅加速。

![Benchmark 方法论](output/05-benchmark-methodology.png)

针对文件搜索，我设计了一套 Benchmark：

**候选方案**：`rg --files`、`fd`、`npm glob`、`fs.glob`（Node 22 原生）

**测试维度**：

- 全量列文件
- 指定后缀过滤（如 `*.ts`）
- 多扩展名匹配

**语料选择**：小/中/大三个量级的真实项目（6k / 50k / 200k+ 文件），分别用本项目、Vite、Next.js 的仓库测试

实测结果：

| 工具       | 全量列文件 | *.ts 过滤 | 多扩展名 |
| ---------- | ---------- | --------- | -------- |
| rg --files | 12.2ms     | 11.4ms    | 11.1ms   |
| fd         | 11.8ms     | 11.2ms    | 12.0ms   |
| npm glob   | 60.4ms     | 50.4ms    | 61.9ms   |
| fs.glob    | 34.3ms     | 30.0ms    | 35.9ms   |

![Benchmark 实测数据](output/06-benchmark-data.png)

`rg` 和 `fd` 在 10ms 级别，`npm glob` 约 60ms，差距达到 5 倍。当性能差异达到一个数量级时，数据比主观判断更有说服力。

更重要的是，Benchmark 过程中还发现了定性分析难以触及的细节：比如 `fs.glob` 的 globstar 行为异常、`npm glob` 在错误场景下静默退出。Benchmark 本身，也是在做一场适应性接入的 Demo 测试。

## 可复用的选型方法论

这套流程可以被抽象成一个通用的技术选型框架：

1. **竞品调研**：看别人在用什么，避免凭空列举
2. **定性分析**：列出关心的维度，横向对比快速缩小候选范围
3. **设计 Benchmark（如需）**：对性能等关键指标做公平有效的测试
4. **解读结论**：综合定性与定量结果，人做最终判断

![技术选型四步法](output/07-benchmark-conclusion.png)

好的定性分析通常能给出正确方向，而 Benchmark 在此基础上不仅给出数据支撑，还可能发现定性分析难以触及的细节。

## Vibe Coding 的 Debug 困境

工具补齐之后，另一个更深层的问题浮现出来：Vibe Coding 最怕修不好的 Bug。

Agent 写代码很快，但遇到 Bug 时，如果只能靠「看代码+猜问题」，效率会急剧下降。更糟的是，Agent 有时会用一个临时方案掩盖问题，把代码搞得很难维护。

我逐渐意识到，调试能力本身就是 Harness 的重要组成部分。不能接 Bug 的 Agent，实在是「管杀不管埋」。

## Agent Debug 的五层模型

基于实践，我把 Agent 的调试能力抽象成五个层级：

![Agent Debug 五层模型](output/08-debug-tower.png)

**L1：纯静态分析**
Agent 通过看代码、看报错，在「脑内」Debug。门槛最低，天花板也最低。

**L2：预埋日志**
在开发阶段就在关键链路写日志，运行时出问题让 Agent Grep 日志分析。需要前期规划，但收益稳定。

**L3：动态日志**
出现问题后，让 Agent 分析代码、生成假设，然后在关键路径插入日志埋点。复现后读取日志验证假设，基于确认的假设进行修复。

这是当前实践的「性价比」选择——不需要前期规划，又能获得运行时信息。

**L4：CDP 简单调试**
打断点、暂停、读变量、拉调用栈，像人一样进行简单的 Debugger 操作。具备实时性，但需要本地环境。

**L5：CDP 高级能力**
条件断点、Heap 分析、性能 Profile，理论上可以达到高级工程师的调试水平。

### 动态日志的工作流程

动态日志的核心思路是：让 Agent 基于代码分析生成假设，通过日志验证假设，最后基于事实修复。这比让 Agent 直接猜代码问题要可靠得多。

![动态日志工作流程](output/09-debug-workflow.png)

### 技术链路

技术链路上，浏览器无法直接写文件，需要通过一个轻量级的 Log Server 将日志转存为 NDJSON（一行一条 JSON），同时包含时间戳和位置标识，让 Agent 能轻松读取并校验假设。

![动态日志技术链路](output/10-debug-arch.png)

### 实践建议

![调试实践建议](output/11-debug-practice.png)

## 工程基座：ToolContext

在实现 `find_files` 的过程中，还暴露出一个隐含的工程问题：路径解析。

工具内部统一使用绝对路径，避免依赖 `process.cwd()` 的隐式假设。这个细节引出了 ToolContext 的设计——一个统一的工具运行环境。

随着工具数量增加，隐式依赖迟早会成为问题。ToolContext 先聚焦 cwd 的标准化注入，为后续所有工具建立一致的上下文契约。这是工程化必不可少的基础建设。

## 代码是结果，过程才是资产

这节课表面上是实现 `find_files`，但真正的收获藏在代码之外：

- Benchmark 驱动的选型方法论
- Agent Debug 的五层能力模型
- ToolContext 的工程基座设计

这些比单个工具的实现更有复用价值。它们会逐渐沉淀为 Agent Harness 的方法论体系。

项目完整开源在 alienzhou/zero2agent，包含全部源码和 Benchmark 脚本。下一期将讨论 Prompt 结构的设计。
