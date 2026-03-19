# D07：输出格式 — Gemini CLI 风格

## 状态
✅ Confirmed

## 决策

grep_search 的输出采用 Gemini CLI 风格：`File:` 标签 + `L行号:` + `---` 分隔文件块。

### 格式示例

```
Found 5 matches for "runLoop" in 3 files
---
File: src/core/loop.ts
L42: export async function runLoop(config: AgentConfig) {
L88: const result = await runLoop(updatedConfig)
---
File: src/core/index.ts
L15: import { runLoop } from './loop'
---
File: src/test/loop.test.ts
L23: const output = await runLoop(testConfig)
L45: expect(runLoop).toHaveBeenCalled()
```

### 格式要素

| 要素 | 选型 | 理由 |
|------|------|------|
| 路径风格 | 相对路径 | 节省 token |
| 文件归属 | `File:` 标签 + `---` 分隔 | 结构清晰，人和 AI 都易读 |
| 行号格式 | `L42:` | 简洁，便于解析 |
| 首行 | 总匹配数 + 搜索摘要 | 快速概览 |

### 返回内容

- 文件路径（相对路径）
- 行号（支持 grep → read_file 按范围精读的工具链）
- 匹配行内容

## 备选方案

- A (OpenCode 风格)：绝对路径 + 缩进分组 — token 消耗较大
- B (grep 传统风格)：`文件:行号: 内容` 平铺 — 文件名重复，token 效率低

## 推导过程

从使用场景出发：grep_search 定位 → 拿到行号 → read_file 按范围精读。行号是下一步操作的"坐标"，必须包含。路径用相对路径节省 token。格式选结构化程度最高、token 效率最高的方案。
