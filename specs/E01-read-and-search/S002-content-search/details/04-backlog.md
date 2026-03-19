# E01-S002: Backlog

> 当前版本确定不做的事项，留待后续迭代。也是学习者的 Deep Dive 话题池。

---

## 功能 Backlog

### 参数扩展

| 功能 | 说明 | 竞品参考 | 优先级 |
|------|------|---------|--------|
| `literal` / `fixed_strings` | 字面量搜索，避免正则特殊字符出错 | Pi, Gemini CLI (2/4) | 高 |
| `case_sensitive` | 大小写敏感控制 | Pi, Gemini CLI (2/4) | 中 |
| `limit` 暴露给 LLM | 让 LLM 控制返回数量 | Codex, Pi, Gemini CLI (3/4) | 中 |
| `names_only` | 仅返回文件路径，不返回内容 | Gemini CLI (1/4) | 低 |
| `before` / `after` | 非对称上下文 | Gemini CLI (1/4) | 低 |

### 高级功能

| 功能 | 说明 | 竞品参考 | 优先级 |
|------|------|---------|--------|
| 自动上下文丰富 | ≤3 个匹配时自动附加 15-50 行上下文 | Gemini CLI（SWE-Bench 减少 ~10% turn） | 高 |
| 流式早停 | 达到匹配上限时直接终止 ripgrep | Pi (kill 进程), Gemini CLI (break 迭代) | 中 |
| 结果排序可控 | 暴露排序方式参数 | — | 低 |

---

## 截断与边界处理 Backlog

| 优化项 | 说明 | 竞品参考 |
|--------|------|---------|
| 单行长度截断 | 超长行截断（500-2000 字符） | Pi 500, OpenCode/Gemini CLI 2000 |
| 总量限制 | 2000 行 / 50KB | OpenCode, Pi |
| 分层截断提示 | 每层截断给独立的提示信息 | Pi |
| 超时机制 | 30 秒超时 | Codex, Gemini CLI |
| 输入校验 | 正则语法预检、路径合法性检查 | Gemini CLI |

---

## 技术优化 Backlog

### 降级策略

| 方案 | 说明 | 竞品参考 |
|------|------|---------|
| git grep 降级 | ripgrep 不可用时回退到 git grep | Gemini CLI |
| system grep 降级 | git grep 也不可用时用系统 grep | Gemini CLI |
| 纯 JS 降级 | 最后回退到 Node.js fs + RegExp | Gemini CLI |

当前只走 ripgrep 一条路。Gemini CLI 的三级降级是最完善的，但实现复杂度也最高。

### ripgrep 分发

| 方案 | 适用场景 | 说明 |
|------|---------|------|
| `@vscode/ripgrep` | 当前开发阶段 ✅ | install 时下载 |
| 内置二进制 | 打包发布 | 仓库体积增大 20-30MB |
| 平台 optional deps | npm 发布 | 类似 esbuild 的做法 |

### 安全性

| 优化项 | 说明 |
|--------|------|
| 路径安全检查 | 限制搜索范围在项目目录内 |
| 路径穿越防护 | 检测 `../` 等模式 |
| 外部目录授权 | 搜索项目外目录需确认 |

---

## 设计取舍记录

这些是讨论中权衡过的设计选择，记录原因以供参考：

| 选择 | 备选方案 | 选择理由 |
|------|---------|---------|
| 相对路径输出 | 绝对路径（OpenCode） | 节省 token，结果更紧凑 |
| 默认 context=0 | 默认 context=2-3 | 大量匹配时 token 少，LLM 按需指定 |
| 应用层排序 | ripgrep `--sortr`（Codex） | 不依赖 rg 版本，更可控 |
| 5 个参数 | 3 个（OpenCode） / 13 个（Gemini CLI） | VS Code 搜索习惯的最小集 + context |
| 简单截断 100 条 | 多层截断（Pi） | MVP 先简单，后续迭代完善 |

---

## 开放性问题

| 问题 | 说明 |
|------|------|
| 搜索结果缓存 | 短时间内重复搜索同一 pattern 要不要缓存？ |
| 多 pattern 搜索 | 一次搜多个关键词的需求场景多不多？ |
| 语义搜索 | 内容搜索之外，是否需要代码语义搜索（如 OpenCode 的 CodeSearchTool）？ |
