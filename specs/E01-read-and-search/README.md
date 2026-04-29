# Epic 1：能看 / 能查

> 让 Agent 先学会读文件、查内容、定位信息——在动手改任何东西之前，先把"看"的能力做扎实。

[首页](../../README.md) | [Roadmap](../../docs/roadmap/README.md) | [从这里开始：S001](./S001-react-basic/README.md)

---

## 这个 Epic 做什么

这是整个课程的第一个 Epic。目标很明确：**让 Agent 从零到能安全地读取和搜索信息**。

具体来说，做完这个 Epic 后，Agent 会具备以下能力：

1. **跑通基本循环**——理解用户问题，通过 ReAct 循环驱动模型与工具协作
2. **读文件、看目录**——安全地查看工作区里的文件和目录结构
3. **搜内容、找文件**——在文本中搜关键词，在文件集合中定位目标

不涉及写文件、执行命令等操作——那些是 Epic 2 的事。

---

<p align="center">
  <img src="../../assets/E01-read-search-banner.png" alt="Epic 1 Banner" width="600" />
</p>

---

## Story 列表

| Story | 做什么 | 状态 |
|-------|--------|------|
| [S001：跑通最小只读闭环](./S001-react-basic/README.md) | 搭建 ReAct 循环，接入 `read_file` / `list_directory` 两个只读工具 | ✅ Done |
| [S002：在内容里搜索定位](./S002-content-search/README.md) | 引入内容搜索（grep），在文本中定位目标 | ✅ Done |
| [S003：在文件集合里定位目标](./S003-file-search/README.md) | 引入文件搜索（glob）+ ToolContext 基础设施，更快定位目标文件 | ✅ Done |
| [S004：固定 Prompt 结构](./S004-prompt-structure/README.md) | 工具和循环都跑通后，整理 System / UserTask / Tool / Response 的消息结构 | 📝 Spec Ready |

---

## 从哪里开始

直接进入第一个 Story：

👉 **[S001：跑通最小只读闭环](./S001-react-basic/README.md)**

每个 Story 页面里有完整的阅读顺序、代码指引和跟练说明，跟着走就行。
