# OpenCode — 写文件 / 删除文件 调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| 调研 Commit | `743f6410f2e5002723fc5e893039ac49fbfe0de8` |
| Commit 日期 | `2026-07-23 18:04:46 +0000` |
| 调研日期 | `2026-07-24` |

## 调研目标

为 E02-S001 提供竞品参考：OpenCode 如何设计 `write` 工具？是否提供独立的 `delete` 工具？写入的安全边界、破坏性确认、返回契约如何处理？

## 调研结论

1. **有独立 `write` 工具，但没有独立 `delete` 工具。** `packages/opencode/src/tool/` 下有 `write.ts`、`edit.ts`，但**没有** delete/remove/rm 工具。删除文件的能力交给 `shell` 工具（bash `rm`）。这是一个关键信号：OpenCode 认为「删除」不值得单独占一个工具位。

2. **`write` 只做全量写入，语义单一。** 参数只有 `content` + `filePath`（要求绝对路径），没有 `mode`/`append`/`create` 之类的开关。「文件不存在则创建，存在则覆盖」，父目录用 `fs.writeWithDirs` 自动创建。

3. **破坏性操作走「权限确认」通道（`ctx.ask`）。** 写入前先生成 diff，再通过 `ctx.ask({ permission: "edit", ... })` 请求用户批准。这把「要不要写」的决策权交给了框架层的 permission 系统，而不是硬编码在工具里。

4. **安全边界靠 `assertExternalDirectoryEffect`。** 写入前调用它检查目标是否在 worktree 内；若在工作区外，触发一个额外的 `external_directory` 权限询问。注意——它**不是直接拒绝逃逸**，而是升级为「需要额外批准」。

5. **成功回执携带丰富信息：diff + LSP 诊断。** 返回 `Wrote file successfully.`，并把该文件（及最多 5 个其他文件）的 LSP 报错拼进 output，让模型无需再花一轮做验证读取就能发现自己写出的语法错误。

6. **强制「先读后写」+ 大量行为约束写在工具描述里**（见下）。

## 详细分析

### A. `write` 工具描述（`write.txt`）

工具描述本身就是一套行为规范，值得整段引用：

```
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's
  contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless
  explicitly required.
- NEVER proactively create documentation files (*.md) or README files.
- Only use emojis if the user explicitly requests it.
```

关键点：
- **「先读后写」是硬约束**——写已存在的文件前必须先 Read，否则工具直接失败。这是防止模型「盲写覆盖」的护栏。
- **「优先 edit 而非 write」**——引导模型把 write 留给新建/整体重写，局部改动走 edit（对应 zero2agent 的 S002 `replace_in_file`）。

### B. 执行流程（`write.ts`）

```
1. 解析路径：相对路径 join instance.directory
2. assertExternalDirectoryEffect —— 工作区外则额外询问
3. 读旧内容（用于生成 diff、处理 BOM）
4. ctx.ask({ permission: "edit", patterns, metadata: { diff } }) —— 请求批准
5. fs.writeWithDirs —— 写入 + 自动建父目录
6. format.file —— 自动格式化
7. 发布 FileSystem.Edited / Watcher.Updated 事件
8. 收集 LSP 诊断，拼进 output
```

### C. 安全边界：`assertExternalDirectoryEffect`

```typescript
if (containsPath(full, ins)) return false   // 在工作区内，放行
// 否则升级为 external_directory 权限询问
yield* ctx.ask({ permission: "external_directory", patterns: [glob], ... })
```

设计取舍：**不做硬拒绝，而是"工作区内静默放行 / 工作区外升级询问"**。对教学项目而言，硬拒绝更简单、更安全。

### D. 无独立 delete 工具

OpenCode 把删除交给 `shell`。理由推断：
- 删除是低频操作，单开工具收益低；
- `rm` 的语义（递归、强制、通配）用 shell 更自然；
- 但代价是：删除失去了工具层的路径校验和结构化回执，完全依赖 shell 权限层拦截。

## 对 zero2agent 的设计启示

| 维度 | OpenCode 做法 | zero2agent S001 可借鉴 |
|------|--------------|----------------------|
| write 语义 | 单一全量写，无 append | ✅ 建议照做，append 交给未来 edit |
| 父目录 | 自动创建 | ✅ 值得借鉴 |
| 先读后写 | 硬约束（未读则失败） | ⚠️ 需要状态跟踪，S001 可暂缓（见 backlog） |
| 破坏性确认 | permission `ctx.ask` | ⚠️ 需扩展 ToolContext，S001 主线可能不做 |
| 路径逃逸 | 工作区外升级询问 | 🔑 zero2agent 更适合"硬拒绝逃逸" |
| delete | 无独立工具，走 shell | 🔑 关键分歧点：zero2agent 的 Roadmap 明确要做独立 delete |
| 成功回执 | diff + LSP 诊断 | 参考"回执带信息量"思路，但 LSP 太重，S001 用简版 |

## 关键源码引用

- `packages/opencode/src/tool/write.ts#L20-L104`：`write` 工具完整实现（参数、ctx.ask、writeWithDirs、LSP 诊断拼接）
- `packages/opencode/src/tool/write.txt`：工具描述（先读后写、优先 edit 等行为约束）
- `packages/opencode/src/tool/external-directory.ts#L15-L45`：工作区外目录的权限升级逻辑

## 参考资料

- [Codex apply_patch 调研](./codex.md)
- [pi-mono write 调研](./pi-mono.md)
- [Gemini CLI write-file 调研](./gemini-cli.md)
