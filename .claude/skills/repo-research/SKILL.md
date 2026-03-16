---
name: repo-research
description: >-
  Clone and research external repositories, generating structured reports in the
  project. Use when the user provides a repository URL and asks to investigate,
  research, analyze, or study it. Triggers on: "调研", "研究一下", "分析这个仓库",
  "look into this repo", "research this repository", or any request involving
  cloning and studying an external codebase.
---

# Repo Research — 仓库调研与报告生成

你是用户的**技术调研助手**，负责克隆外部仓库、深入分析代码，并在本项目中生成结构化的调研报告。

**核心原则**：调研结果要可追溯、可复用，源码引用使用仓库相对路径。

---

## 🚀 启动流程

收到调研请求后，按以下步骤执行：

### 1. 解析请求

从用户消息中提取：
- **仓库地址**：GitHub URL 或其他 Git 仓库地址
- **调研话题**：用户关注的具体问题或方向
- **话题 slug**：从调研话题生成 `kebab-case` 标识（如 `react-loop-impl`）

### 2. 克隆仓库

将仓库克隆到临时目录，**不要在项目根目录下克隆**：

```bash
# 临时目录路径规则
TEMP_DIR="/tmp/zero2agent-research/<repo-name>"

# 如果目录已存在，复用并拉取最新
if [ -d "$TEMP_DIR" ]; then
  cd "$TEMP_DIR" && git fetch --all
else
  git clone --depth 100 <repo-url> "$TEMP_DIR"
fi
```

**注意**：
- `<repo-name>` 从仓库 URL 中提取（去掉 `.git` 后缀）
- 使用 `--depth 100` 浅克隆，节省空间，但保留一定历史
- 如果目录已存在说明之前克隆过，直接复用

### 3. 记录版本信息

克隆完成后立即记录：

```bash
cd "$TEMP_DIR"
COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_DATE=$(git log -1 --format='%ci')
# 如果有 tag，也记录最近的 tag
NEAREST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "N/A")
```

### 4. 创建报告目录

在**本项目根目录**下创建调研报告目录。**按话题组织，话题内按产品拆分**：

```
researches/
└── <topic-slug>/           # 话题目录（如 grep-search）
    ├── <product-1>.md      # 产品调研报告（如 codex.md）
    ├── <product-2>.md      # 产品调研报告（如 opencode.md）
    └── notes/              # 补充笔记（可选）
        └── *.md
```

**命名规则**：
- `<topic-slug>`：话题的 `kebab-case` 标识（如 `grep-search`、`react-loop`）
- `<product>.md`：产品/仓库名的简写（如 `codex.md`、`opencode.md`、`pi.md`）

**目录复用规则**：
- 如果 `researches/<topic-slug>/` 已存在，说明是同一话题的追加调研，在已有目录下补充新产品文件
- 不同话题使用不同的 slug 目录
- 同一话题的不同产品/仓库各自独立一个 `.md` 文件

---

## 📝 调研报告模板

每个产品的 `<product>.md` 使用以下结构：

```markdown
# [调研话题标题]

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [owner/repo](https://github.com/owner/repo) |
| 调研 Commit | `<commit-hash>` |
| 最近 Tag | `<tag>` |
| Commit 日期 | `<date>` |
| 调研日期 | `<YYYY-MM-DD>` |

## 调研目标

[用户关心的问题和调研方向]

## 调研结论

[核心发现的概要，2-5 条要点]

## 详细分析

### [子话题 1]

[分析内容]

### [子话题 2]

[分析内容]

## 关键源码引用

引用格式示例：
- `src/core/loop.ts#L10-L25`：[说明这段代码的作用]
- `src/utils/parser.ts#L42`：[说明]

## 参考资料

- [相关文档或链接]
```

---

## 📂 源码引用规范

**关键规则**：所有源码引用必须使用仓库内相对路径，不使用本地绝对路径。

### 正确格式

```markdown
<!-- ✅ 仓库相对路径 -->
`src/core/agent.ts#L10-L25`

<!-- ✅ 带 GitHub permalink -->
[agent.ts#L10-L25](https://github.com/owner/repo/blob/<commit-hash>/src/core/agent.ts#L10-L25)

<!-- ✅ 引用代码块时标注路径 -->
```typescript
// src/core/agent.ts#L10-L25
export class Agent {
  // ...
}
```⁣
```

### 错误格式

```markdown
<!-- ❌ 本地绝对路径 -->
`/tmp/zero2agent-research/repo-name/src/core/agent.ts`

<!-- ❌ 无路径引用 -->
"在 agent.ts 中"（不清楚是哪个 agent.ts）
```

---

## 🔄 调研流程

### 阶段一：快速概览

1. 查看仓库结构（`ls`, `tree` 等）
2. 阅读 README、CONTRIBUTING 等文档
3. 查看 `package.json`/`Cargo.toml` 等项目配置
4. 了解整体架构和技术栈

### 阶段二：深入分析

根据调研话题，有针对性地：
1. 阅读核心源码文件
2. 追踪关键调用链路
3. 分析设计模式和架构选择
4. 记录值得借鉴的实现细节

### 阶段三：整理报告

1. 在 `researches/<topic-slug>/<product>.md` 中生成报告
2. 源码引用使用仓库相对路径
3. 补充笔记放在 `notes/` 子目录
4. 确保版本信息完整记录

---

## ⚠️ 注意事项

- **不要在项目根目录克隆仓库** — 始终使用 `/tmp/zero2agent-research/`
- **不要使用本地路径引用源码** — 使用仓库相对路径或 GitHub permalink
- **始终记录 commit hash** — 确保调研结果可追溯
- **同一话题追加到同一目录** — 不要重复创建
- **调研完成后不需要清理临时目录** — 留着供后续调研复用
- 使用 Task 子智能体时，需要将临时目录的路径传递给子智能体，让它在该目录下工作

---

**Version**: 0.1.0
