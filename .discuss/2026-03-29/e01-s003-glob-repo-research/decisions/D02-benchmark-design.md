# D02 - Glob & Grep 技术选型 Benchmark 设计（最终方案）

> 状态：✅ 方案确认

## 背景

D01 完成了 Glob 底层技术选型的定性分析（五维框架 × 四个候选方案）。现在要设计一套**可运行的 Benchmark**，用实际数据验证定性结论。

Grep Search（S002）的技术选型当时也是纯定性分析，本次一并补上。

**教学定位：** 面向读者的教学内容，展示"用 Agent 快速辅助技术选型决策"。

---

## 一、公平性原则

> 这是整个 Benchmark 最重要的前提。

### 核心规则：同等条件，控制变量

1. **同一语料：** 所有工具跑同一个目录树，文件集合完全相同。
2. **同一目标：** 对于同一个 benchmark 场景，所有工具的任务等价（找到相同的文件 / 匹配到相同的结果）。运行前先校验各工具结果的一致性（文件数 / 匹配行数）。
3. **统一跳过 ignore：** rg/fd 加 `--no-ignore --hidden`，ag 加 `-u`（unrestricted），grep/Node 天然不管 ignore。纯比底层性能。
4. **不引入胶水层：** CLI 工具（rg、fd、grep、ag）**直接调用**，不套 wrapper 脚本。只有 Node API 工具（npm `glob`、`fs.glob`、Node grep）因为技术上必须通过 Node 进程执行，才用**最小化的 .mjs 脚本**包装。
5. **统一计时方式：** 全部用 hyperfine，相同 warmup 次数、相同运行轮数。
6. **输出重定向：** 性能测试时 stdout 重定向到 `/dev/null`，排除终端 I/O 干扰。

### Node 包装脚本的公平性说明

npm `glob` 和 `fs.glob` 是 Node API，不是 CLI 工具，必须通过 Node 进程调用。包装脚本遵循以下约束：

- **最小化**：仅含参数解析 → API 调用 → stdout 输出，不做任何额外处理
- **无中间层**：不引入额外 npm 包（如 yargs、commander），用 `process.argv` 直接取参数
- **Node 启动开销透明化**：单独测量一次 `node -e ""` 的空跑时间并记录，读者可自行对照

示例（npm glob wrapper，完整代码）：

```javascript
import { glob } from 'glob'
const [pattern, cwd] = process.argv.slice(2)
const files = await glob(pattern, { cwd, dot: true, nodir: true })
files.forEach(f => process.stdout.write(f + '\n'))
```

示例（Node grep wrapper，完整代码）：

```javascript
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const [pattern, dir] = process.argv.slice(2)
const re = new RegExp(pattern)

async function walk(d) {
  for (const ent of await readdir(d, { withFileTypes: true })) {
    const p = join(d, ent.name)
    if (ent.isDirectory()) { await walk(p); continue }
    const text = await readFile(p, 'utf8').catch(() => null)
    if (!text) continue
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) process.stdout.write(`${p}:${i + 1}:${line}\n`)
    })
  }
}
await walk(dir)
```

> 两段代码都是最直接的实现。没有美化、没有优化、没有额外依赖。这代表"如果你选择纯 Node 方案，你至少要写这么多代码"。

---

## 二、语料设计（3 个梯度）

### 设计原则

- **真实项目**：读者认得出来，也能自己复现
- **梯度差异 5-10 倍**：差距够大才能看到趋势
- **隔离存放**：克隆到 `/tmp/zero2agent-bench/corpus/`，不污染项目
- **锁定版本**：commit 固定，确保任何人任何时候跑都得到同样的文件树

### 语料清单

| 梯度 | 来源 | 版本 | 预估文件数 | 定位 |
|------|------|------|-----------|------|
| **Small** | 本项目 `zero2agent`（拷贝，含 node_modules） | 当前 HEAD | ~6,000 | 个人/教学项目 |
| **Medium** | `vitejs/vite` + `pnpm install` | `v8.0.3` (`a248a41`) | ~50,000-80,000 | 中型工具库 |
| **Large** | `vercel/next.js` + `pnpm install` | `v16.2.1` (`ed7d2ce`) | ~200,000-400,000 | 大型 monorepo |

