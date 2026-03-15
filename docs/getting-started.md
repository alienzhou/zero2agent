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

# 3. 构建并运行
pnpm build
pnpm --filter @zero2agent/tui start
```

如果一切正常，你应该能看到 CLI 界面启动。

---

## API KEY 配置

运行 Agent 需要配置 LLM API KEY：

### 方式 1：Anthropic（默认）

```bash
# 设置环境变量
export ANTHROPIC_API_KEY="your-api-key"

# 然后运行
pnpm --filter @zero2agent/tui start
```

**获取 API KEY**：https://console.anthropic.com/

### 方式 2：兼容 API 提供商

本项目支持通过 `baseURL` 切换到兼容 Anthropic 格式的 API 提供商（如 MiniMax）：

```bash
# 配置 MiniMax
export ANTHROPIC_BASE_URL="https://api.minimaxi.com/v1"
export ANTHROPIC_API_KEY="your-minimax-api-key"
export MODEL_NAME="MiniMax-M1"

# 然后运行
pnpm --filter @zero2agent/tui start
```

**获取 MiniMax API KEY**：https://platform.minimaxi.com/

### 方式 3：使用 .env 文件

```bash
# 创建 .env 文件
cat > .env << EOF
ANTHROPIC_API_KEY=your-api-key
# 可选：使用兼容提供商
# ANTHROPIC_BASE_URL=https://api.minimaxi.com/v1
# MODEL_NAME=MiniMax-M1
EOF

# 然后运行（确保代码支持读取 .env）
pnpm --filter @zero2agent/tui start
```

### 环境变量说明

| 变量 | 必需 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | API 密钥 |
| `ANTHROPIC_BASE_URL` | ❌ | API 地址，默认 Anthropic 官方 |
| `MODEL_NAME` | ❌ | 模型名称，默认 `claude-sonnet-4-20250514` |

---

## 项目结构速览

```
zero2agent/
├── packages/              # 📦 核心代码
│   ├── core/              #    Agent 核心逻辑
│   ├── tui/               #    CLI 界面
│   └── shared/            #    共享工具
│
├── specs/                 # 📝 设计文档（每个迭代的 spec）
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
pnpm --filter @zero2agent/tui start

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

1. **设计文档**（`specs/Exx-Sxxx-name/`）- 开始前写，说明要做什么、为什么这么做
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
