# AGENTS.md

> AI Agent 在本项目中的协作规范和指南。

---

## 项目概述

**Zero2Agent** 是一个公开的 AI Agent 开发教学项目，从零构建一个类似 Claude Code / Codex 的 Coding Agent。

- **目标用户**：想学习 AI Agent 开发的开发者
- **核心价值**：完整透明的开发过程，包括设计决策、踩坑记录、AI 协作实录
- **技术栈**：TypeScript, Node.js, pnpm monorepo

---

## 项目结构

```
zero2agent/
├── packages/           # 代码
│   ├── core/           # Agent 核心逻辑
│   ├── tui/            # CLI 界面
│   └── shared/         # 共享工具和类型
├── specs/              # 设计文档 (每个迭代的 spec)
├── retros/             # 复盘笔记 (每个迭代的反思)
├── .vibecoding/        # AI 协作记录 (prompt、对话、修正)
├── .discuss/           # 需求讨论记录
├── CHANGELOG.md        # 迭代日志
└── AGENTS.md           # 本文件
```

---

## 代码规范

### 通用原则

1. **简洁高效**：设计与实现要简洁，不引入不必要的复杂度，不改动不必要的地方
2. **TypeScript 严格模式**：所有 package 使用 `strict: true`
3. **显式类型**：避免隐式 `any`，导出函数必须有类型声明
4. **ESM 优先**：使用 ES Module，`type: "module"`
5. **命名约定**：
   - 文件名：`kebab-case.ts`
   - 类名：`PascalCase`
   - 函数/变量：`camelCase`
   - 常量：`UPPER_SNAKE_CASE`

### 包管理

- 使用 **pnpm** 作为包管理器
- 内部包以 `@zero2agent/` 为 scope（如 `@zero2agent/core`）
- 依赖安装到具体 package，而非 root

### 代码风格

- 缩进：2 空格
- 引号：单引号
- 分号：无
- 行宽：100 字符

---

## AI 协作规范

### 对话记录

所有和 AI 的协作对话应记录在 `.vibecoding/` 目录：

```
.vibecoding/
├── YYYY-MM-DD/
│   └── <task-name>/
│       ├── prompt.md      # 使用的 prompt
│       ├── dialogue.md    # 完整对话
│       └── learnings.md   # 学到的经验
```

### 讨论记录

需求讨论和设计决策记录在 `.discuss/` 目录：

```
.discuss/
├── YYYY-MM-DD/
│   └── <topic>/
│       ├── outline.md       # 讨论大纲
│       └── decisions/       # 决策记录
│           └── D01-xxx.md
```

### Prompt 编写原则

1. **具体而非抽象**：说清楚要什么，而不是泛泛的描述
2. **提供上下文**：相关代码、文档、约束条件
3. **分步骤**：复杂任务拆成小步，逐步推进
4. **明确边界**：什么要做，什么不做

### 代码审查

AI 生成的代码需要人工审查，关注：

- 是否符合项目规范
- 是否有安全隐患
- 是否过度设计
- 是否有明显 bug

---

## 迭代流程

每个迭代（Exxx）遵循以下流程：

```
1. 需求讨论  →  .discuss/YYYY-MM-DD/<topic>/
2. 设计 Spec →  specs/Exxx-<name>.md
3. 实现代码  →  packages/
4. 复盘总结  →  retros/Exxx-<name>.md
5. 更新日志  →  CHANGELOG.md
6. 打 Tag    →  git tag Exxx-<name>
```

---

## Git 规范

### Commit 格式

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**类型**：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档变更
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具变更

**Scope** 使用 package 名：`core`, `tui`, `shared`

### 分支策略

- `main`: 稳定版本，每个迭代完成后合入
- `dev`: 开发分支
- `feat/xxx`: 功能分支

<!-- [ABC:agent-better-checkpoint:start] -->
### Checkpoint Commit Rule

After completing any file edit (write_to_file, replace_in_file, multi_replace_in_file, or similar),
you MUST:

1. Load the "agent-better-checkpoint" skill (if not already loaded)
2. Follow its instructions to create a checkpoint commit
3. Do NOT proceed to the next task until the commit is done

This ensures every meaningful code change is tracked with a semantic Git commit.
<!-- [ABC:agent-better-checkpoint:end] -->

---

## 环境要求

- **Node.js**: >= 22.0.0
- **pnpm**: >= 9.0.0
- **Git**: >= 2.30

### 快速开始

```bash
git clone git@github.com:alienzhou/zero2agent.git
cd zero2agent
pnpm install
pnpm build
pnpm --filter @zero2agent/tui start
```

---

## 文档维护

| 文档 | 用途 | 更新时机 |
|------|------|----------|
| `README.md` | 项目介绍、快速开始 | 重大变更时 |
| `AGENTS.md` | AI 协作规范（本文件） | 规范调整时 |
| `CHANGELOG.md` | 版本变更记录 | 每次迭代完成 |
| `specs/*.md` | 设计文档 | 迭代开始前 |
| `retros/*.md` | 复盘笔记 | 迭代完成后 |