### 语料准备流程

```bash
BENCH_ROOT="/tmp/zero2agent-bench/corpus"

# Small: rsync 拷贝当前项目（不含 .git，避免 git 状态干扰）
rsync -a --exclude='.git' "$(pwd)/" "$BENCH_ROOT/small/"

# Medium: Vite
git clone https://github.com/vitejs/vite.git "$BENCH_ROOT/medium"
cd "$BENCH_ROOT/medium" && git checkout v8.0.3 && pnpm install

# Large: Next.js
git clone https://github.com/vercel/next.js.git "$BENCH_ROOT/large"
cd "$BENCH_ROOT/large" && git checkout v16.2.1 && pnpm install

# 记录实际文件数（运行完打印，写入 results）
for size in small medium large; do
  echo "$size: $(find "$BENCH_ROOT/$size" -type f | wc -l) files"
done
```

准备完成后将实际文件数写入 `benchmarks/corpus/manifest.json`（梯度 → 文件数 → 目录数），作为 benchmark 报告的基础数据。

---

## 三、被 Benchmark 的工具

### Glob（4 个）

| # | 工具 | 性能测试调用方式 | 安装 |
|---|------|-----------------|------|
| 1 | ripgrep | `rg --files --no-ignore --hidden --glob='<pattern>' <dir>` | `brew install ripgrep` |
| 2 | fd | `fd --no-ignore --hidden -g '<pattern>' <dir>` | `brew install fd` |
| 3 | npm `glob` | `node glob/wrappers/npm-glob.mjs '<pattern>' <dir>` | `npm install glob` |
| 4 | Node `fs.glob` | `node glob/wrappers/node-fs-glob.mjs '<pattern>' <dir>` | Node 22+ 内置 |

**pattern 语法差异说明：**

不同工具的 pattern 语义不完全一致。以"递归查找所有 `.ts` 文件"为例：

| 工具 | 等价写法 | 原因 |
|------|---------|------|
| rg `--files` | `--glob='*.ts'` | rg 的 `--glob` 使用 gitignore 风格，`*.ts` 自动递归 |
| fd | `-g '*.ts'` | fd 默认匹配文件名（非路径），天然递归 |
| npm `glob` | `'**/*.ts'` | 标准 glob 语法，需要 `**` 显式递归 |
| Node `fs.glob` | `'**/*.ts'` | 同上 |

> **公平性保证**：pattern 写法不同不影响公平性。关键是最终结果集一致。每组性能测试开始前，先跑一次各工具并 `wc -l` 比较输出行数，确认结果等价。

### Grep（4 个）

| # | 工具 | 性能测试调用方式 | 安装 |
|---|------|-----------------|------|
| 1 | ripgrep | `rg --no-ignore --hidden '<pattern>' <dir>` | `brew install ripgrep` |
| 2 | 系统 grep | `grep -rn '<pattern>' <dir>` | 系统内置 |
| 3 | ag | `ag -u '<pattern>' <dir>` | `brew install the_silver_searcher` |
| 4 | Node 自实现 | `node grep/wrappers/node-grep.mjs '<pattern>' <dir>` | Node 内置 |

> **为什么选这四个？** 对应 S002 分析的四类技术路线：成熟开源库 → rg、系统内置 → grep、其他第三方 → ag、自行实现 → Node。

### 计时工具

**hyperfine**（`brew install hyperfine`）：
- ripgrep 官方 benchmark 同款
- 自动多次运行 + 统计分析（mean / σ / min / max）
- `--warmup 3`：前 3 次不计入统计（排除冷缓存）
- `--min-runs 10`：至少 10 次取统计值
- `--export-markdown`：直接输出 Markdown 表格
- `--export-json`：原始数据留底

---

## 四、Benchmark 用例

### A. 功能矩阵（Feature Matrix）

**目标：** 每个工具跑一组标准用例，输出 pass/fail 矩阵。用实际执行结果验证 D01 的定性判断。

#### Glob 功能用例

