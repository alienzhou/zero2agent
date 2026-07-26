# 写文件 / 删除文件 —— 五竞品横向对比

> 调研日期：2026-07-24 ｜ 服务对象：zero2agent E02-S001（write_file + delete）
> 单项报告：[opencode](./opencode.md) ｜ [codex](./codex.md) ｜ [pi-mono](./pi-mono.md) ｜ [gemini-cli](./gemini-cli.md) ｜ [aider](./aider.md)

## 一、总览矩阵

| 维度 | OpenCode | Codex | pi-mono | Gemini CLI | Aider |
|------|----------|-------|---------|-----------|-------|
| 范式 | Function Tool | FREEFORM 补丁 | Function Tool | Function Tool | Edit Format(文本解析) |
| 独立 write | ✅ `write` | ❌ 合入 apply_patch | ✅ `write` | ✅ `WriteFileTool` | ❌ whole coder |
| 独立 delete | ❌ 走 shell | ❌ Delete File hunk | ❌ 走 bash | ❌ 走 shell | ❌ 无 |
| write 参数 | content+filePath | 补丁文本 | **path+content** | file_path+content+2 辅助字段 | 回复文本里的 fenced block |
| 全量/局部 | write 全量, edit 局部 | Add/Update hunk | write 全量, edit 局部 | write 全量, edit 局部 | whole / editblock |
| 父目录自动建 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 路径安全 | 区外→升级询问 | patch 内路径校验 | resolveToCwd | **validatePathAccess 硬拒绝** + 软链解析 | git 仓库范围 |
| 破坏性确认 | ctx.ask permission | 审批流 | 无(有 mutation queue) | diff + ApprovalMode | **git 自动 commit(事后可回滚)** |
| 先读后写 | **硬约束** | — | — | — | — |
| 成功回执 | Wrote + LSP 诊断 | 补丁应用结果 | **Successfully wrote N bytes** | 成功消息 + diff, 区分 create/overwrite | — |
| 实现重量 | 中(~100行) | 重(Lark语法+parser) | **轻(~45行)** | **最重(726行)** | 中(coder体系) |

## 二、跨竞品关键洞察

### 🔑 洞察 1：没有任何一家做「独立 delete 工具」
五家全部如此：OpenCode/pi-mono/Gemini 交给 shell，Codex 做成补丁里的 `*** Delete File:` hunk，Aider 靠 git。**行业共识是「删除不值得单开一个工具位」**。

这直接冲击 zero2agent Roadmap「write + delete 各自独立工具」的方向。它不是我们抄漏了，而是**一个需要在 Spec 里明确交代的有意分歧**——教学项目里，独立 `delete` 工具有其价值：
- 教学直观性：让读者看到「一个工具 = 一种意图」，delete 语义清晰；
- 可控性：独立工具能做工具层的路径校验和结构化回执，而 shell `rm` 完全依赖 shell 权限层；
- 但代价是偏离工业界主流，需在 spec 的「设计取舍」小节写明。

### 🔑 洞察 2：write 的「最小闭环」形态高度收敛
去掉各家的工程复杂度后，最小 write = **`{path, content}` + 自动建父目录 + 不存在则建/存在则覆盖**。pi-mono 几乎就是这个裸形态（`Successfully wrote N bytes to path` 回执），与 zero2agent 现有 string 回执风格无缝对接。→ **pi-mono 是 S001 write_file 的直接蓝本**。

### 🔑 洞察 3：路径安全有两种流派
- **硬拒绝**（Gemini `validatePathAccess`）：区外直接返回 error。简单、安全、可预测。
- **升级询问**（OpenCode `assertExternalDirectory`）：区外触发额外审批。灵活但依赖 permission 框架。
→ 教学项目应选**硬拒绝**：写/删前校验目标在 cwd 内，否则返回 `Error:`，无需引入审批框架。

### 🔑 洞察 4：破坏性确认有两条路，S001 都可暂缓
- **事前确认**：OpenCode ctx.ask / Gemini ApprovalMode（需扩展 ToolContext + 框架支持）。
- **事后回滚**：Aider git 自动 commit（Epic 3 Checkpoint 的思路来源）。
→ S001 主线两者都不做（保持最小闭环），但要在 backlog 记明这两条演进路径，分别对应 D04 与未来 Epic 3。

### 🔑 洞察 5：回执带信息量是趋势，但要控重
OpenCode 拼 LSP 诊断、Gemini 附 diff 并区分 create/overwrite。对 S001：
- ✅ 采纳「回执区分新建 vs 覆盖」（Gemini 做法，零成本、对模型有用）；
- ❌ LSP/diff 太重，不做。

## 三、对 D01–D07 的初步映射

| 决策点 | 竞品证据 | 倾向 |
|--------|---------|------|
| D01 工具粒度 | 4/5 家无独立 delete；write 均单一全量 | write_file 与 delete 独立（有意偏离主流，需说明）；create/overwrite 不再分,由回执区分 |
| D02 写入语义 | 全员「不存在建/存在覆盖 + 自动建父目录」，无 append | 全量写入,自动建父目录,不做 append |
| D03 安全边界 | Gemini 硬拒绝 vs OpenCode 升级询问 | **硬拒绝逃逸**（校验在 cwd 内） |
| D04 破坏性确认 | 事前(OpenCode/Gemini) / 事后(Aider git) | S001 不做,记 backlog(→D07/Epic3) |
| D05 delete 范围 | 竞品都用 shell rm(可递归) | S001 建议先只删文件,删目录/不存在目标的回应待议 |
| D06 返回契约 | pi-mono N bytes / Gemini 区分create-overwrite | 沿用 string 回执,内容含路径 + 新建/覆盖标识 |
| D07 ToolContext | OpenCode/Gemini 靠 permission 扩展 | S001 暂不扩展 ctx,维持只有 cwd |

> 以上仅为**基于调研的倾向**，非结论。正式决策仍需在 outline 的 D01–D07 逐点与用户确认后落入 `decisions/`。
