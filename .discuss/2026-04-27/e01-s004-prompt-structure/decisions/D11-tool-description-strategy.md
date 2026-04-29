# D11：Tool 描述策略

## 决策

S004 采用：

```text
Tool schema 写完整工具 description；
Default System 只写 Tool Policy。
```

也就是说，Default System 不再逐个重复 `read_file`、`list_directory`、`grep_search`、`find_files` 的完整说明。

## 原因

当前 `SYSTEM_PROMPT` 和 tool schema 同时维护工具描述，容易出现双写漂移：

- prompt 中的工具说明偏教学文本。
- schema 中的工具 description 才是模型实际调用工具时最直接的契约。

S004 要做的是固定 Prompt 结构，因此应把职责拆开：

| 位置 | 负责内容 |
|------|----------|
| Tool schema | 工具能做什么、参数是什么、输入输出约束 |
| Tool Policy | 什么时候用工具、如何组合工具、如何避免误用 |

## 对 zero2agent 的影响

System Prompt 中可以保留类似策略：

```text
查找文件名或路径时优先使用 find_files；
查找文件内容时使用 grep_search；
定位后再用 read_file 精读；
需要了解目录结构时使用 list_directory。
```

但不在 System Prompt 中重复每个工具的完整参数说明。
