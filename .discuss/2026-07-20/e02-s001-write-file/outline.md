# E02-S001：直接改动工作区（write_file + delete）

> 讨论始于 2026-07-20。目标：为 Agent Harness 引入第一批**写工具**，让它跨过 Epic 1 的「只读」边界，能创建 / 写入 / 删除工作区文件。
>
> 上游依据：`.discuss/2026-03-14/zero2agent-course-roadmap/decisions/D04-stage2-roadmap.md`（Write to File 与 Delete 同处一个 Story，不再拆细）。

---

## 🔵 Current Focus

✅ D01–D07 已全部收敛为决策（见 `decisions/`）。**下一步进入 Spec 阶段**（`specs/E02-act-and-execute/S001-write-file/`）。

现有代码基线：
- `Tool` 接口：`execute(input, ctx) => Promise<string>`，`ctx` 只有 `cwd`（`packages/core/src/tools/types.ts`）
- 现有 4 个只读工具：read_file / list_directory / grep_search / find_files
- 相对路径统一 `path.resolve(ctx.cwd, filePath)`，错误以 `Error: ...` 字符串返回（非抛异常）

## 📚 竞品调研（已完成 2026-07-24）

5 家竞品报告见 `researches/write-file/`（[汇总](../../../researches/write-file/README.md)）：opencode / codex / pi-mono / gemini-cli / aider。

跨竞品关键发现：
1. **没有一家做独立 delete 工具**——4 家交给 shell、Codex 做成补丁 hunk、Aider 靠 git。zero2agent 坚持独立 delete 是**有意的教学向偏离**，需在 Spec 说明。
2. **write 最小形态高度收敛**：`{path, content}` + 自动建父目录 + 不存在建/存在覆盖。**pi-mono 是直接蓝本**（`Successfully wrote N bytes` 回执贴合现有 string 风格）。
3. **路径安全两流派**：Gemini 硬拒绝 vs OpenCode 升级询问 → 教学项目选**硬拒绝**。
4. **破坏性确认两条路**：事前确认（OpenCode/Gemini，需扩展 ctx）/ 事后回滚（Aider git，Epic 3 Checkpoint 思路）→ S001 都暂缓。
5. **回执可区分新建/覆盖**（Gemini），零成本且对模型有用，值得采纳。

## ✅ Confirmed（D01–D07 全部收敛，详见 decisions/）

| 编号 | 决策点 | 结论 |
|------|--------|------|
| [D01](./decisions/D01-tool-granularity.md) | 工具拆分粒度 | write_file 与 delete **独立成两个工具**；create/overwrite 不再拆，由回执区分（有意偏离「无独立 delete」的行业主流，教学向） |
| [D02](./decisions/D02-write-semantics.md) | 写入语义 | **全量写入 + 自动建父目录**，不存在建/存在覆盖，不做 append |
| [D03](./decisions/D03-security-boundary.md) | 安全边界 | **硬拒绝 cwd 之外**的写/删；软链解析、黑名单记 backlog |
| [D04](./decisions/D04-destructive-confirmation.md) | 破坏性确认 | S001 **不做**；approval 留待后续专章完整实现；事后回滚归 Epic 3 |
| [D05](./decisions/D05-delete-scope.md) | delete 范围 | **支持多文件数组**、不递归；部分失败走**方案 B（尽力删 + 逐条汇总）**；删不存在=失败项 |
| [D06](./decisions/D06-return-contract.md) | 返回契约 | 沿用 **string 回执**；write 区分新建/覆盖 + 字节数；delete 逐条汇总；错误用 `Error:` 文本 |
| [D07](./decisions/D07-toolcontext-extension.md) | ToolContext 扩展 | S001 **不扩展**，维持只有 cwd（与 D04 绑定） |

## ❌ Rejected

- delete 递归删目录（破坏性过强，待 Epic 3 Checkpoint 后再评估）
- delete 部分失败方案 A（遇错即停，语义模糊）/ 方案 C（先全校验才删，牺牲批量便利）
- write 回执附 LSP 诊断 / diff（太重）；错误类型枚举（用文本区分即可）

---

## ⏭️ 下一步

✅ D01–D07 已全部落成 `decisions/`。进入 **Spec 阶段**：撰写 `specs/E02-act-and-execute/S001-write-file/README.md`，基于上述 7 条决策定义 `write_file` 与 `delete` 两个工具的契约、行为、边界与验收标准。