| ID | 用例 | 预期行为 | 验证方法 |
|----|------|---------|---------|
| G-F01 | `**/*.ts`（globstar） | 递归找所有 .ts 文件 | 结果非空 + 全部以 `.ts` 结尾 |
| G-F02 | `{package,tsconfig}.json`（brace） | 只匹配这两个文件名 | 结果只含 `package.json` 和 `tsconfig.json` |
| G-F03 | `**/[A-Z]*.ts`（字符类） | 首字母大写的 .ts 文件 | 结果文件名首字母均为大写 |
| G-F04 | `.gitignore` 尊重 | 默认配置下是否排除 `node_modules` | 对比默认输出 vs `--no-ignore` 输出的文件数差异 |
| G-F05 | 隐藏文件 | 能否找到 `.env` | 在语料根目录放 `.env`，检查是否命中 |
| G-F06 | 不存在的目录 | 报错 | 检查 exit code + stderr |
| G-F07 | 空 pattern | 报错或返回全部 | 记录行为 |

#### Grep 功能用例

| ID | 用例 | 预期行为 | 验证方法 |
|----|------|---------|---------|
| S-F01 | 字面量 `"import"` | 匹配含 import 的行 | 结果非空 + 含行号 |
| S-F02 | 正则 `function\s+\w+` | 正则匹配 | 结果行符合正则 |
| S-F03 | 大小写不敏感 | `README` 和 `readme` 都匹配 | 比较 `-i` vs 默认的结果数差异 |
| S-F04 | 上下文行 `-C 2` | 输出前后各 2 行 | 输出行数 > 匹配行数 |
| S-F05 | 文件类型过滤 | 只搜 `.ts` 文件 | 结果路径全为 `.ts` |
| S-F06 | `.gitignore` 尊重 | 默认是否排除 | 同 G-F04 |
| S-F07 | 无效正则 `[unclosed` | 报错 | 检查 exit code + stderr |
| S-F08 | 二进制文件 | 跳过或标注 | 在语料中放二进制文件，检查行为 |

### B. 性能测试（Performance）

**目标：** 用 hyperfine 在 3 种语料上分别计时，输出对比表。

**统一条件：**
- `--no-ignore --hidden`（或等价配置）
- stdout → `/dev/null`
- `--warmup 3 --min-runs 10`
- 跑前校验结果数一致

#### Glob 性能场景

| ID | 场景 | 意图 |
|----|------|------|
| G-P01 | 全量列文件 | 纯 IO 遍历上限（不做模式匹配） |
| G-P02 | 扩展名过滤 `.ts` | 最常见的 glob 用法 |
| G-P03 | 多扩展名 `.{ts,tsx,js,jsx}` | brace expansion + 递归 |
| G-P04 | 精确文件名 `package.json` | 定位特定文件 |
| G-P05 | 深层路径 `src/**/*.test.ts` | 多级 `**` |

各工具的等价命令：

**G-P01（全量列文件）：**

```bash
hyperfine --warmup 3 --min-runs 10 \
  --export-markdown results/glob/perf-G-P01.md \
  "rg --files --no-ignore --hidden $DIR > /dev/null" \
  "fd --no-ignore --hidden . $DIR > /dev/null" \
  "node glob/wrappers/npm-glob.mjs '**/*' $DIR > /dev/null" \
  "node glob/wrappers/node-fs-glob.mjs '**/*' $DIR > /dev/null"
```

**G-P02（扩展名过滤 .ts）：**

```bash
hyperfine --warmup 3 --min-runs 10 \
  "rg --files --no-ignore --hidden --glob '*.ts' $DIR > /dev/null" \
  "fd --no-ignore --hidden -g '*.ts' $DIR > /dev/null" \
  "node glob/wrappers/npm-glob.mjs '**/*.ts' $DIR > /dev/null" \
  "node glob/wrappers/node-fs-glob.mjs '**/*.ts' $DIR > /dev/null"
```

> G-P03 ~ G-P05 按同样模式组装，仅替换 pattern。

#### Grep 性能场景

