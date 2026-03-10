# zero2agent 启动指南

## 项目概述
这是一个 pnpm monorepo 项目，包含三个子包：shared（共享类型和工具）、core（核心 Agent 逻辑）、tui（终端 UI/CLI）。项目使用 TypeScript 开发，需要先构建才能运行。

## 快速启动

### 方式一：开发模式（推荐）

在根目录运行，会并行启动所有包的开发模式：

```bash
pnpm dev
```

**说明**：此命令会并行执行所有子包的 `tsc --watch`，实时编译 TypeScript 文件。

```yaml
subProjectPath: .
command: pnpm dev
cwd: .
port: null
previewUrl: null
description: 并行启动所有子包的开发模式，实时编译 TypeScript
```

### 方式二：构建后运行 CLI

如果需要运行 CLI 工具：

```bash
# 1. 先构建所有包
pnpm build

# 2. 运行 CLI
cd packages/tui
npm start
```

**启动后运行**：CLI 会在终端中启动

```yaml
subProjectPath: packages/tui
command: npm start
cwd: packages/tui
port: null
previewUrl: null
description: 运行 zero2agent CLI 工具
```

## 各子包说明

### packages/shared - 共享模块

```bash
cd packages/shared
pnpm dev
```

```yaml
subProjectPath: packages/shared
command: pnpm dev
cwd: packages/shared
port: null
previewUrl: null
description: 共享类型和工具库，提供给其他包使用
```

### packages/core - 核心逻辑

```bash
cd packages/core
pnpm dev
```

```yaml
subProjectPath: packages/core
command: pnpm dev
cwd: packages/core
port: null
previewUrl: null
description: 核心 Agent 逻辑实现
```

### packages/tui - 终端 UI

```bash
cd packages/tui
pnpm dev
```

```yaml
subProjectPath: packages/tui
command: pnpm dev
cwd: packages/tui
port: null
previewUrl: null
description: 终端 UI/CLI 应用，依赖 core 和 shared
```

## 前置要求

- Node.js >= 22.0.0
- pnpm >= 9.0.0

首次运行请先安装依赖：

```bash
pnpm install
```
