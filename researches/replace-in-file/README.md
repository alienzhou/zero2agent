# 局部修改文件（replace / edit）—— 五竞品横向对比

> 调研日期：2026-08-15 ｜ 服务对象：zero2agent E02-S002（replace_in_file）
> 上游：本调研聚焦「已有文件的局部修改」机制，全量写/删见 [write-file 调研](../write-file/README.md)。

## 一、总览矩阵

| 维度 | OpenCode | Codex | pi-mono | Gemini CLI | Aider |
|------|----------|-------|---------|-----------|-------|
| 局部改范式 | `edit`（字符串替换） | `apply_patch`（FREEFORM 补丁） | `edit`（字符串替换） | `edit`（字符串替换 + instruction） | `editblock`（SEARCH/REPLACE 块） |
| 定位方式 | oldText 精确匹配 | 上下文 + 模糊匹配 | old_string 精确匹配 | old_string 精确匹配 / instruction 语义 | SEARCH 块精确匹配 |
| 唯一性约束 | ✅ 要求唯一 | 模糊匹配容错 | ✅ 要求唯一 | ✅ 要求唯一 | ✅ 要求唯一（多轮尝试） |
| 支持全部替换 | 否 | 补丁天然覆盖 | 否 | 否 | 否（多次 editblock） |
| 参数形态 | `{filePath, oldText, newText}` | 补丁文本 | `{filePath, oldString, newString}` | `{file_path, new_string, old_string/instruction}` | fenced block |
| 实现重量 | 中 | **重**（Lark 语法 + parser） | **轻** | **最重**（726 行 + 校验） | 中（coder 体系） |

## 二、跨竞品关键洞察

### 🔑 洞察 1：局部改的主流范式是「字符串精确替换」，而非补丁

五家里，OpenCode / pi-mono / Gemini 的 `edit` 都是同一个内核：**给一段 `old_string`，精确匹配后换成 `new_string`**。Codex 的 `apply_patch` 和 Aider 的 `editblock` 是更重的补丁/块语法，适合批量多文件变更，但代价是**需要模型严格遵循补丁语法**，教学上手成本高。

→ zero2agent S002 应采用**字符串精确替换**（`old_string` / `new_string`），与主流一致，也天然延续 S001 的「一个工具一种意图」。

### 🔑 洞察 2：唯一性约束是行业共识，也是「防止改错位置」的关键

OpenCode / pi-mono / Gemini 都要求 `old_string` 在文件里**唯一出现**；出现多处时报错、要求补充上下文。Aider 的 SEARCH 块同样要求精确唯一（匹配失败会多轮重试）。

这不是实现细节，而是**对模型行为的强约束**：唯一性倒逼模型带上足够的上下文（函数签名、注释、相邻行）来定位，从根上降低「改错地方」的概率。

→ S002 的核心教学点就应该是这个唯一性约束，而不是「替换」本身（替换太简单了）。

### 🔑 洞察 3：「全量替换」是稀缺能力，但真实高频

五家里**没有一家**在单文件 edit 里提供 `replace_all` 开关——重命名变量时要靠模型反复调用 `edit`（或写补丁）。这对 Agent 是真实痛点：一次「把 `foo` 改成 `bar`」本该一次完成，却要 N 次调用。

→ S002 提供一个 `replace_all: boolean`（默认 false）是**低成本、高价值的偏离**：默认守住唯一性，显式开启才全量替换。

### 🔑 洞察 4：Gemini 的 `instruction` 编辑是「语义编辑」的雏形，太重

Gemini 的 edit 除了 `old_string` 精确匹配，还支持 `instruction`（「把循环改成递归」）+ LLM 校验 + 占位符检测。这是「让模型自己定位改哪里」的方向，但引入二次 LLM 调用与复杂校验，远超教学主线。

→ S002 **不做** instruction 编辑，只做确定性的字符串替换（记 backlog）。

### 🔑 洞察 5：回执普遍携带「改了几处/是否成功」，且都做路径安全

各家 edit 都返回成功/失败 + 替换位置信息；路径安全上 Gemini 硬拒绝、OpenCode 升级询问，与 write-file 调研结论一致。

→ S002 沿用 S001 已建立的 `resolveInsideCwd` 硬拒绝，回执沿用 string 契约并报告替换处数。

## 三、对 D01–D07 的初步映射

| 决策点 | 竞品证据 | 倾向 |
|--------|---------|------|
| D01 工具范式 | 3/5 家字符串替换，Codex/Aider 补丁块 | **字符串替换**（`old_string`/`new_string`），不做补丁 |
| D02 替换语义 | 全员精确匹配 + 唯一约束 | **精确匹配 + 唯一约束**，0 次/多次都报错 |
| D03 全量替换 | 五家均无，需反复调用 | **提供 replace_all（默认 false）**，有意的低成本偏离 |
| D04 安全边界 | Gemini 硬拒绝（同 S001） | **复用 resolveInsideCwd 硬拒绝** |
| D05 插入/删除边界 | 删除=空 new_string 普遍支持 | **new_string 可为空（删除片段）；old_string 不可为空** |
| D06 返回契约 | 普遍报告成功/失败 + 处数 | **沿用 string 回执（英文，与既有工具一致）** |
| D07 ToolContext | 无 approval 需求 | **不扩展，维持只有 cwd** |

> 以上仅为**基于调研的倾向**，非结论。正式决策见 `.discuss/2026-08-15/e02-s002-replace-in-file/decisions/`。
