# D06：grep_search 参数设计

## 状态
✅ Confirmed

## 决策

### 暴露给 LLM 的参数（4 个）

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `pattern` | string | 是 | — | 搜索模式（正则表达式） |
| `path` | string | 否 | 项目根目录 | 搜索目录 |
| `include` | string | 否 | — | 文件过滤 glob，如 `*.ts`、`*.{ts,tsx}` |
| `exclude` | string | 否 | — | 文件排除 glob，如 `*.test.ts` |

### 自动化的部分（不暴露参数）

- `.gitignore` 规则自动遵守（ripgrep 默认行为）
- 结果截断、超时等边界情况由工具内部处理

## 推导过程

按 D04 方法论的 Q2（"LLM 需要控制什么，什么应该自动化？"）推导：

**类比 VS Code 全局搜索（Ctrl+Shift+F）的三个输入框**：
1. 搜索词 → `pattern`
2. files to include → `include`
3. files to exclude → `exclude`

再加上"在哪个目录搜"的控制 → `path`

**排除在外的参数**：
- `context`（上下文行数）→ 归入 Q3（返回格式）讨论
- `literal` / `case_sensitive` → 放入扩展阅读，后续迭代
- `limit` / `names_only` / `before` / `after` 等 → 不需要暴露，内部处理或后续迭代

## 设计原则

> 对人好用的工具对 AI 也好用（D04）

VS Code 搜索的三个框是大多数开发者最常用的控制维度，这同样适用于 Agent 场景。
