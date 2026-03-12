# 02 - Commit 格式规范和 Specs 整理

> Thread: 讨论并制定基础版 ReACT 模式，回顾前期讨论以完善计划
> 日期: 2026-03-12

---

## 背景

在完成 ReACT 基础版的技术方案讨论后，需要：
1. 回顾确认前序讨论内容
2. 制定 Commit 格式和版本编号规范
3. 根据讨论整理出正式的 Specs 文档

---

## Round 1: 回顾前序讨论

**🧑 User:**

> *(引用了前序对话)* 仔细 review 一下我们最后的讨论内容，看一下我们之前的这种讨论里有什么要考虑到的吗？
> 
> 现在我们暂时不追求工程上的完备，只是作为第一阶段、第一个迭代，是否可以？

**🤖 Agent:**

读取了前序对话的 transcript，总结关键决策：

**已确认的决策：**

| 编号 | 决策 | 内容 |
|------|------|------|
| D01 | MVP 定位 | Toy/Demo 级别 |
| D02 | 工具范围 | read_file、list_directory |
| D03 | LLM SDK | Anthropic TypeScript SDK |
| D04 | read_file | 支持行号范围 |
| D05 | list_directory | 支持 recursive |
| D06 | 输出格式 | 纯文本，缩进 + 完整相对路径 |
| D07 | 路径安全 | 基础版不做 |
| D08 | 错误处理 | 返回字符串信息 |

**判断：** 作为第一阶段第一个迭代，完全可以开始了。核心决策都已确认，"小步快跑"策略正好适用。

---

## Round 2: Commit 格式讨论

**🧑 User:**

> 可以的，我们再来商量讨论一下。因为我准备讨论完就想做一个 commit 了，所以我们的 commit 格式可以好好规整一下。
> 
> 关于整体进程，希望能体现出是"第几阶段的第几个迭代"。我希望这个在比较高级、比较明显的各种位置都能有所体现。
> 
> 然后第二个是，你看到我们有一些索引文件，所以是不是需要在里面，在 commit 的时候去做一些维护呢？

**🤖 Agent:**

查看了现有的 CHANGELOG.md 和 AGENTS.md，提出几种 Commit 格式方案：

```bash
# 方案 A：在 scope 中体现
feat(E001/core): implement basic ReAct loop

# 方案 B：在 type 前加前缀
[E001] feat(core): implement basic ReAct loop

# 方案 C：使用自定义 prefix
E001: feat(core): implement basic ReAct loop
```

**需要确认的问题：**
1. 是两层（Stage + Iteration）还是只用 `Exxx` 编号？
2. Commit 格式偏好？
3. 索引维护粒度：每个 commit 还是每个迭代？

---

## Round 3: 确定版本编号

**🧑 User:**

> 方案 B，它的编号应该是这样的：
> 
> 首先，它有 stage（阶段）的概念。每一个 stage 里，会有 5 到 10 个小型迭代来达到该阶段的效果。
> 
> 1. 我倾向于 S1-E-007 这种形式
> 2. Stage 位数为两位，E（迭代）位数为三位
> 3. 只要切换了新的 stage，E 就从 0 开始累加
> 
> 另外，我建议在 commit 的时候都更新一下索引。如果有必要的话，我们是不是可以做一个 hook？

**🤖 Agent:**

确认版本编号格式：

```
S01-E001
│   │
│   └── 迭代编号（3位），每个 Stage 内从 001 开始
└────── 阶段编号（2位）
```

**Commit Message 格式：**

```
[S01-E001] feat(core): implement basic ReAct loop

<body>

<footer>
```

**Git Hook 设计（post-commit）：**

```bash
#!/bin/bash
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ Commit 完成！请检查：                                    ║"
echo "║                                                            ║"
echo "║  [ ] CHANGELOG.md 是否已更新？                              ║"
echo "║  [ ] 如未更新，请：                                         ║"
echo "║      1. 编辑 CHANGELOG.md 添加变更条目                      ║"
echo "║      2. git add CHANGELOG.md                               ║"
echo "║      3. git commit --amend --no-edit                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
```

---

## Round 4: 确认最终细节

**🧑 User:**

> 我现在不用定义所有的 stage，写 Stage 1 就可以了。
> 
> Stage 1 的目标仍然是基础的 POC。核心是带大家跑通模式和流程，而非完美的工程化和产品化。
> 
> 关于 Git Hook 的设计，我看起来问题不大。
> 
> 原来的 E000 我觉得可以单独保留，直接用 E000，不加 S00。

**🤖 Agent:**

最终决策汇总：

| 编号 | 决策 | 内容 |
|------|------|------|
| D13 | 版本编号 | `S01-E001` 格式 |
| D14 | Stage 1 定位 | 基础 POC，跑通模式和流程 |
| D15 | Commit 格式 | `[S01-E001] type(scope): description` |
| D16 | 索引维护 | CHANGELOG 必须，Specs/Retros 视情况 |
| D17 | Git Hook | post-commit hook 提示检查索引 |

**特殊处理：** E000（仓库初始化）保留原样，不加 Stage 前缀

---

## Round 5: 创建 Git Hook

**🧑 User:**

> 我想先做好 Git hook 再开始提交。

**🤖 Agent:**

创建了 `.githooks/post-commit`：

