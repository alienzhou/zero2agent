# AGENTS.md

> AI Agent 在本项目中的协作规范和指南。

---

## 项目概述

**Zero2Agent** 是一个公开的教学项目，带你从零**实现**类似 Claude Code / Codex 的 Coding Agent 所需的 **Agent Harness**（循环、工具、上下文与宿主能力）。

- **目标用户**：想学习如何实现 Agent Harness 的开发者
- **核心价值**：完整透明的开发过程，包括设计决策、踩坑记录、AI 协作实录
- **技术栈**：TypeScript, Node.js, pnpm monorepo

---

## 项目结构

```
zero2agent/
├── packages/           # 代码
│   ├── core/           # Agent Harness 核心逻辑
│   ├── tui/            # 交互 TUI 与 plain / 单次 CLI 宿主
│   └── shared/         # 共享工具和类型
├── specs/              # 设计文档 (每个迭代的 spec)
├── retros/             # 复盘笔记 (每个迭代的反思)
├── docs/               # 读者文档 (roadmap、架构、快速上手)
├── site/               # 在线图解教程，可直接部署到 Nginx
├── .authoring/         # 作者书写规范 (写作风格、导航规范、页面模板)
├── .vibecoding/        # AI 协作记录 (prompt、对话、修正)
├── .discuss/           # 需求讨论记录
├── CHANGELOG.md        # 迭代日志
└── AGENTS.md           # 本文件
```

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

### 运行状态与交互兼容

- Core 通过结构化运行事件报告事实；取消、权限审批和人工终端交接使用各自的控制接口。不要依赖控制台文本推断状态，也不要把展示通知写进模型消息历史。
- 修改交互宿主时，对照既有命令、参数、权限、会话、上下文压缩及人工终端功能建立兼容检查；同时保留单次调用、管道和 `--plain` 路径。具体快捷键与当前能力放在课程及使用文档中。
- stdin、raw mode、屏幕和审批焦点同一时刻只能由一个交互接收者拥有。取消要等执行与清理完成，再开放下一轮；测试正常退出、异常和信号后的终端恢复。
- 工具调用与结果必须配对。取消不能抹掉已完成的副作用；人工终端的私密输入、输出与凭据不得进入模型请求或验收附件。

### 会话保存与恢复

- 持久化显式选择可恢复数据，版本化并在替换当前状态前完整校验；原始工具调用与结果、已采用摘要及其边界必须一致。不要序列化整个 Agent 或未完成的异步对象。
- 恢复历史不执行旧工具，不恢复旧进程，不继承旧审批或配置凭据；新操作使用当前工作目录、模型与权限策略。人工终端私密内容继续排除在会话之外。
- 自动保存的进度、失败与冲突必须可见。发布完整数据后才宣称已保存；不得静默覆盖其他写入者、丢弃未保存内存，或把未结算历史解释成副作用未发生。

### 运行日志与追查

- 诊断记录使用显式元信息白名单，独立于会话快照和模型上下文；不采集 prompt、文件或工具正文、配置凭据及人工终端字节。查询记录只读，不触发工具重放或模型请求。
- 请求起止、用量与终端退出结果来自 SDK 和原生接口；记录其实际证据范围，不从展示文字猜测。后台工作在启动时捕获操作与请求身份，晚到结果仍关联原调用。
- 写入队列、文件和读取范围必须有界。日志错误保持可见且不替代任务结果；缺少终态只表示证据未闭环，不能推断副作用未发生或自动重试。

### 文件 Checkpoint 与回退

- 文件保护通过等待完成的控制接口包围受信任工具声明的写入路径，安排在权限批准后、实际副作用前。诊断通知不承担保存前置条件；捕获失败应阻止尚未开始的写入，效果后的失败必须说明文件可能已改变，不能自动重放。
- 只捕获明确声明的文件范围，不推断普通 shell、人工终端和外部系统可回退。内容存储必须设定空间、文件大小、记录和读取边界；回收共享内容前校验引用，保留未结算的恢复证据。
- 回退先展示目标和冲突，确认绑定当前文件状态；执行前重新校验，不静默覆盖较新的人工修改。回退自身保存恢复意图和当前版本，失败后按实际文件状态继续，不能把多文件替换宣称为原子事务。
- 文件恢复不删除对话事实、重放旧工具或恢复旧进程。交互会话应加入准确的恢复事实，提示重新读取；本地存储可能含文件正文，应明确保密范围与关闭方式。

### 验收与证据

- 分别记录单元测试、确定性 SDK 响应、真实 PTY、真实模型服务与人工审查。只按实际运行的层级、版本和平台标记通过；AI 交叉审阅不能替代人工审查。
- 验证文件效果、请求正文、进程清理等可观察结果，不能仅凭模型的文字声明判定工具执行成功。失败重验应保留原始失败记录并说明修正原因。
- 实机与竞品调研记录版本、平台、命令、时间、来源和固定源码版本。源码引用与实测二进制版本分别注明，不推断二者来自同一次构建。
- 原始终端证据无损保存；需要清理控制码或空白的展示副本，注明它是派生内容。保存前检查凭据与私密内容；报告应标明被验证源码的版本或哈希。

---

## 迭代流程

每个迭代（Sxxx）遵循以下流程：

```
1. 需求讨论  →  .discuss/YYYY-MM-DD/<topic>/
2. 设计 Spec →  specs/.../README.md + details/（可选 deep-dive/ 延伸文）
3. 实现代码  →  packages/
4. 复盘总结  →  retros/E0x-S0xx-<story-slug>.md
5. 更新日志  →  CHANGELOG.md
6. 打 Tag    →  git tag E0x-S0xx-<slug>
```

