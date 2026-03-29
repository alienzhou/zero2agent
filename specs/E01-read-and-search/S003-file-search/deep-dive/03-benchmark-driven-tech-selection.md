# 03. 用 Benchmark 验证技术选型：AI 协作下的快速决策

S003 要选一个文件搜索的底层技术。S002 做选型时用的是定性分析（读文档、看竞品、列表格），最终得出"ripgrep 最好"的结论——逻辑合理，但缺少数据支撑。

这次换个做法：**先定性分析缩小候选范围，再跑 benchmark 用数据拍板**。而且整个 benchmark 的设计和实现，都是和 AI Agent 协作完成的。

这篇 deep dive 的重点不是 benchmark 的结果数字——那些你自己跑一遍就能看到。更值得讲的是**怎么用 AI 协作来快速构建一套 benchmark**，以及这套方法论在未来遇到类似选型场景时怎么复用。

## 1. 为什么定性分析不够

S002 选 ripgrep 时的分析路径：调研四家竞品（OpenCode / Codex / Pi / Gemini CLI） → 提炼五个评估维度 → 列横向对比表 → 得出结论。这个过程是合理的，结论也没问题。

但如果回头审视，会发现两个薄弱点：

1. **所有结论都基于"调研 + 判断"，没有实测数据**。比如"rg 性能强"——到底比 npm `glob` 快多少？2 倍还是 20 倍？在什么规模下差异会显著放大？这些问题光靠读文档是回答不了的。
2. **有些判断可能存在盲区**。比如 Node 22 的 `fs.glob` 是个新 API，文档还不完善，它实际跑起来到底怎么样？在真正运行之前，谁都说不准。

Benchmark 要解决的就是"把猜测变成数据"。但传统做 benchmark 有个现实问题：太费时间。设计用例、写脚本、配环境、跑测试、整理结果——这套流程走下来可能要花好几天。

而现在有了 AI 协作，这个过程可以压缩到**一个下午**。

## 2. 完整路径：从讨论到数据

整个 benchmark 的诞生过程分为四步，后面逐一展开。

```
讨论设计  →  实现脚本  →  运行收数  →  解读结论
（AI 协作）  （AI 协作）  （本地执行）  （人判断）
```

开始之前有一个心态上的建议：**把 benchmark 当成一次"有结构的对话"来做，而不是一个正式工程项目**。不需要完美的 CI pipeline、不需要花哨的可视化——一组 shell 脚本 + hyperfine + Markdown 表格就够了。

### 第一步：讨论设计（让 AI 帮你想清楚）

做技术选型 benchmark 时，一个常见的冲动是"上来就跑"——随便选几个工具、写个 for 循环、比一下时间。但这样产出的数据往往不公平、不全面，也很难用来说服自己或别人。

更稳妥的做法是先和 AI 开一轮设计讨论，把以下几个问题想清楚：

**要比什么？（候选方案）**

从之前的竞品调研中，可以提炼出四个底层方案：

| 方案 | 来源 |
|------|------|
| ripgrep `--files` + `--glob` | OpenCode / Codex 都在用 |
| fd | Pi 在用 |
| npm `glob` 包 | Gemini CLI 在用 |
| Node.js 内置 `fs.glob` | 无人用过，但 Node 22+ 自带 |

注意这些候选方案的来源——它们都是从竞品调研中来的，而不是凭空罗列"有哪些 glob 工具"。为什么这样做？因为主流 Agent 已经替你做了一轮初步筛选：它们选中的工具，至少在真实场景中被验证过是可用的。从这个起点出发，比自己从零搜索要高效得多。

**怎么比才公平？（公平性原则）**

这是 benchmark 设计的核心问题。如果测试条件不一致，出来的数据就没有参考价值。具体来说：

- CLI 工具（rg、fd）**直接调用**，不套任何 wrapper 脚本
- Node API（npm `glob`、`fs.glob`）因为技术上必须通过 Node 进程执行，用**最小化的 .mjs 脚本**（3-5 行）包装
- 所有工具统一 `--no-ignore --hidden`（关闭 `.gitignore` 过滤），确保遍历相同的文件树
- 同一个语料、同一个 pattern、同一种计时方式

