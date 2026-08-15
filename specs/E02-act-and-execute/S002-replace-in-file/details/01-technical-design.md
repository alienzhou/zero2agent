# E02-S002: 技术设计

> `replace_in_file` 局部修改工具的设计说明，重点解释唯一性约束、`replace_all` 分支、字符串替换的实现陷阱，以及如何延续 S001 的安全边界与回执契约。

---

## 整体结构

本次只新增一个工具，不动 `ToolContext`、不改现有 6 个工具，复用 S001 的 `resolveInsideCwd`：

1. **replace_in_file 工具**
   - 精确匹配 `old_string`，替换为 `new_string`
   - 默认要求唯一匹配；`replace_all: true` 替换全部
   - 代码入口：`packages/core/src/tools/replace-in-file.ts`
2. **共享的路径边界校验**
   - 复用 `packages/core/src/tools/path-guard.ts` 的 `resolveInsideCwd`，越界返回 `Error:`
3. **注册**
   - `packages/core/src/tools/index.ts`：`allTools` 追加 `replace_in_file`
4. **Prompt / TUI 适配**
   - `packages/core/src/prompt/system.ts`：scope / tool-policy 增加 `replace_in_file` 说明
   - `packages/tui/src/cli.ts`：`summarizeToolOutput` 增加 `replace_in_file` 分支

---

## replace_in_file 工具

### 参数与语义

```
replace_in_file({ path, old_string, new_string, replace_all? }) => string
```

- `path` 沿用既有工具的参数名（与 `read_file` / `write_file` 一致），不做成 Claude Code 的 `file_path`。
- `old_string` **逐字符精确匹配**（含缩进、空白、换行），**不可为空字符串**。
- `new_string` 可为空字符串（等价删除匹配片段）。
- `replace_all` 缺省为 `false`。

### 执行流程

```
1. resolveInsideCwd(ctx.cwd, path)   → 越界则返回 Error
2. fs.stat(resolved)                 → 不存在=文件未找到；是目录=拒绝
3. fs.readFile(resolved, 'utf-8')    → 读出全文
4. old_string 为空?                   → 返回 Error
5. count = split(old_string).length - 1
   - 0      → Error: Match not found
   - ≥2 且 !replace_all → Error: Match not unique（不自动选第一个）
6. newContent = replace_all
     ? content.split(old_string).join(new_string)
     : parts[0] + new_string + parts.slice(1).join(old_string)
7. fs.writeFile(resolved, newContent)
8. 返回回执：Replaced <path> (N occurrence(s))
```

### 为什么用 split/join 而非 String.replace

`String.prototype.replace(needle, replacement)` 在 `needle` 为字符串时虽是字面量匹配，但 **`replacement` 里的 `$` 会被解释为替换占位符**（`$&`、`$1` 等）。文件内容含 `$` 时（如 shell 脚本、模板字符串）会得到错误结果。

用 `content.split(old_string).join(new_string)` 对**匹配串和替换串都按字面量处理**，规避这个隐蔽陷阱。唯一替换与 `replace_all` 共用这一机制，只是分支不同。

### 匹配语义的三种结果

| 出现次数 | 默认（replace_all=false） | replace_all=true |
|----------|--------------------------|------------------|
| 0 | `Error: Match not found` | `Error: Match not found` |
| 1 | 替换 1 处 | 替换 1 处 |
| ≥2 | `Error: Match not unique` | 替换全部 N 处 |

> 注意：`replace_all: true` 遇到 0 次匹配**仍然报错**，不静默跳过——「我要改的东西不存在」对 Agent 是必须知道的失败信号。

### 错误处理

| 场景 | 回执 |
|------|------|
| 路径越界 | `Error: <path> is outside the workspace, operation refused` |
| 文件不存在（读时 ENOENT） | `Error: File not found: <path>` |
| 目标是目录 | `Error: <path> is a directory, cannot replace` |
| old_string 为空 | `Error: old_string must not be empty` |
| 0 次匹配 | `Error: Match not found: <path>` |
| 多匹配（默认） | `Error: Match not unique: <path> (N occurrences, add more context to disambiguate)` |
| 其他 IO 错误 | `Error: Failed to replace: <message>` |

---

## 与 write_file 的关系

| 维度 | write_file（S001） | replace_in_file（本 Story） |
|------|-------------------|------------------------------|
| 粒度 | 全量写入 | 局部替换 |
| 定位方式 | 无（整篇） | `old_string` 精确匹配 |
| 核心设计判断 | 物理边界 + 回执区分新建/覆盖 | 唯一性约束 + replace_all |
| 安全边界 | resolveInsideCwd 硬拒绝 | 复用同一 helper |
| 分工 | 新建 / 整篇覆盖 | 改已有文件的一处/多处 |

两者互补：`write_file` 负责「从无到有」和「整篇重写」，`replace_in_file` 负责「外科手术式的局部改」。`delete`（S001）删整个文件，`replace_in_file` 的 `new_string: ""` 删片段。

---

## 对现有代码的影响

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/core/src/tools/replace-in-file.ts` | replace_in_file 工具实现 |
| 修改 | `packages/core/src/tools/index.ts` | `allTools` 注册 + 导出 |
| 修改 | `packages/core/src/prompt/system.ts` | scope / tool-policy 增加 replace_in_file |
| 修改 | `packages/tui/src/cli.ts` | `summarizeToolOutput` 增加分支 |

> 注意：**不改** `types.ts`（不扩展 ToolContext）、**不改** `path-guard.ts`、**不改**现有 6 个工具。

---

## 设计决策记录（ADR）

### ADR-01：唯一性约束是安全默认，replace_all 是显式逃逸

**决策**：默认要求 `old_string` 唯一出现，≥2 次报错；`replace_all: true` 才替换全部。

**理由**：唯一性约束倒逼模型提供足够上下文、防止改错位置（行业共识）；`replace_all` 把「批量替换是有意为之」显式化，不破坏安全默认。

### ADR-02：回执统一英文，避免 doc/code 漂移

**决策**：回执采用英文措辞，与既有 6 个工具的实际实现一致。

**理由**：S001 复盘记过一条教训——spec 写中文回执、代码落英文，两套并存。本次从决策阶段就明确英文，Spec 与代码统一。

### ADR-03：纯插入不做，插入用锚点替换表达

**决策**：`old_string` 不可为空；插入场景用「匹配唯一锚点 + 把锚点写回」覆盖。

**理由**：空 `old_string` 匹配位置不唯一、语义模糊、极易误用；而「在某处插入」总能表达为「替换该处为（新增 + 原内容）」，不损失表达力。

### ADR-04：参数名沿用 path 而非 file_path

**决策**：用 `path`，与本项目 `read_file` / `write_file` / `grep_search` 一致。

**理由**：内部一致性优先于匹配 Claude Code 的 `file_path` 习惯；教学项目里「所有工具都用 `path`」比「每个工具照搬竞品参数名」更利于读者建立心智模型。

---

## 当前不做的事情

这一版明确暂不处理（详见 [04-backlog.md](./04-backlog.md)）：

- **统一补丁范式**（apply_patch / editblock）——需模型遵循补丁语法，教学上手重
- **instruction 语义编辑**（Gemini 式）——二次 LLM + 复杂校验
- **纯插入**（空 old_string）——语义模糊，用锚点替换覆盖
- **「先读后写」硬约束**（OpenCode：改已存在文件前必须先 Read）——需状态跟踪
- **多文件 / 多段替换**——违背单一职责
- **模糊匹配 / 近似匹配**——确定性优先
- **回执附 diff / LSP 诊断**——太重
