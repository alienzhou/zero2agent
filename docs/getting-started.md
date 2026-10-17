# 快速上手指南

> 5 分钟让项目跑起来，10 分钟理解项目结构。

---

## 环境准备

### 必需工具

| 工具 | 版本要求 | 检查命令 |
|------|----------|----------|
| Node.js | >= 22.0.0 | `node -v` |
| pnpm | >= 9.0.0 | `pnpm -v` |
| Git | >= 2.30 | `git --version` |

### 安装 pnpm（如果没有）

```bash
# 使用 Node.js 自带的 corepack
corepack enable
corepack prepare pnpm@latest --activate

# 或者用 npm 安装
npm install -g pnpm
```

---

## 三步跑起来

```bash
# 1. 克隆项目
git clone git@github.com:alienzhou/zero2agent.git
cd zero2agent

# 2. 安装依赖
pnpm install

# 3. 构建
pnpm build
```

普通 Agent 对话需要先完成下方 API key 配置，再从仓库根目录运行 `node packages/tui/dist/cli.js`；没有密钥也可使用 main 中的 S004 独立人工终端。

### 不调用模型，先试人工终端

在包含 S004 的版本构建后，用真实终端运行：

```sh
node packages/tui/dist/cli.js --terminal
```

单独输入 `y` 并回车，等 bash 提示符出现后再逐行输入命令。可启动 `NODE_REPL_HISTORY= node`，计算后输入 `.exit` 回到 bash，最后 `exit` 回到原命令行。`Ctrl-]` 中止整场接管；Ctrl-C/D 的效果由当前程序决定。

独立入口不要求 API key，也不加载 `.env.local`。已配置的 Agent REPL 中可用 `/terminal`，结束后返回对话；直接入口的回执只在本地显示，不自动加入模型上下文。当前限 POSIX 真实 TTY，macOS 已实测、Linux 未实测、Windows 不支持。

版本获取、依赖与两项完整练习见 [S004 跟练](../specs/E02-act-and-execute/S004-interactive-commands/follow-along.md)和 [Node / less 试用](../specs/E02-act-and-execute/S004-interactive-commands/try-two-features.md)。S004 已合入 `main`；固定提交方式仍可复现本课版本。

---

## API KEY 配置

运行 Agent 需要配置 LLM API KEY：

### 方式 1：Anthropic（默认）

```bash
# 设置环境变量
export ANTHROPIC_API_KEY="your-api-key"

# 然后运行
node packages/tui/dist/cli.js
```

**获取 API KEY**：https://console.anthropic.com/

### 方式 2：兼容 API 提供商（如 MiniMax）

本项目只使用 Anthropic 官方 SDK，因此**任何提供 Anthropic 兼容端点的厂商都能直接接入**，改一个 `baseURL` 即可：

```bash
# 配置 MiniMax
export ANTHROPIC_BASE_URL="https://api.minimaxi.com/anthropic"
export ANTHROPIC_API_KEY="your-minimax-api-key"
export MODEL_NAME="MiniMax-M2.7"

# 然后运行
node packages/tui/dist/cli.js
```

**获取 MiniMax API KEY**：https://platform.minimaxi.com/

> ⚠️ 注意区分两个端点：`/anthropic` 是 Anthropic 兼容端点，`/v1` 是 OpenAI 兼容端点。
> 本项目用的是 Anthropic SDK，必须填 `/anthropic`，填 `/v1` 会直接 404。
>
> 国内站点用 `https://api.minimaxi.com/anthropic`，
> Global 站点用 `https://api.minimax.io/anthropic`。

### 方式 3：使用 .env.local 文件（推荐）

反复调试时不必每次 export，把配置写进 `.env.local` 即可。该文件已在 `.gitignore` 中，不会误提交 API KEY：

```bash
# 从模板复制一份，然后填入自己的 KEY
cp .env.example .env.local
```

仓库根目录的 `.env.local` 会被自动加载，改完直接运行：

```bash
node packages/tui/dist/cli.js
```

### 环境变量说明

| 变量 | 必需 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | API 密钥 |
| `ANTHROPIC_BASE_URL` | ❌ | API 地址，默认 Anthropic 官方；换厂商时填其 Anthropic 兼容端点 |
| `MODEL_NAME` | ❌ | 模型名称，默认 `claude-sonnet-4-20250514` |

---

## 项目规则与 AGENTS.md