```bash
#!/bin/bash

# Zero2Agent Post-Commit Hook
# 提示检查索引文件是否需要更新

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ Commit 完成！请检查：                                    ║"
echo "║                                                            ║"
echo "║  [ ] CHANGELOG.md 是否已更新？                              ║"
echo "║  [ ] specs/ 文档是否需要更新？                               ║"
echo "║  [ ] retros/ 复盘是否需要添加？                              ║"
echo "║                                                            ║"
echo "║  如需补充，请：                                              ║"
echo "║    1. 编辑对应文件                                          ║"
echo "║    2. git add <files>                                       ║"
echo "║    3. git commit --amend --no-edit                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
```

配置 Git 使用 `.githooks` 目录：

```bash
git config core.hooksPath .githooks
```

---

## Round 6: 增加 Commit 格式检查

**🧑 User:**

> 你看一下我们刚才说的这个 commit message 的要求标准。我发现现在让 AI commit 的时候它不遵循，所以：
> 
> 1. 是不是在 AGENTS.md 里面需要去做一个？
> 2. 是不是在 commit 完的 hook 里面，也要提示它去检查这个格式？

**🤖 Agent:**

更新了两处：

**1. AGENTS.md - 添加版本编号和 Commit 格式规范：**

```markdown
### Commit 格式

遵循 Conventional Commits，**必须包含版本前缀**：

[S01-E001] <type>(<scope>): <description>

**示例**：
# ✅ 正确格式
[S01-E001] feat(core): implement basic ReAct loop

# ❌ 错误格式（缺少版本前缀）
feat(core): implement basic ReAct loop
```

**2. post-commit hook - 增加格式检查：**

```bash
# 获取最新 commit message 的第一行
COMMIT_MSG=$(git log -1 --pretty=%s)

# 检查是否符合 [S0x-E0xx] 格式
if [[ ! "$COMMIT_MSG" =~ ^\[S[0-9]{2}-E[0-9]{3}\] ]]; then
  echo "║  ⚠️  Commit Message 格式不正确！                           ║"
  echo "║                                                            ║"
  echo "║  当前: $COMMIT_MSG"
  echo "║  期望: [S01-E001] type(scope): description                 ║"
  echo "║                                                            ║"
  echo "║  请修复: git commit --amend -m \"[S01-E001] ...\"           ║"
fi
```

---

## Round 7: 发现 SDK 问题

**🧑 User:**

> 你看一下我们讨论的内容，是不是我们之前讨论的应该是用这个 Anthropic 的 SDK，但你现在用了 OpenAI 的 SDK？

**🤖 Agent:**

确认了问题：当前代码里是 OpenAI 格式的客户端（`openai.ts`），这是 E001 时的遗留代码。根据讨论确认的 D03，应该使用 Anthropic SDK。

**建议的处理方式：**
1. 先 commit 当前的讨论决策
2. 下一步再改 LLM SDK 实现

---

## Round 8: 回滚源码，保留文档

**🧑 User:**

> 这样，我觉得代码实现先把它废弃掉，回滚一下。
> 
> 然后其他的，包括所有文档讨论、hook、工程构建等等，除了源码之外，其他的都要保留。源码先不用了，我重新实现一遍。

**🤖 Agent:**

执行了：
1. 删除 `packages/*/src/` 下的源码实现
2. 保留 package.json、tsconfig.json 和占位符
3. 保留所有文档和 hook
4. 提交：`[S01-E001] chore: setup project foundation and discussion framework`

---

## Round 9: 整理 Specs 文档

**🧑 User:**

> 根据我们讨论的内容，详尽地整理出对应的 specs
> *(附带 tech-doc-organizer skill)*

**🤖 Agent:**

加载 tech-doc-organizer skill，创建了完整的 Specs 文档结构：

```
specs/S01-E001-react-basic/
├── 00-overview.md           # 总览
├── 01-technical-design.md   # 技术设计
├── 02-task-list.md          # 任务清单
├── 03-verification-checklist.md  # 验收检查清单
└── 04-backlog.md            # Backlog
```

**文档内容：**

| 文档 | 主要内容 |
|------|----------|
| 00-overview | 迭代目标、设计原则、核心功能、技术选型 |
| 01-technical-design | 架构设计、LLM 客户端、工具设计、ReACT 循环、ADR 决策记录 |
| 02-task-list | 6 个 Step 的开发任务拆解 |
| 03-verification-checklist | 功能验收项、边界场景、已知限制 |
| 04-backlog | 功能 Backlog、技术优化、开放性问题 |

---

## 最终成果

### 提交记录

1. `[S01-E001] chore: setup project foundation and discussion framework`
2. `[S01-E001] docs(specs): add S01-E001 ReACT basic implementation specs`

### 创建/更新的文件

- `.githooks/post-commit` - Commit 后提示 hook
- `AGENTS.md` - 更新版本编号和 Commit 格式规范
- `CHANGELOG.md` - 更新版本格式和进度
- `specs/S01-E001-react-basic/` - 完整的 Specs 文档

---

## VibeCoding 要点

1. **引用前序对话 Review**: 通过 Thread 引用让 Agent 回顾之前的讨论内容
2. **Git Hook 辅助 AI**: 利用 post-commit hook 提示 AI 检查格式和更新索引
3. **AGENTS.md 约束 AI**: 把规范写入 AGENTS.md，让 AI 自动遵循
4. **使用 Skill 生成文档**: 通过 tech-doc-organizer skill 按规范生成 Specs
5. **灵活调整方向**: 发现问题（SDK 选择）后及时调整，回滚不需要的代码