这里有一个容易踩的坑：为了"统一接口"，你可能会想给 rg 也套一层 Node wrapper。但这样一来，测到的就不是 rg 本身的性能，而是"Node 进程启动 + rg"的叠加耗时了。胶水代码越少，测出来的数据越接近工具本身的真实表现。

**拿什么比？（语料设计）**

三个梯度，全部是真实知名项目：

| 梯度 | 来源 | 预估文件数 |
|------|------|-----------|
| Small | 本项目 zero2agent | ~6,000 |
| Medium | Vite `v8.0.3` + 依赖 | ~50,000-80,000 |
| Large | Next.js `v16.2.1` + 依赖 | ~200,000-400,000 |

为什么选 Vite 和 Next.js？三个原因：知名度高（你大概率认得出来）、可复现（clone + install 就行）、与本项目同生态（TypeScript/JavaScript）。

两个容易忽略的细节：
1. **锁定 commit**。开源仓库的代码一直在变，不锁版本的话，你今天跑和明天跑可能面对不同的文件树，结果就没法对比了。
2. **隔离目录**。语料放 `/tmp/`，不要在项目里 clone 别人的仓库——否则会污染你自己的项目结构和 git 状态。

**比几个维度？**

不只比速度。三个维度各回答一个问题：

| 维度 | 回答的问题 |
|------|-----------|
| 功能矩阵 | 这个工具能不能做这件事？ |
| 性能 | 做同一件事谁更快？ |
| 错误反馈 | 出错时返回的信息对 Agent 有没有用？ |

### 第二步：实现脚本（让 AI 写代码）

设计讨论产出的是一份完整的方案文档（[D02](../../../../.discuss/2026-03-29/e01-s003-glob-repo-research/decisions/D02-benchmark-design.md)），包含精确的 hyperfine 命令、每个用例的 pattern、预期行为和验证方法。

有了这份方案，让 AI 生成 benchmark 脚本就变成了一个确定性任务——输入清晰、输出明确，非常适合交给 AI 来做。实际产出的目录结构：

```
benchmarks/
├── setup.sh                     # 安装工具 + 准备语料
├── corpus/
│   ├── prepare.sh               # 克隆 + 安装 + 统计
│   └── commits.json             # 锁定版本
├── glob/
│   ├── wrappers/npm-glob.mjs    # 4 行
│   ├── wrappers/node-fs-glob.mjs # 5 行
│   ├── features.sh
│   ├── performance.sh
│   └── errors.sh
├── grep/
│   ├── wrappers/node-grep.mjs   # 18 行
│   ├── features.sh
│   ├── performance.sh
│   └── errors.sh
└── run-all.sh
```

Node wrapper 是整个实现里最值得留意的地方。以 npm glob wrapper 为例，完整代码只有 4 行：

```javascript
import { glob } from 'glob'
const [pattern, cwd] = process.argv.slice(2)
const files = await glob(pattern, { cwd, dot: true, nodir: true })
files.forEach(f => process.stdout.write(f + '\n'))
```

你可能会觉得这也太简陋了——没有参数解析库、没有错误处理、没有美化输出。但这恰恰是刻意为之：每多一行胶水代码，就多一分"测到的到底是工具本身的性能，还是包装代码的性能"的不确定性。Benchmark wrapper 的原则就是**尽可能透明**，让工具自己说话。

### 第三步：运行收数