| ID | 场景 | Pattern | 意图 |
|----|------|---------|------|
| S-P01 | 高频字面量 | `import` | 大量匹配 |
| S-P02 | 低频字面量 | `deprecated` | 少量匹配 |
| S-P03 | 简单正则 | `function\s+\w+` | 正则开销 |
| S-P04 | 复杂正则 | `\b[A-Z][a-z]+Error\b` | 回溯密集 |
| S-P05 | 大小写不敏感 | `readme` + 对应 flag | 额外开销 |

**S-P01（高频字面量）：**

```bash
hyperfine --warmup 3 --min-runs 10 \
  "rg --no-ignore --hidden 'import' $DIR > /dev/null" \
  "grep -rn 'import' $DIR > /dev/null" \
  "ag -u 'import' $DIR > /dev/null" \
  "node grep/wrappers/node-grep.mjs 'import' $DIR > /dev/null"
```

#### Node 启动开销基线

作为参考数据，单独测量一次空 Node 进程启动时间：

```bash
hyperfine --warmup 3 'node -e ""'
```

此数据记录在结果中，供读者参照：Node 方案的计时包含了这段固定开销。

### C. 错误反馈测试（Error Feedback）

**目标：** 捕获每个工具面对错误输入时的反馈质量。

| ID | 场景 | 输入 |
|----|------|------|
| E01 | 无效 pattern | `[unclosed`（对 glob 和 grep 都适用） |
| E02 | 目录不存在 | `/nonexistent/path` |
| E03 | 权限不足 | 创建一个 `chmod 000` 的目录作为搜索目标 |
| E04 | 空输入 | pattern 为空字符串 |

每个场景对每个工具执行，记录：

| 字段 | 说明 |
|------|------|
| exit code | 进程退出码 |
| stderr | 完整错误输出文本 |
| 是否指出错误位置 | 如 "position 3" 或箭头标记 |
| Agent 可用性评分 | 1-5 分：1=无用 5=可直接返回给模型修正 |

---

## 五、输出格式

### 文件产出

| 文件 | 内容 | 格式 |
|------|------|------|
| `results/{glob,grep}/performance.md` | hyperfine 输出的 Markdown 对比表 | Markdown |
| `results/{glob,grep}/performance.json` | hyperfine 原始统计数据 | JSON |
| `results/{glob,grep}/features.md` | 功能矩阵 pass/fail 表 | Markdown |
| `results/{glob,grep}/errors.md` | 错误反馈对比 | Markdown |
| `results/corpus-manifest.json` | 语料实际文件数/目录数 | JSON |
| `results/node-baseline.md` | Node 空跑开销 | Markdown |

### 示例：性能结果表

```markdown
## Glob 性能 - Medium 语料（Vite v8.0.3, N files）

| 场景 | rg --files | fd | npm glob | Node fs.glob |
|------|-----------|-----|---------|-------------|
| G-P01 全量列文件 | 45ms ± 3ms | 32ms ± 2ms | 312ms ± 15ms | 287ms ± 12ms |
| G-P02 *.ts | 38ms ± 2ms | 28ms ± 2ms | 298ms ± 14ms | 271ms ± 11ms |
| G-P03 多扩展名 | 42ms ± 3ms | 31ms ± 2ms | 305ms ± 13ms | 280ms ± 12ms |
| G-P04 package.json | 35ms ± 2ms | 26ms ± 2ms | 290ms ± 12ms | 265ms ± 10ms |
| G-P05 深层路径 | 40ms ± 3ms | 30ms ± 2ms | 300ms ± 14ms | 275ms ± 11ms |

> Node 空跑基线：52ms ± 3ms
```

### 示例：功能矩阵表

```markdown
## Glob 功能矩阵

| 功能 | rg --files | fd | npm glob | Node fs.glob |
|------|-----------|-----|---------|-------------|
| G-F01 globstar ** | ✅ | ✅ | ✅ | ✅ |
| G-F02 brace {} | ✅ | ✅ | ✅ | ✅ |
| G-F03 字符类 [] | ✅ | ✅ | ✅ | ✅ |
| G-F04 .gitignore | ✅ 默认 | ✅ 默认 | ❌ 需手配 | ❌ 无 |
| G-F05 隐藏文件 | ✅ --hidden | ✅ --hidden | ✅ dot:true | ❌ 需手动 |
| G-F06 错误：不存在目录 | exit 2 | exit 1 | 空数组 | throw Error |
| G-F07 错误：空 pattern | 列全部文件 | 列全部文件 | 空数组 | throw Error |
```

