# E02-S001: 技术设计

> `write_file` 与 `delete` 两个写工具的设计说明，重点解释结构、安全边界、部分失败语义和实现要点。

---

## 整体结构

这次改动只新增两个工具，不动 `ToolContext`（已在 E01-S003 建好），也不改现有 4 个只读工具。

1. **write_file 工具**
   - 全量写入：不存在建 / 存在覆盖 / 自动建父目录
   - 写前探测是否存在，决定回执用「创建」还是「覆盖」
   - 代码入口：`packages/core/src/tools/write-file.ts`
2. **delete 工具**
   - 批量删文件：对 `paths` 数组逐个「尽力删」，逐条汇总
   - 不递归删目录
   - 代码入口：`packages/core/src/tools/delete.ts`
3. **共享的路径边界校验**
   - 一个 `resolveInsideCwd(ctx.cwd, relPath)` 辅助：解析绝对路径 + 校验落在 cwd 内
   - 两个工具共用；越界返回 `Error:`
4. **注册**
   - `packages/core/src/tools/index.ts`：`allTools` 追加两个工具

---

## 与只读工具的根本差异

这是 Agent Harness 第一次引入**带副作用**的工具，与 Epic 1 的只读工具有三点本质不同：

| 维度 | 只读工具（Epic 1） | 写工具（本 Story） |
|------|-------------------|-------------------|
| 副作用 | 无，重复调用无害 | 有，会改变磁盘状态 |
| 安全诉求 | 读越界危害小 | **写/删越界危害大 → 必须硬拒绝** |
| 幂等性 | 天然幂等 | write 覆盖不可逆、delete 不可逆 |
| 错误影响 | 返回错文本即可 | 部分失败要让 Agent 明确知道「改了什么、没改什么」 |

所以本 Story 的设计重心不在「功能多」，而在**边界**和**回执清晰**。

---

## write_file 工具

### 参数与语义

```
write_file({ path: string, content: string }) => string
```

- 相对路径 `path.resolve(ctx.cwd, path)` 解析（与现有工具一致）。
- 全量写入：`content` 即文件的完整内容。
- 不做 append、不做 mode 开关。

### 执行流程

```
1. resolveInsideCwd(ctx.cwd, path)   → 越界则返回 Error
2. fs.access(resolvedPath)           → 探测文件是否已存在（决定回执措辞）
3. fs.mkdir(dirname, { recursive })  → 自动创建缺失父目录
4. fs.writeFile(resolvedPath, content, 'utf-8')
5. 返回回执：
   - 原本不存在 → 已创建文件 <path>（写入 N 字节）
   - 原本已存在 → 已覆盖文件 <path>（写入 N 字节）
```

字节数 `N = Buffer.byteLength(content, 'utf-8')`（按字节而非字符，与 pi-mono 一致）。

### 为什么写前要探测存在性

竞品里 Gemini 明确区分 `created` vs `overwrote`。这个信息零成本（一次 `fs.access`），却对模型很有用：它能据此判断自己到底是新建了文件，还是覆盖了一个已有文件（后者更值得警惕）。这也是本 Story 采纳的少数「回执增强」之一。

### 错误处理

| 场景 | 处理 |
|------|------|
| 路径越界 | `Error: <path> 超出工作区，拒绝操作` |
| 目标是已存在的目录 | `Error: <path> 是目录，无法写入` |
| 权限不足（EACCES） | `Error: 无权限写入 <path>` |
| 其他 IO 错误 | `Error: 写入失败：<message>` |

---

## delete 工具

### 参数与语义

```
delete({ paths: string[] }) => string
```

- 只删文件，**不递归删目录**（目标是目录 → 该项失败）。
- 对数组逐个处理，**不因单个失败中断**（方案 B：尽力删）。

### 执行流程（尽力删 + 逐条汇总）

```
succeeded = []
failed = []                          // [{ path, reason }]

for each rel in paths:
    resolved = resolveInsideCwd(ctx.cwd, rel)
    if 越界:      failed.push({ rel, "超出工作区" }); continue
    stat = fs.stat(resolved)
    if 不存在:    failed.push({ rel, "文件不存在" }); continue
    if 是目录:    failed.push({ rel, "是目录，不支持删除目录" }); continue
    try fs.rm(resolved)
        succeeded.push(rel)
    catch e:     failed.push({ rel, e.message })

汇总输出（见下）
```

> ⚠️ 每个路径都要**单独过 cwd 边界校验**——不能因为它在数组里就跳过安全检查。

### 回执格式（部分失败 = 方案 B）

| 情况 | 回执 |
|------|------|
| 全部成功 | `已删除：a.txt, c.txt` |
| 全部失败 | `Error: 删除失败：b.txt（文件不存在）` |
| 部分成功 | `已删除：a.txt, c.txt；失败：b.txt（文件不存在）` |