计时工具用的是 [hyperfine](https://github.com/sharkdp/hyperfine)，ripgrep 官方 benchmark 也用它。它会自动做多次运行和统计分析（均值、标准差、最小/最大值），比手写 `time` 循环靠谱得多。

一个典型的 hyperfine 调用长这样：

```bash
hyperfine --warmup 3 --min-runs 10 \
  "rg --files --no-ignore --hidden --glob '*.ts' $DIR > /dev/null" \
  "fd --no-ignore --hidden -g '*.ts' $DIR > /dev/null" \
  "node glob/wrappers/npm-glob.mjs '**/*.ts' $DIR > /dev/null" \
  "node glob/wrappers/node-fs-glob.mjs '**/*.ts' $DIR > /dev/null"
```

在正式跑性能测试之前，有一个很重要的前置步骤：**先让各工具分别跑一次，比对它们找到的文件数量是否一致**。如果工具 A 找到 1000 个文件、工具 B 只找到 500 个，那比速度就没有意义了——它们根本在做不同的事情。

### 第四步：解读结论（人来判断）

数据出来之后，**解读仍然需要你自己来做**。AI 可以帮你整理数字，但最终的技术决策不能只看跑分。

来看一组实际数据。这是 small 语料（~5,600 files）的 benchmark 结果：

| 工具 | 全量列文件 | `*.ts` 过滤 | 多扩展名 |
|------|-----------|------------|---------|
| rg `--files` | 12.2ms | 11.4ms | 11.1ms |
| fd | 11.8ms | 11.2ms | 12.0ms |
| npm `glob` | 60.4ms | 50.4ms | 61.9ms |
| Node `fs.glob` | 34.3ms | 30.0ms | 35.9ms |

单看数字，rg 和 fd 几乎一样快，都远快于两个 Node 方案。但做决策时不能只看速度这一个维度：

- rg 在 S002 已经接入了项目，继续用它意味着**零增量成本**——不需要新增任何依赖或下载机制
- fd 虽然性能相当，但需要新增一整套二进制下载机制
- npm `glob` 和 `fs.glob` 都慢了约 5 倍，而且在功能矩阵测试中，`fs.glob` 的 globstar 行为还有问题

综合下来，**rg `--files`** 是最优选择——不只是因为它最快，更是因为它**已经在技术栈里了**。这也是工程决策中一个常见的考量：在性能相当的情况下，优先选集成成本最低的方案。

## 3. 方法论模板：下次遇到选型怎么做

上面走完的这条路，可以抽象成一个可复用的方法论模板：

```
1. 竞品调研  → 确定候选方案（看别人在用什么，而不是凭空列举）
2. 定性分析  → 用维度框架做横向对比（快速缩小范围）
3. 设计 Benchmark → 和 AI 讨论公平性、语料、用例
4. 实现 Benchmark → 让 AI 生成脚本（保持最小化）
5. 运行 + 解读 → 数据回答定量问题，人做最终判断
```

其中**步骤 3 是关键分水岭**。很多人会跳过设计、直接动手写测试代码，但这往往会导致后面的返工——比如跑完才发现测试条件不公平、语料选得不对、或者漏掉了重要的评估维度。和 AI 多花 30 分钟讨论设计，能省下后面几个小时的弯路。

这个方法论不限于文件搜索工具选型。以后遇到类似的技术决策（比如"用哪个 Markdown 解析库""用哪个向量数据库""选 SQLite 还是 PostgreSQL"），同样的框架都能套用。

## 4. 完整 Benchmark 数据

详细的 benchmark 脚本和运行方式见 [`benchmarks/`](../../../../benchmarks/) 目录。

功能矩阵、性能数据和错误反馈的完整结果，运行 `./benchmarks/run-all.sh` 后查看 `benchmarks/results/` 下的 Markdown 文件。

用到的关键工具和版本：

| 工具 | 用途 | 版本（示例） |
|------|------|-------------|
| [hyperfine](https://github.com/sharkdp/hyperfine) | 命令行计时 | 1.19+ |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | glob + grep 候选 | 14.1+ |
| [fd](https://github.com/sharkdp/fd) | glob 候选 | 10.2+ |
| [ag](https://github.com/ggreer/the_silver_searcher) | grep 候选 | 2.2+ |
| Node.js | Node API 候选 | 22+ |
| npm `glob` | glob 候选 | 11+ |

## 5. 回到主线

benchmark 的结论和 [D01 定性分析](../../../../.discuss/2026-03-29/e01-s003-glob-repo-research/decisions/D01-glob-underlying-tech.md) 完全一致：**rg `--files`** 在性能、功能完整度、错误反馈三个维度上都是最优选择，加上 S002 已经接入了 rg，零增量成本。

这也印证了一条经验：**好的定性分析通常能给出正确方向**。Benchmark 的价值往往不是"推翻之前的判断"，而是"用数据确认判断的同时，发现定性分析难以触及的细节"——比如 `fs.glob` 的 globstar 行为异常、npm `glob` 在错误场景下静默退出等。

这些细节，如果只做定性分析，是很难提前发现的。

---

[Story README](../README.md) · [Backlog](../details/04-backlog.md) · [Benchmark 源码](../../../../benchmarks/)