---

## 六、目录结构

```
benchmarks/
├── README.md                    # 说明 + 前置条件 + 运行方式 + 结果解读
├── setup.sh                     # 一键：安装工具(brew) + 准备语料(clone+install)
│
├── corpus/
│   ├── prepare.sh               # 克隆/拷贝 + pnpm install + 统计文件数
│   └── commits.json             # 锁定版本信息
│
├── glob/
│   ├── wrappers/                # 仅 Node API 工具需要的最小包装
│   │   ├── npm-glob.mjs         # ~4 行
│   │   └── node-fs-glob.mjs     # ~4 行
│   ├── features.sh              # 功能矩阵 benchmark
│   ├── performance.sh           # 性能 benchmark（hyperfine）
│   └── errors.sh                # 错误反馈 benchmark
│
├── grep/
│   ├── wrappers/
│   │   └── node-grep.mjs        # ~15 行（walk + regex match）
│   ├── features.sh
│   ├── performance.sh
│   └── errors.sh
│
├── run-all.sh                   # 一键运行全部（或指定 glob/grep + 指定语料）
│
└── results/                     # gitignore，每次运行重新生成
    ├── corpus-manifest.json
    ├── node-baseline.md
    ├── glob/
    │   ├── features.md
    │   ├── performance.md
    │   ├── performance.json
    │   └── errors.md
    └── grep/
        ├── features.md
        ├── performance.md
        ├── performance.json
        └── errors.md
```

> **注意**：`results/` 目录 gitignore。每次跑 benchmark 重新生成，不存历史结果。教学用的结果截图/表格由作者手动拷贝到 Spec deep-dive 文档中。

---

## 七、运行方式

```bash
# 首次：安装工具 + 准备语料（耗时较长，Next.js install 可能 5-10 分钟）
./benchmarks/setup.sh

# 全量运行
./benchmarks/run-all.sh

# 按类型运行
./benchmarks/run-all.sh glob          # 只跑 glob
./benchmarks/run-all.sh grep          # 只跑 grep

# 按维度运行
./benchmarks/glob/performance.sh      # 只跑 glob 性能
./benchmarks/grep/features.sh         # 只跑 grep 功能矩阵

# 按语料运行
./benchmarks/glob/performance.sh small    # 只在小语料上跑
./benchmarks/glob/performance.sh medium   # 只在中语料上跑
```

---

## 八、前置条件

| 工具 | 用途 | 安装 |
|------|------|------|
| hyperfine | 计时 | `brew install hyperfine` |
| ripgrep | glob + grep 候选 | `brew install ripgrep` |
| fd | glob 候选 | `brew install fd` |
| ag | grep 候选 | `brew install the_silver_searcher` |
| Node 22+ | Node API 候选 + wrapper | 已有（v24.14.0） |
| pnpm | 语料安装依赖 | 已有 |
| npm `glob` 包 | glob 候选 | benchmark 目录下 `npm install glob` |

`setup.sh` 会检查并提示缺失的工具。

---

## 九、决策记录

| 决策 | 结论 |
|------|------|
| 语料规模 | 小/中/大三梯度 |
| 语料来源 | zero2agent / Vite `v8.0.3` / Next.js `v16.2.1` |
| 语料隔离 | `/tmp/zero2agent-bench/corpus/`，不在项目目录内 |
| 版本锁定 | commit hash 固定，记录在 `commits.json` |
| 性能模式 | 仅 raw 模式（`--no-ignore`），纯比底层性能 |
| 计时工具 | hyperfine |
| Glob 工具 | rg `--files` / fd / npm `glob` / Node `fs.glob` |
| Grep 工具 | rg / system grep / ag / Node 自实现 |
| CLI 工具调用方式 | 直接调用，不加 wrapper |
| Node 工具调用方式 | 最小化 .mjs wrapper（3-15 行） |
| 输出格式 | Markdown 表格（图表后续补充） |
| results 目录 | gitignore，不存历史 |
