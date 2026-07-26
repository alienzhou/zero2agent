# Gemini CLI — 写文件 / 删除文件 调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| 调研 Commit | `d76d2d07422176eefbc90676d8d77a7d912a6970` |
| Commit 日期 | `2026-07-23 17:55:34 +0000` |
| 调研日期 | `2026-07-24` |

## 调研目标

为 E02-S001 提供竞品参考：Gemini CLI 的 `write-file` 工具如何做安全边界、破坏性确认、内容修正？是否有独立 delete？

## 调研结论

1. **有独立 `write-file` 工具（`WriteFileTool`），没有独立 delete 工具。** `packages/core/src/tools/` 下有 `write-file.ts`、`edit.ts`，无 delete/remove。删除同样交给 `shell.ts`。5 家中这已是**一致结论：没有一家做独立 delete 工具**。

2. **这是 5 家里最"重"的 write 实现（726 行）。** 它把「确认 diff → 路径防御性解析 → LLM 内容修正 → 换行符适配 → 写入 → 返回 diff + JIT context → telemetry」全链路都做了。适合作为「工业级 write 都要考虑什么」的反面教材（教学项目不应一次做完）。

3. **破坏性确认走 `getConfirmationDetails`，生成 diff 给用户/IDE 审阅。** 新文件 vs 覆盖都先算 `Diff.createPatch`，弹确认；支持 IDE 内联 diff（`ideClient.openDiff`）。确认粒度由 `ApprovalMode` 控制。

4. **多层路径安全**：
   - `resolveDefensiveToolPath`：清洗 `\0`、处理 `@` 前缀、防止误建 `@src` 这类字面目录；
   - `resolveToRealPath`：解析软链到真实路径（防软链逃逸）；
   - `config.validatePathAccess`：校验目标必须在 workspace 内，否则返回 `PATH_NOT_IN_WORKSPACE` 错误。**这一步是硬校验（返回 error），比 OpenCode 的"升级询问"更严格。**

5. **写前用 LLM 修正内容（`ensureCorrectFileContent`）。** 对非 JSON 文件，会调一次 LLM 把转义错误、占位省略等问题纠正后再落盘。这是 gemini 独有的、很重的一步。

6. **拒绝「省略占位符」内容**：`detectOmissionPlaceholders` 检测到 `rest of methods ...` 这类偷懒占位就报错，强制模型给完整内容。这是防「模型写半截文件」的护栏。

7. **成功回执 = 成功消息 + diff snippet**，让模型免去验证读取。区分 `Successfully created and wrote to new file` vs `Successfully overwrote file`——**明确告诉模型是新建还是覆盖**。

## 详细分析

### A. 参数（`WriteFileToolParams`）

```typescript
interface WriteFileToolParams {
  file_path: string;   // 绝对路径
  content: string;
  modified_by_user?: boolean;      // 用户是否在确认时改过内容
  ai_proposed_content?: string;    // AI 最初提议的内容（用于 diff stat）
}
```

比 pi-mono/OpenCode 多了两个"人在环路"字段，服务于确认流程里用户手改内容的追踪。

### B. 路径安全三连（`write-file.ts` + `utils/paths.ts`）

```
resolveDefensiveToolPath(filePath, targetDir)  // 清洗 + @前缀处理
  → resolveToRealPath(path.resolve(targetDir, sanitized))  // 软链→真实路径
  → config.validatePathAccess(resolvedPath)  // 必须在 workspace 内，否则 error
```

`validatePathAccess` 失败时直接返回 `ToolErrorType.PATH_NOT_IN_WORKSPACE`，**硬拒绝逃逸**。这正是 zero2agent 教学项目最该借鉴的边界策略——简单、明确、安全。

### C. 换行符适配

```typescript
const useCRLF = !isNewFile && originalContent
  ? detectLineEnding(originalContent) === '\r\n' : os.EOL === '\r\n';
if (useCRLF) finalContent = finalContent.replace(/\r?\n/g, '\r\n');
```

覆盖已有文件时，沿用原文件的换行风格，避免整文件因 CRLF/LF 翻转产生巨大 diff。工程上很贴心，S001 可记入 backlog。

### D. 错误类型枚举（`ToolErrorType`）

gemini 把写失败细分为：`PATH_NOT_IN_WORKSPACE` / `FILE_WRITE_FAILURE` / `PERMISSION_DENIED`（EACCES）/ `NO_SPACE_LEFT`（ENOSPC）/ `TARGET_IS_DIRECTORY`（EISDIR）。对比 zero2agent 现有工具用 `Error: xxx` 字符串——这提示 S001 可以在回执里区分「文件不存在 / 是目录 / 权限不足」等常见错误，但不必上升到枚举类型。

## 对 zero2agent 的设计启示

| 维度 | Gemini 做法 | zero2agent S001 建议 |
|------|------------|---------------------|
| 路径逃逸 | validatePathAccess **硬拒绝** | 🔑 **首选借鉴**：写/删前校验在 cwd 内，否则返回 Error |
| 软链逃逸 | resolveToRealPath | ⏸️ 进阶，S001 可记 backlog |
| 破坏性确认 | diff + ApprovalMode | ⚠️ 需框架支持，S001 主线不做 |
| LLM 内容修正 | ensureCorrectFileContent | ❌ 太重，不做 |
| 省略占位检测 | detectOmissionPlaceholders | 💡 有意思的护栏，可 backlog |
| 新建/覆盖区分 | 回执明确区分 | ✅ 建议采纳，回执告诉模型是 create 还是 overwrite |
| 错误细分 | ToolErrorType 枚举 | 简化版：文本区分常见错误即可 |
| delete | 无独立工具 | 🔑 5 家一致：都无独立 delete |

## 关键源码引用

- `packages/core/src/tools/write-file.ts#L367-L539`：`execute` 全链路（校验、修正、换行、写入、diff 回执）
- `packages/core/src/tools/write-file.ts#L306-L365`：`getConfirmationDetails`（生成 diff + IDE 确认）
- `packages/core/src/tools/write-file.ts#L608-L668`：`validateToolParamValues`（路径校验 + 省略占位检测）
- `packages/core/src/utils/paths.ts#L580+`：`resolveDefensiveToolPath`

## 参考资料

- [OpenCode write 调研](./opencode.md)
- [pi-mono write 调研](./pi-mono.md)
