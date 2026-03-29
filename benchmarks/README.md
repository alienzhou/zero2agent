# Benchmarks

> 对 glob 文件搜索和 grep 内容搜索工具的功能、性能、错误反馈三维对比。
> 面向读者的教学内容，展示「用 Agent 辅助技术选型」的方法论。

## 前置条件

| 工具 | 用途 | 安装 |
|------|------|------|
| hyperfine | 计时工具 | `brew install hyperfine` |
| ripgrep (`rg`) | glob + grep 候选 | `brew install ripgrep` |
| fd | glob 候选 | `brew install fd` |
| ag | grep 候选 | `brew install the_silver_searcher` |
| Node.js v22+ | Node API 候选 | 系统已有 |
| pnpm | 安装语料依赖 | 系统已有 |

一键安装：

```bash
./benchmarks/setup.sh
```

## 语料

| 梯度 | 来源 | 版本 | 预估文件数 |
|------|------|------|-----------|
| small | zero2agent 项目拷贝 | 当前 HEAD | ~6,000 |
| medium | vitejs/vite | v8.0.3 | ~50k-80k |
| large | vercel/next.js | v16.2.1 | ~200k-400k |

语料存放在 `/tmp/zero2agent-bench/corpus/`，不在项目目录内。

```bash
# 单独准备语料（setup.sh 会自动执行）
./benchmarks/corpus/prepare.sh all       # 全部
./benchmarks/corpus/prepare.sh small     # 只准备 small
```

## 运行

```bash
# 全量运行（所有工具 × 所有维度 × 所有语料）
./benchmarks/run-all.sh

# 按工具类型
./benchmarks/run-all.sh glob             # 只跑 glob
./benchmarks/run-all.sh grep             # 只跑 grep

# 按维度
./benchmarks/run-all.sh glob features    # 只跑 glob 功能矩阵
./benchmarks/run-all.sh grep performance # 只跑 grep 性能

# 按语料
./benchmarks/run-all.sh glob performance small    # glob 性能 × small
./benchmarks/run-all.sh grep performance medium   # grep 性能 × medium

# 单独运行某个脚本
./benchmarks/glob/features.sh
./benchmarks/glob/performance.sh small
./benchmarks/grep/errors.sh
```

## 被测工具

### Glob（4 个）

| 工具 | 调用方式 | 说明 |
|------|---------|------|
| `rg --files` | 直接调用 | ripgrep 文件列举模式 |
| `fd` | 直接调用 | 专用文件搜索工具 |
| npm `glob` | `node glob/wrappers/npm-glob.mjs` | 最流行的 npm glob 包 |
| Node `fs.glob` | `node glob/wrappers/node-fs-glob.mjs` | Node 22+ 内置 API |

### Grep（4 个）

| 工具 | 调用方式 | 说明 |
|------|---------|------|
| `rg` | 直接调用 | ripgrep 内容搜索模式 |
| `grep` | 直接调用 | 系统内置 |
| `ag` | 直接调用 | The Silver Searcher |
| Node 自实现 | `node grep/wrappers/node-grep.mjs` | 纯 Node 实现 |

## 公平性原则

1. **同一语料**：所有工具跑同一目录树
2. **统一跳过 ignore**：rg/fd 加 `--no-ignore --hidden`，ag 加 `-u`，纯比底层性能
3. **不引入胶水层**：CLI 工具直接调用；Node API 工具仅用最小化 `.mjs` wrapper（3-15 行）
4. **统一计时**：hyperfine `--warmup 3 --min-runs 10`
5. **排除 I/O 干扰**：性能测试时 stdout → `/dev/null`
6. **跑前校验**：性能测试前验证各工具结果数量一致

## 测试维度

### 功能矩阵（features）

| 维度 | Glob 测试项 | Grep 测试项 |
|------|------------|------------|
| 基础匹配 | globstar `**/*.ts` | 字面量、正则 |
| 高级 pattern | brace `{}`、字符类 `[]` | 大小写不敏感、上下文行 |
| 工程特性 | .gitignore 尊重、隐藏文件 | .gitignore 尊重、文件类型过滤 |
| 边界处理 | 不存在目录、空 pattern | 无效正则、二进制文件 |

### 性能（performance）

用 hyperfine 在三种语料上计时，对比 mean ± σ。

| Glob 场景 | Grep 场景 |
|----------|----------|
| G-P01 全量列文件 | S-P01 高频字面量 |
| G-P02 扩展名过滤 `.ts` | S-P02 低频字面量 |
| G-P03 多扩展名 | S-P03 简单正则 |
| G-P04 精确文件名 | S-P04 复杂正则 |
| G-P05 深层路径 | S-P05 大小写不敏感 |

### 错误反馈（errors）

捕获四种异常场景下各工具的 exit code 和 stderr，评估 Agent 可用性。

| 场景 |
|------|
| E01 无效 pattern/regex |
| E02 目录不存在 |
| E03 权限不足 |
| E04 空输入 |

## 结果

运行后结果写入 `benchmarks/results/`（已 gitignore，不入库）：

```
results/
├── corpus-manifest.json          # 各语料实际文件数
├── node-baseline.md              # Node.js 启动开销基线
├── glob/
│   ├── features.md               # 功能矩阵
│   ├── performance.md            # 性能汇总
│   ├── perf-{corpus}-{id}.md    # 各场景原始数据
│   └── errors.md                 # 错误反馈
└── grep/
    ├── features.md
    ├── performance.md
    ├── perf-{corpus}-{id}.md
    └── errors.md
```

教学用的结果表格由作者手动整理到 spec 文档中。

## 目录结构

```
benchmarks/
├── README.md           # 本文件
├── setup.sh            # 一键安装工具 + 准备语料
├── run-all.sh          # 一键运行（支持筛选）
├── package.json        # npm glob 依赖
├── corpus/
│   ├── prepare.sh      # 克隆/拷贝语料
│   └── commits.json    # 锁定版本信息
├── glob/
│   ├── wrappers/
│   │   ├── npm-glob.mjs        # 4 行 npm glob wrapper
│   │   └── node-fs-glob.mjs    # 4 行 fs.glob wrapper
│   ├── features.sh
│   ├── performance.sh
│   └── errors.sh
├── grep/
│   ├── wrappers/
│   │   └── node-grep.mjs       # 15 行 Node grep wrapper
│   ├── features.sh
│   ├── performance.sh
│   └── errors.sh
└── results/            # gitignored，每次运行重新生成
```