### Story `details/` 目录约定

各 Story 的技术文档放在 `specs/.../S0xx-.../details/`，与 [`.authoring/templates/details/`](./.authoring/templates/details/) 一致，固定为以下五篇（勿混用旧名 `task-breakdown` / `acceptance-criteria`）：

| 文件 | 用途 |
|------|------|
| `00-overview.md` | 概述与文档导航 |
| `01-technical-design.md` | 技术设计 |
| `02-task-list.md` | 开发任务清单 |
| `03-verification-checklist.md` | 验收检查清单 |
| `04-backlog.md` | Backlog |

---

## 在线课程制作

Zero2Agent 的课程内容在本仓库闭环维护。HTML、CSS 与小节顺序放在 site/chapters/；章节元信息、图解生成源、内容计划和来源审阅资料放在 .authoring/site/。content-generator/zero2agent-xhs 是迁移前的历史材料，后续课程不在那里制作后再复制回来。

遵循 [.authoring/site/README.md](./.authoring/site/README.md)：修改编辑源后运行 pnpm site:build 和 pnpm site:check，再通过 pnpm site:preview 检查 PC 与 H5，包括逐页可读性、导航、图解放大和文字内容。课程涉及交互界面时，还须验证实际交互与对应源码，不能只检查静态截图。只部署 site/；生成源与部署产物在同一提交保存。

封面脱离课程网站后也要能辨认「从零到一做 Agent」的系列主题；遵循[封面层级与缩略图检查规范](./.authoring/site/templates/cover.md)，不要让单课功能标题替代系列身份。

---

## Git 规范

### 版本编号

本项目使用 **两层版本结构**：

```
E01-S001
│   │
│   └── 迭代编号（3位），每个 Epic 内从 001 开始
└────── 阶段编号（2位）
```

| Epic | 定位 | 迭代范围 |
|------|------|----------|
| E01 | 基础 POC | S001 - S00x |
| E02+ | 待定 | ... |

> **注意**：S000（仓库初始化）是特殊迭代，不带 Epic 前缀。

### Commit 格式

遵循 [Conventional Commits](https://www.conventionalcommits.org/)。Commit 分为两类：

#### Story Commit（属于某个迭代）

必须包含版本前缀 `[Exx-Sxxx]`：

```
[E01-S001] <type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

#### 非 Story Commit（工程改动、讨论整理等）

不加版本前缀，使用标准 Conventional Commit：

```
<type>(<scope>): <description>
```

**示例**：
```bash
# ✅ Story Commit
[E01-S001] feat(core): implement basic ReAct loop
[E01-S001] fix(tui): fix CLI argument parsing
[E01-S002] docs: update CHANGELOG for tool implementation

# ✅ 非 Story Commit
docs(roadmap): consolidate course roadmap discussion
chore: update CI config
```

**类型**：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档变更
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具变更

**Scope**：使用 package 名（`core`, `tui`, `shared`），或省略表示全局变更

### Tag 格式

每个迭代完成后打 Tag，格式：

```
E01-S001-<slug>
```

**规则**：
- 前缀：`E01-S001` 与版本编号一致
- Slug：2-4 个单词，`kebab-case`，描述核心内容
- 不需要 type（因为 Tag 标记的是迭代完成点）

**示例**：
```bash
# ✅ 正确格式
E01-S001-react-basic
E01-S002-context-mgmt
E02-S001-arch-refactor

# ❌ 错误格式
v1.0.0                    # 不使用语义化版本
S001-react-basic          # 缺少 Epic 前缀
E01-S001                  # 缺少 slug 描述
```

**打 Tag 命令**：
```bash
# 使用 tag-helper 脚本（推荐，会检查格式）
.githooks/tag-helper.sh E01-S001-react-basic

# 或直接创建（不检查格式）
git tag E01-S001-react-basic

# 推送 Tag
git push origin E01-S001-react-basic
```

### 分支策略

- `main`: 稳定版本，每个迭代完成后合入
- `dev`: 开发分支
- `feat/xxx`: 功能分支

<!-- [ABC:agent-better-checkpoint:start] -->
### Checkpoint Commit Rule

每完成一组有意义的文件修改，按本文件的 Story / Conventional Commit 规范创建 checkpoint，再继续下一项工作。

若 `agent-better-checkpoint` skill 可用，先读取并遵循它；若不存在，说明缺失并直接按本仓库规则提交，不因缺少辅助 skill 中断已获授权的工作。仅提交自己负责的文件，保留用户与其他协作者尚未提交的修改。
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
| `specs/**/README.md` + `specs/**/details/*.md`（及可选 `deep-dive/`） | 设计文档 | 迭代开始前 |
| `retros/*.md` | 复盘笔记 | 迭代完成后 |

### 文档书写规范（作者参考）

新增或修改面向读者的文档时，遵循以下核心原则：

1. **标题说人话**：用直述句（"做什么"），不用隐喻（"带到哪里"）
2. **不重复上游信息**：每层文档只写本层新信息，Epic 不重复 Roadmap，Story 不重复 Epic
3. **信息密度优先**：每段话要有实质新信息，不做排比堆砌
4. **快速进入行动**：读完能开始做事，避免抽象铺垫

详细规范和页面模板见 [`.authoring/`](./.authoring/README.md)（仅作者可见，不在读者路径上）。
