# D05：插入 / 删除边界 —— new_string 可空，old_string 不可空

## 状态
✅ Confirmed

## 决策

- **`new_string` 可为空字符串**：等价于删除 `old_string` 匹配到的片段（局部删除）。
- **`old_string` 不可为空**：返回 `Error:`。纯插入场景用「匹配唯一锚点 + 把锚点写回」覆盖，例如「在 `const x = 1` 前插入一行」= 用 `old_string: "const x = 1"`、`new_string: "新增行\nconst x = 1"`。

## 理由

1. **空 old_string 语义模糊**：空字符串匹配到「每个位置之间」，插入位置不唯一，极易误用，显式拒绝更安全。
2. **插入场景不丢能力**：任何「在某处插入」都能表达为「替换该处为（新增 + 原内容）」，不损失表达力。
3. **删除是替换的特例**：`new_string: ""` 让 `replace_in_file` 天然覆盖「删片段」场景，与 S001 的 `delete`（整文件删除）形成清晰分工——`delete` 删整个文件，`replace_in_file` 删片段。
