# E01-S003: Backlog

> 当前版本确定不做的事项，留待后续迭代。

---

## 功能 Backlog

### find_files 参数扩展

| 功能 | 说明 | 竞品参考 | 优先级 |
|------|------|---------|--------|
| `case_sensitive` | 大小写敏感控制 | Gemini CLI（默认 false） | 中 |
| `limit` 暴露给 LLM | 让模型控制返回数量 | Pi（默认 1000） | 中 |
| `respect_gitignore` | 控制是否尊重 .gitignore | Gemini CLI | 低 |

### find_files 高级功能

| 功能 | 说明 | 竞品参考 | 优先级 |
|------|------|---------|--------|
| 早停优化 | 达到匹配上限时终止 rg 进程 | Pi（kill 进程） | 高 |
| 字节限截断 | 总输出超过 N KB 时截断 | Pi（50KB） | 中 |
| 双档排序 | 24h 内 mtime 排序 + 更早的字典序 | Gemini CLI | 低 |

### ToolContext 扩展

| 功能 | 说明 | 竞品参考 | 优先级 |
|------|------|---------|--------|
| 权限模型 | `ctx.ask()` 式的权限审批 | OpenCode | 中（需安全迭代时） |
| 截断配置 | 工具级截断参数统一管理 | Pi（共享 truncate 框架） | 低 |
| 多工作区 | 支持多个根目录 | Gemini CLI（`getDirectories()`） | 低 |

---

## 技术优化 Backlog

### 安全性

| 优化项 | 说明 | 竞品参考 |
|--------|------|---------|
| 路径安全检查 | 限制搜索范围在 cwd 内 | OpenCode（`assertExternalDirectory`）、Gemini CLI（`validatePathAccess`） |
| 路径穿越防护 | 检测 `../` 等模式 | Gemini CLI |
| 外部目录授权 | 搜索 cwd 外目录需确认 | OpenCode（`external_directory` 权限） |

### 测试覆盖

| 优化项 | 说明 |
|--------|------|
| find_files 单元测试 | glob 语法、排序、截断、错误处理的独立测试 |
| ToolContext 注入测试 | 传不同 cwd 验证路径解析正确性 |
| 工具链集成测试 | find_files → read_file → grep_search 全链路 |

---

## 被拒绝的方案

| 方案 | 拒绝原因 |
|------|----------|
| 闭包工厂注入 cwd | 样板代码多，每个工具包一层，且 cwd 被烧入闭包后不易动态修改 |
| `process.chdir()` | 全局状态，不可测试，不支持多工作区 |
| 底层用 `fd` | 需要额外的二进制下载机制，增量成本不值；rg 已接入且足够 |
| 底层用 npm `glob` | 无 `.gitignore` 感知，需要手动实现排除逻辑，复杂度高 |
| 底层用 Node `fs.glob` | API 太新，文档不全，AI 训练语料少 |
| 输出绝对路径 | 浪费 token，与 `grep_search` 不一致 |
| Gemini CLI 双档排序 | 复杂度收益比不高，先用简单 mtime 排序 |

---

## Deep Dive 话题池

- 文件搜索 vs 内容搜索：Agent 什么时候该用 `find_files`，什么时候该用 `grep_search`？两者的组合策略有哪些？
- 工具上下文设计演进：从 `ToolContext { cwd }` 到完整的执行沙箱，中间要经过哪些阶段？
- 大仓场景下的文件搜索优化：当项目有百万文件时，mtime 排序 + 100 条截断够不够用？
