# D04：安全边界 —— 复用 resolveInsideCwd 硬拒绝

## 状态
✅ Confirmed

## 决策

`replace_in_file` 复用 S001 建立的 `resolveInsideCwd(cwd, relPath)`（`path-guard.ts`），越界（`..` 逃逸、绝对路径逃逸）一律硬拒绝、不产生任何磁盘副作用。目标必须是**已存在的文件**。

## 竞品对照

与 write-file 调研一致：Gemini 硬拒绝、OpenCode 升级询问。教学项目选**硬拒绝**（简单、明确、可预测），S002 不引入 approval。

## 理由

1. **延续 S001 的物理底线**：写工具（含局部修改）都不可越出工作区，共享同一段边界校验，不重复实现、不产生分叉。
2. **只读先行**：`replace_in_file` 必须先读文件才能替换，天然校验「文件存在」，不存在/是目录返回明确 `Error:`。
3. **软链真实路径解析、危险路径黑名单**仍记 backlog（同 S001），不在本 Story 展开。
