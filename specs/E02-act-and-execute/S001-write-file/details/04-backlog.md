# E02-S001: Backlog

> 当前版本确定不做的事项，留待后续迭代。

---

## 功能 Backlog

### 破坏性操作确认（最高优先，独立成章）

| 功能 | 说明 | 竞品参考 | 归属 |
|------|------|---------|------|
| 事前确认 | 覆盖/删除前弹确认，人工批准 | OpenCode `ctx.ask`、Gemini `ApprovalMode` | **后续专章** |
| 批准模式 | auto / ask / deny 等粒度 | Gemini ApprovalMode | 后续专章 |
| diff 呈现 | 确认时展示写入/删除的 diff | OpenCode、Gemini | 后续专章 |
| 事后回滚 | 每次写/删自动 Checkpoint，可撤销 | Aider（git 自动 commit + revert） | **Epic 3** |

> 事前确认一旦引入就要扩展 `ToolContext`（approval 回调），所以它和 D07「不扩展 ctx」绑定在一起，统一放到后续专章一次性做好。

### write_file 扩展

| 功能 | 说明 | 竞品参考 | 优先级 |
|------|------|---------|--------|
| 「先读后写」约束 | 改已存在文件前必须先 Read，否则失败 | OpenCode（硬约束）| 中（需状态跟踪）|
| 省略占位检测 | 检测 `... rest of code ...` 这类偷懒占位并报错 | Gemini `detectOmissionPlaceholders` | 中 |
| 换行符适配 | 覆盖时沿用原文件 CRLF/LF 风格 | Gemini | 低 |
| LLM 内容修正 | 写前用 LLM 纠正转义/占位错误 | Gemini `ensureCorrectFileContent` | 低（太重）|

### delete 扩展

| 功能 | 说明 | 竞品参考 | 优先级 |
|------|------|---------|--------|
| 递归删目录 | 支持删除目录及其内容 | shell `rm -r` | 中（需配套确认，Epic 3 后）|
| 通配符删除 | 支持 glob 批量匹配删除 | shell | 低 |
| 幂等删除选项 | 删不存在的目标当作成功 | —— | 低 |

---

## 技术优化 Backlog

### 安全性

| 优化项 | 说明 | 竞品参考 |
|--------|------|---------|
| 软链接真实路径解析 | 防 cwd 内软链指向外部造成逃逸 | Gemini `resolveToRealPath` |
| 危险路径黑名单 | 禁止写/删 `.git/`、系统目录等 | —— |
| 文件级串行锁 | 同一文件并发写不交错 | pi-mono `file-mutation-queue` |

### 回执增强

| 优化项 | 说明 | 竞品参考 |
|--------|------|---------|
| 附 diff | 回执带写入/删除的 diff 摘要 | Gemini |
| 附 LSP 诊断 | 写后拼接语法/类型错误 | OpenCode |
| 结构化返回 | 从 string 升级为结构化结果类型 | —— |

### 架构演进

| 优化项 | 说明 | 竞品参考 |
|--------|------|---------|
| 可插拔写操作 | 把 fs 操作抽象为接口，支持远程/SSH | pi-mono `WriteOperations` |
| 统一补丁范式 | 一次调用批量「建/删/改」多文件 | Codex `apply_patch` |

---

## 被拒绝的方案

| 方案 | 拒绝原因 |
|------|----------|
| write 与 delete 合并成一个工具 | 违背「一个工具一种意图」，语义混淆 |
| 用统一补丁（apply_patch）范式 | 对模型格式遵循要求高，不适合教学主线（记为进阶对照）|
| 把删除交给 shell（如竞品）| Epic 2 此刻无 terminal，且失去工具层校验和结构化回执 |
| delete 部分失败方案 A（遇错即停）| 语义模糊，Agent 无法知道整体状态 |
| delete 部分失败方案 C（先全校验才删）| 更安全但牺牲批量便利，收益比不高 |
| write_file 支持 append/mode | 污染单一职责，局部改留给 S002 |
| 路径越界升级询问（OpenCode 式）| 依赖 permission 框架，本 Story 不引入 approval |
| S001 就扩展 ToolContext | 无 approval 需求就无扩展理由，接口稳定优先 |
| 回执附 LSP 诊断 / diff | 太重，S001 用简版回执 |
| 错误类型枚举（Gemini ToolErrorType）| 文本区分常见错因即可，不必上枚举 |

---

## Deep Dive 话题池

- **只读工具 vs 写工具**：当 Agent 第一次拥有副作用，工具设计的重心发生了哪些转移？
- **物理边界 vs 意图边界**：cwd 硬拒绝守的是「能不能碰」，破坏性确认守的是「该不该碰」，两者如何分层？
- **批量操作的部分失败语义**：为什么「尽力做 + 逐条汇总」通常比「事务式全或无」更适合 Agent？
- **独立 delete 工具的取舍**：全行业都用 shell/补丁，教学项目坚持独立工具，值不值？
- **可回滚 vs 需确认**：Aider 的 git-as-undo 和 OpenCode 的事前确认，是两种互补的破坏性防护哲学。