> 全失败时用 `Error:` 前缀（对 Agent 是一次彻底失败的信号）；部分成功时不用 `Error:` 前缀，而是如实陈述成败，让 Agent 自己决定是否重试失败项。

### 为什么选方案 B 而非 A / C

见 [README 关键设计](../README.md#3-delete-支持批量部分失败尽力删--逐条汇总d05--d06) 与 [D05 决策](../../../../.discuss/2026-07-20/e02-s001-write-file/decisions/D05-delete-scope.md)。一句话：**尽力删 + 逐条汇总**对 Agent 最友好——它拿到的是清晰的「哪些成了、哪些没成」，而不是一个模糊的整体状态。

---

## 安全边界：resolveInsideCwd

两个工具共用同一段边界校验逻辑：

```
resolveInsideCwd(cwd, relPath):
    resolved = path.resolve(cwd, relPath)
    rel = path.relative(cwd, resolved)
    if rel === '' || rel.startsWith('..') || path.isAbsolute(rel):
        → 越界，拒绝
    return resolved
```

- `path.relative` 若结果以 `..` 开头或是绝对路径，说明目标跳出了 cwd。
- 这能同时挡住 `../../etc/hosts`（相对逃逸）和 `/etc/hosts`（绝对路径逃逸）。
- **本 Story 不解析软链接**——软链真实路径逃逸（如 cwd 内有个软链指向外部）不在防护范围，记 backlog。

### 为什么是硬拒绝而非升级询问

| 流派 | 代表 | 本 Story 取舍 |
|------|------|--------------|
| 硬拒绝 | Gemini `validatePathAccess` | ✅ 采用：简单、明确、可预测 |
| 升级询问 | OpenCode `assertExternalDirectory` | ❌ 依赖 permission 框架，本 Story 不引入 approval |

详见 [D03 决策](../../../../.discuss/2026-07-20/e02-s001-write-file/decisions/D03-security-boundary.md)。

---

## 对现有代码的影响

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/core/src/tools/write-file.ts` | write_file 工具实现 |
| 新增 | `packages/core/src/tools/delete.ts` | delete 工具实现 |
| 修改 | `packages/core/src/tools/index.ts` | `allTools` 注册两个新工具 + 导出 |
| 修改 | `packages/tui/src/cli.ts` | system prompt 增加两个写工具的说明（若有工具清单） |

> 注意：**不改** `types.ts`（不扩展 ToolContext）、**不改**现有 4 个只读工具。

---

## 设计决策记录（ADR）

### ADR-01：write_file 与 delete 做成两个独立工具

**决策**：不合并、不用统一补丁范式。

**理由**：教学直观（一个工具一种意图）+ 工具层可做路径校验和结构化回执 + 不引入尚未实现的 shell 依赖。这是**有意偏离**「竞品无独立 delete」的主流，详见 [D01](../../../../.discuss/2026-07-20/e02-s001-write-file/decisions/D01-tool-granularity.md)。

### ADR-02：write_file 只做全量写

**决策**：不做 append、不做局部修改。

**理由**：单一职责；局部改是 S002 `replace_in_file` 的事。详见 [D02](../../../../.discuss/2026-07-20/e02-s001-write-file/decisions/D02-write-semantics.md)。

### ADR-03：cwd 边界硬拒绝

**决策**：越界一律返回 Error，不做升级询问、不解析软链。

**理由**：教学项目要简单可预测的物理底线；升级询问依赖 approval 框架，本 Story 不引入。详见 [D03](../../../../.discuss/2026-07-20/e02-s001-write-file/decisions/D03-security-boundary.md)。

### ADR-04：delete 部分失败用「尽力删 + 逐条汇总」

**决策**：方案 B，不用「遇错即停」（A）或「先全校验才删」（C）。

**理由**：对 Agent 最友好，回执清晰，契合 string 回执风格。详见 [D05](../../../../.discuss/2026-07-20/e02-s001-write-file/decisions/D05-delete-scope.md)。

### ADR-05：不扩展 ToolContext

**决策**：维持 `ToolContext` 只有 `cwd`。

**理由**：唯一驱动扩展的需求是 approval 回调，而 approval 留到后续专章。接口稳定优先。详见 [D07](../../../../.discuss/2026-07-20/e02-s001-write-file/decisions/D07-toolcontext-extension.md)。

---

## 当前不做的事情

这一版明确暂不处理（详见 [04-backlog.md](./04-backlog.md)）：

- **破坏性确认 / 权限体系**（覆盖、删除都不弹确认）→ 后续专章
- **事后回滚 / Checkpoint**（Aider git-as-undo 思路）→ Epic 3
- **软链接真实路径解析**、**危险路径黑名单**（如 `.git/`）
- **递归删目录**、**通配符删除**
- **append / 局部修改** → S002 `replace_in_file`
- **「先读后写」硬约束**（OpenCode：改已存在文件前必须先 Read）→ 需状态跟踪
- **回执附 diff / LSP 诊断**（太重）
