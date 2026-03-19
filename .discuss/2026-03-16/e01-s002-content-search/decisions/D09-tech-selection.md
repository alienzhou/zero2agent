# D09：技术选型 — ripgrep + @vscode/ripgrep

## 状态
✅ Confirmed

## 决策

底层搜索引擎使用 **ripgrep**，通过 **`@vscode/ripgrep`** npm 包分发。

### 分发策略

- MVP 阶段：`pnpm add @vscode/ripgrep`，install 时自动下载对应平台的 rg 二进制
- 运行时通过 `import { rgPath } from '@vscode/ripgrep'` 获取路径
- 不需要运行时网络请求，不需要自己管理下载逻辑

### 未来发布阶段

打包发布时需切换策略（放入扩展阅读）：
- 方案 1：内置二进制到产物中
- 方案 2：平台 optional dependencies（类似 esbuild 的做法）

## 竞品做法

| 项目 | ripgrep 来源 | 版本策略 |
|------|-------------|---------|
| OpenCode | 系统优先，fallback 自动下载 | 固定 14.1.1 |
| Codex | DotSlash 内置分发 | 固定 15.1.0 |
| Pi | 系统优先，fallback 下载最新版 | 动态获取最新 |
| Gemini CLI | 不信任系统 rg，只用自己下载的 | 自动下载 |

## 理由

1. ripgrep 性能和功能远超 Node.js 原生实现，且天然支持 .gitignore 规则
2. `@vscode/ripgrep` 是 VS Code 团队维护的，可靠性有保障
3. 下载时机在 `pnpm install`（开发者熟悉的环节），避免运行时网络问题
