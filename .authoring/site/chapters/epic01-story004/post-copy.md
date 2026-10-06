# Zero2Agent E01-S004 小红书发布文案（对齐往期发布风格）

## 标题（推荐）

**从0学做Agent Harness(4)：固定 Prompt 结构**

### 备选标题

1. 从0上手学做Agent(四)：Prompt 演化与分层摆放
2. 从0学做Agent Harness(4)：System Prompt 怎么拆

---

## 正文（可直接复制发布）

本期是 Zero2Agent 系列的第四课，固定 Prompt 结构——先看清行业怎么演化，再看今天该怎么摆。

1/ 2023→2026：Prompt 行业演化

翻了 Aider、Pi、Codex、OpenCode 等项目的 git 历史，几条主线很清楚：

- 2023：单字符串 → main_system + system_reminder 拆分
- 2024：工具描述外移 schema；cwd、AGENTS.md 走独立通道
- 2025-26：Pi base ~150 词；Codex 同框架不同模型，prompt 按模型重写

模型变强后，部分教学性指令在收缩。Harness 仍管工具编排、循环、上下文管理，Prompt 只是其中一个侧面。

2/ 今天的结构：System vs User + Message List

演化到今天，信息要拆到对的通道里：

- System vs User 两大分块：稳定约束 vs 每轮动态任务
- Message List 是会增长的消息栈：system → user → assistant → tool → tool_result → …
- System 五段式：Role / Scope / Policy / Workflow / Output
- User 两层 XML：runtime_context + user_task
- Cache 分区：静态前缀可缓存，动态后缀每轮刷新

3/ zero2agent S004 代码落地

`buildSystemPrompt()` + `buildUserTaskMessage()`，把上面的结构写进代码。相关实现已同步开源。

适合：正在搭 Agent Harness，或者想搞清楚 System Prompt / User Prompt / Message List 怎么分工的朋友。

课程还在每周更新中，更完整的资料已开源托管，欢迎私信或评论交流。

---

## 标签

#vibecoding #AI工具 #cursor #claude #agent #agent开发实战 #SystemPrompt #Prompt工程 #上下文工程 #AI编程 #程序员 #开源项目

---

## 评论区第一条

跟练搜 **alienzhou / zero2agent** 就能找到仓库（免费、持续更新）。觉得有用点个赞收藏～

---

## 发布建议

### 📸 图片顺序（13 张）

01 封面 → 02 导读 → 03-04 时间线 → 05 System/User → 06 Message List → 07-08 内部结构 → 09 安放地图 → 10 Tool 循环 → 11 Cache → 12 S004 映射 → 13 CTA

### ⏰ 发布时间

工作日 12:00-13:00 或 20:00-22:00；周末 10:00-12:00 或 20:00-22:00

---

## 合规自查

- [x] 正文无 URL / 域名
- [x] 无竞品平台名称（正文）
- [x] 无联系方式
- [x] 仓库名放评论区
- [x] 「欢迎私信或评论交流」不承诺发送资源
