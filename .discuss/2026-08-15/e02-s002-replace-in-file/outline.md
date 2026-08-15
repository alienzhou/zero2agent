# E02-S002：高效修改已有内容（replace_in_file）

> 讨论始于 2026-08-15。目标：给 Agent Harness 引入**局部修改**工具 `replace_in_file`，让它在「整篇重写」之外，能对已有文件做外科手术式的局部替换。
>
> 上游依据：`.discuss/2026-03-14/zero2agent-course-roadmap/decisions/D04-stage2-roadmap.md`（Replace in File 独立成 Story）；S001 backlog 明确「局部修改留给 S002」。

---

## 🔵 Current Focus

✅ D01–D07 已收敛为决策（见 `decisions/`）。**下一步进入 Spec 阶段**（`specs/E02-act-and-execute/S002-replace-in-file/`）。

现有代码基线（E02-S001 完成后）：
- `Tool` 接口：`execute(input, ctx) => Promise<string>`，`ctx` 只有 `cwd`
- 6 个工具：read_file / list_directory / grep_search / find_files / write_file / delete
- 共享边界校验 `resolveInsideCwd(cwd, relPath)`（`path-guard.ts`），越界硬拒绝
- 错误以 `Error: ...` 字符串返回（非抛异常），回执实际为**英文**（`Created ...`、`Deleted: ...`）

## 📚 竞品调研（已完成 2026-08-15）

5 家竞品局部修改机制见 `researches/replace-in-file/`（[汇总](../../../researches/replace-in-file/README.md)）：opencode / codex / pi-mono / gemini-cli / aider。

跨竞品关键发现：
1. **局部改主流范式是「字符串精确替换」**——OpenCode/pi-mono/Gemini 的 `edit` 都是 `old_string` 精确匹配换 `new_string`；Codex 的 apply_patch、Aider 的 editblock 更重（补丁/块语法）。
2. **唯一性约束是行业共识**——三家字符串替换都要求 `old_string` 唯一出现，多处则报错、要求补上下文。这是「防止改错位置」的关键机制，也是 S002 的核心教学点。
3. **「全量替换」五家都缺**——重命名变量要反复调用 edit；S002 提供 `replace_all`（默认 false）是低成本、高价值的偏离。
4. **Gemini 的 instruction 语义编辑太重**——二次 LLM + 复杂校验，S002 不做，记 backlog。
5. **路径安全与 S001 一致**——硬拒绝，复用 `resolveInsideCwd`。

## ✅ Confirmed（D01–D07 全部收敛，详见 decisions/）

| 编号 | 决策点 | 结论 |
|------|--------|------|
| [D01](./decisions/D01-tool-paradigm.md) | 工具范式 | **字符串精确替换**（`old_string`/`new_string`），不做统一补丁/块语法 |
| [D02](./decisions/D02-replace-semantics.md) | 替换语义 | **精确匹配 + 唯一约束**；0 次=未找到、≥2 次=不唯一，均报错不自动选第一个 |
| [D03](./decisions/D03-replace-all.md) | 全量替换 | 提供 `replace_all`（默认 **false**）；显式 true 时替换全部并报告处数 |
| [D04](./decisions/D04-security-boundary.md) | 安全边界 | **复用 `resolveInsideCwd` 硬拒绝**（与 S001 一致）；目标是已存在文件 |
| [D05](./decisions/D05-insert-delete-boundary.md) | 插入/删除边界 | **new_string 可为空（删片段）；old_string 不可为空**（纯插入用锚点替换实现） |
| [D06](./decisions/D06-return-contract.md) | 返回契约 | 沿用 **string 回执**；报告替换处数；**英文回执与既有工具一致**（吸取 S001 复盘教训） |
| [D07](./decisions/D07-toolcontext-extension.md) | ToolContext 扩展 | **不扩展**，维持只有 cwd（延续 S001 D07） |

## ❌ Rejected

- 统一补丁范式（apply_patch / editblock）——需模型严格遵循补丁语法，教学上手重
- instruction 语义编辑（Gemini 式）——二次 LLM + 复杂校验，远超教学主线
- 自动选第一个匹配——违背唯一性约束，容易改错位置
- 纯插入（空 old_string）——语义模糊易误用，用「匹配唯一锚点 + 写回锚点」覆盖插入场景
- 多文件 / 多段替换（一次调用改多处）——违背单一职责，多处替换让模型多次调用
- 结构化返回类型——沿用 string 契约，不上枚举
- S002 就扩展 ToolContext——无 approval 需求就无扩展理由

---

## ⏭️ 下一步

✅ D01–D07 已全部落成 `decisions/`。进入 **Spec 阶段**：撰写 `specs/E02-act-and-execute/S002-replace-in-file/README.md`，基于上述 7 条决策定义 `replace_in_file` 的契约、行为、边界与验收标准。
