# Zero2Agent 仓库初始化方案讨论

## 🔵 Current Focus
- 执行仓库初始化

## ✅ Confirmed
- **D01**: 按类型分目录 + Git tag 标记迭代
- **D02**: 迭代序号格式 `E001`, `E002`, ... （三位数）
- **D03**: Git tag 用 `E001-{slug}` 格式，不用传统语义化版本号
- **D04**: CHANGELOG.md 按迭代序号组织
- **D05**: 技术栈选择 TypeScript/Node.js
- **D06**: Monorepo 三包架构：`@zero2agent/core`, `@zero2agent/tui`, `@zero2agent/shared`
- **D07**: 使用 pnpm workspaces 管理 monorepo
- **D08**: packages/ 下平铺
- **D09**: specs/ 和 retros/ 等非代码目录放根目录
- **D10**: Node.js >=22.0.0, pnpm >=9.0.0（宽松约束）
- **D11**: 仓库初始化不算迭代，E001 留给"实现基础 Agent 循环"
- 复用 `.discuss/` 作为需求讨论记录目录
- AI 交互记录目录命名为 `.vibecoding/`
- 复盘目录命名为 `retros/`

## ❌ Rejected
- 传统语义化版本号
- Turborepo/Nx
- apps/ + packages/ 分离结构
- 精确版本锁定

## 📋 Final Directory Structure

```
zero2agent/
├── packages/
│   ├── core/               # @zero2agent/core
│   ├── tui/                # @zero2agent/tui
│   └── shared/             # @zero2agent/shared
├── specs/                  # SDD spec 文档
├── retros/                 # 复盘
├── docs/                   # 项目文档
├── .discuss/               # 讨论记录
├── .vibecoding/            # AI 交互记录
├── CHANGELOG.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── .gitignore
```

## 🎉 Discussion Complete - Ready for Execution