构建后可在当前目录执行 `node <仓库路径>/packages/tui/dist/cli.js --instructions` 查看规则，无需模型密钥。默认只在启动 cwd 以内发现；从子目录启动时可通过 `--instructions-root <项目根>` 明确读取上层规则。它不改变文件工具的写入边界。

plain/TUI 的 `/instructions` 查看最近读取版本与上次模型请求实际使用的版本；`/instructions refresh` 重读，`/instructions off` 关闭，`/instructions on` 开启。单次关闭用 `--no-instructions` 或 `ZERO2AGENT_NO_INSTRUCTIONS=1`。自动读取仍服从 read_file 当前权限；规则缺失和读取被拒绝会分别显示。

遵循普通 Markdown 的 [AGENTS.md 开放格式](https://agents.md/)，无必填字段。嵌套约定仅作用于相应目录，明确用户要求优先；项目文件无法批准工具。完整容量、恢复语义及无需密钥的双包跟练见 [E05-S001](../specs/E05-extensibility/S001-project-instructions/README.md)。

## Skills 按需加载

在项目的 `.agents/skills/fix-with-tests/SKILL.md` 放入带 `name`、`description` YAML 头部的 Markdown。名称须与技能目录相同；默认只发现启动 cwd 的这一个集合，不自动查找 home 或父目录。

```bash
# 查看摘要，无需模型密钥
node packages/tui/dist/cli.js --skills
# 明确选择后执行任务
node packages/tui/dist/cli.js --skill fix-with-tests "修复金额计算并补测试"
# 显式追加集合目录或单个技能目录
node packages/tui/dist/cli.js --skill-root /path/to/skills --skills
```

plain/TUI 中用 `/skills` 查看来源、状态、当前版本与有限资源读取记录；`/skills load <名称或来源ID>` 选择，`/skills unload <名称或来源ID>` 卸载，`/skills refresh` 重读，`/skills off` 和 `/skills on` 控制开关。单次关闭使用 `--no-skills` 或 `ZERO2AGENT_NO_SKILLS=1`。

模型先看到名称/描述目录，可调用 `load_skill`；下一次请求才包含选中正文，参考文件由 `read_skill_resource` 按相对技能根分页读取。外部显式目录仍须经过读取许可；加载不启动脚本，`allowed-tools` 只显示未实现权限语义的警告。恢复只恢复选择，按当前文件和权限重新加载。无需密钥的真实文件跟练、格式说明与完整上限见 [E05-S002](../specs/E05-extensibility/S002-skills/README.md)。

## 运行日志与故障追查

S005 默认把请求、工具、权限与保存元信息写入本地日志。构建后用 `/logs` 选择运行，Enter 进入独立查看器，方向键、Page、Home/End 滚动，Esc 返回并保留草稿。

```bash
node packages/tui/dist/cli.js --logs
node packages/tui/dist/cli.js --log <run-UUID>
node packages/tui/dist/cli.js --log <run-UUID> --log-operation <operation-UUID>
node packages/tui/dist/cli.js --no-save --no-log
```

列表和查看不需要 API key，不执行旧工具。`--no-save` 与 `--no-log` 分别关闭新快照和新日志；日志根目录可用 `ZERO2AGENT_LOG_DIR` 设置。运行记录不包含问题、回复、文件或工具正文及人工终端字节；缺少结束记录时，先检查实际效果再继续。

请求开始的 `requested-model` 是实际发送的配置名称，完整响应的 `reported-model` 是服务自报名称，两者可能不同。后者缺失时表示没有可记录的回执，不推断与请求名相同；它也不能证明实际模型身份。旧日志没有该字段时仍可查看。

完整体验与固定版本获取见 [S005 跟练](../specs/E03-product-foundations/S005-runtime-logging/follow-along.md)。

---

## 文件 Checkpoint 与回退

在包含 S006 的版本中，专用文件工具默认保存改动前后版本。TUI 输入 `/checkpoints`，选择记录按 Enter 看差异，再按 r 预览恢复范围、y 确认；Esc 返回并保留输入草稿。回退要求 Agent 空闲且已登记后台命令结束。

```bash
node packages/tui/dist/cli.js --checkpoints
node packages/tui/dist/cli.js --checkpoint <UUID>
node packages/tui/dist/cli.js --undo <UUID>
# 阅读预览，复制本次令牌后确认
node packages/tui/dist/cli.js --undo <UUID> --confirm <预览令牌>
node packages/tui/dist/cli.js --checkpoint-stats
node packages/tui/dist/cli.js --checkpoint-prune
```

这些管理命令不需要 API key。`--no-checkpoints` 单独关闭新文件保护，`--no-save` / `--no-log` 不会关闭它。文件正文压缩去重后放在工作区之外，默认目录为 `~/.zero2agent/checkpoints`；可用 `ZERO2AGENT_CHECKPOINT_DIR` 指定其他外部目录，内容不加密。默认保留最多 50 条完成记录、30 天、256 MiB，有未结算记录时先检查实际文件，再通过 `--recover <UUID>` 预览和确认恢复。

保护范围为 write_file、replace_in_file、delete 的目标文件，不包括 shell、人工终端和外部系统。若文件在快照后被改过，回退报告冲突。恢复只影响文件；独立 CLI 不改写其他已保存会话。完整限制、固定版本和无需密钥的演示见 [S006 跟练](../specs/E03-product-foundations/S006-file-checkpoints/follow-along.md)。

---

## 项目结构速览

```
zero2agent/
├── packages/              # 📦 核心代码
│   ├── core/              #    Agent 核心逻辑
│   ├── tui/               #    CLI 界面
│   └── shared/            #    共享工具
│
├── specs/                 # 📝 Story 入口与技术设计文档
├── retros/                # 🔍 复盘笔记（每个迭代的反思）
├── docs/                  # 📖 用户文档（你正在看的）
│
├── .vibecoding/           # 🤖 AI 协作记录
├── .discuss/              # 💬 需求讨论记录
│
├── AGENTS.md              # AI Agent 协作规范
├── CHANGELOG.md           # 迭代日志
└── README.md              # 项目介绍
```

### 三个核心 Package

| Package | 说明 | 入口文件 |
|---------|------|----------|
| `@zero2agent/core` | Agent 核心逻辑，包含循环、工具调用等 | `packages/core/src/index.ts` |
| `@zero2agent/tui` | 终端用户界面（CLI） | `packages/tui/src/cli.ts` |
| `@zero2agent/shared` | 共享工具函数和类型定义 | `packages/shared/src/index.ts` |

---

## 常用命令

### 开发命令

```bash
# 安装所有依赖
pnpm install

# 构建所有 packages
pnpm build

# 运行 CLI
node packages/tui/dist/cli.js

# 只构建某个 package
pnpm --filter @zero2agent/core build

# 运行测试
pnpm test

# 代码检查
pnpm lint
pnpm lint:fix    # 自动修复

# 格式化代码
pnpm format
```

### 清理重建

```bash
# 如果遇到奇怪的问题，试试清理重建
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm build
```

---

## 跟着迭代学习

这个项目的核心价值是**透明的开发过程**。每个迭代都有：

1. **设计文档**（`specs/E0x-epic-slug/S0xx-story-slug/`，技术细节在 `details/`）- 开始前写，说明要做什么、为什么这么做
2. **代码实现**（`packages/`）- 实际代码
3. **复盘笔记**（`retros/Exx-Sxxx-name.md`）- 完成后写，反思哪里做得好/不好
4. **Git Tag**（`Exx-Sxxx-name`）- 可以 checkout 到任意迭代

### 切换到某个迭代

```bash
# 查看所有迭代 tag
git tag -l "E*"

# 切换到某个迭代
git checkout E01-S001-react-basic

# 回到最新
git checkout main
```

### 推荐学习路径

1. **先跑起来** - 确保环境没问题
2. **看设计文档** - 理解这个迭代要做什么
3. **看代码** - 对照设计文档理解实现
4. **看复盘** - 学习经验教训
5. **自己改** - Fork 后动手是最好的学习方式

---

## 下一步

- 📖 [项目架构](./architecture.md) - 深入理解代码组织
- 🗓️ [迭代日志](../CHANGELOG.md) - 查看各迭代学习要点
- 🤖 [AI 协作规范](../AGENTS.md) - 理解 AI 辅助开发流程

---

## 常见问题

### pnpm install 报错

```bash
# 确保 pnpm 版本够新
pnpm -v  # 需要 >= 9.0.0

# 清理缓存重试
pnpm store prune
pnpm install
```

### 构建失败

```bash
# 检查 Node.js 版本
node -v  # 需要 >= 22.0.0

# 清理后重新构建
rm -rf packages/*/dist
pnpm build
```

### 找不到模块

```bash
# 确保先构建依赖
pnpm build

# 或者只构建依赖的 package
pnpm --filter @zero2agent/shared build
pnpm --filter @zero2agent/core build
```
