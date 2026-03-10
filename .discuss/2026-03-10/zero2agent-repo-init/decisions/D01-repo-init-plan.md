# D01: Zero2Agent 仓库初始化方案

> 决策日期：2026-03-10
> 状态：已确认

## 决策摘要

确定 zero2agent 项目的仓库结构、技术栈和开发工作流。

## 核心决策

### 技术栈
- **语言**: TypeScript/Node.js
- **包管理**: pnpm workspaces
- **Node 版本**: >=22.0.0
- **pnpm 版本**: >=9.0.0

### Monorepo 架构

采用 pnpm workspaces，packages/ 下平铺三个包：

| 包名 | 职责 |
|------|------|
| `@zero2agent/core` | Agent 核心逻辑 |
| `@zero2agent/tui` | Terminal UI / CLI 应用 |
| `@zero2agent/shared` | 共享类型和工具代码 |

### 目录结构

```
zero2agent/
├── packages/
│   ├── core/               # @zero2agent/core
│   ├── tui/                # @zero2agent/tui
│   └── shared/             # @zero2agent/shared
├── specs/                  # SDD spec 文档
├── retros/                 # 复盘与经验总结
├── docs/                   # 项目文档
├── .discuss/               # 讨论记录
├── .vibecoding/            # AI 交互记录（按迭代组织）
├── CHANGELOG.md            # 按迭代序号组织
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── .gitignore
```

### 迭代管理

- **迭代序号格式**: `E001`, `E002`, ... （三位数）
- **Git tag 格式**: `E001-{slug}`（如 `E001-agent-loop`）
- **CHANGELOG**: 按迭代序号组织，不用传统语义化版本
- **仓库初始化不算迭代**，E001 留给"实现基础 Agent 循环"

### 版本约束

采用宽松约束，在 README 中说明推荐版本：
- `"node": ">=22.0.0"`
- `"pnpm": ">=9.0.0"`
- 推荐版本：Node.js 22.15.1, pnpm 9.5.0

## 被否决的方案

| 方案 | 否决原因 |
|------|----------|
| 传统语义化版本号 | 不符合教学项目的迭代叙事 |
| Turborepo/Nx | 对三个包的项目 overkill |
| apps/ + packages/ 分离 | 增加复杂度，无明显收益 |
| 精确版本锁定 | 降低用户灵活度 |
