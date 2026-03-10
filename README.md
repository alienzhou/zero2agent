# Zero2Agent

> 跟着这个项目，从零经验到完全掌握如何开发一个生产级 AI Agent。

中文 | [English](./README.en.md)

![](./assets/zero2agent-banner.png)

## 适合你吗？

如果你：

- 🌱 **想入门 LLM 应用开发**，但不知道从哪开始
- 🤖 **想学习 AI Agent 开发**，但看论文太抽象、看框架又太黑盒
- 🛠️ **想了解真实的 AI 辅助开发是什么样的**，而不是营销文里那种"10 分钟搞定"
- 📚 **喜欢通过实战学习**，而不是只看理论

那这个项目适合你。

---

## 这是什么？

**一个公开的 AI Agent 开发学习仓库。**

市面上有很多 Agent 相关的内容——有论文、有框架、有开源产品——但很少有人记录"从零开始做一个 Agent"的完整过程。

这个仓库就是在做这件事：

- **从第一行代码开始**，一步步构建一个类似 Claude Code / Codex 的 Coding Agent
- **完全公开透明**，包括设计决策、踩过的坑、走过的弯路
- **记录和 AI 协作的真实过程**，不是那种"最终正确答案"，而是包含试错和修正

不需要你有 Agent 开发经验，跟着迭代走，你会逐步理解 Agent 是怎么从一个简单的循环演化成一个能用的工具。

---

## 你能获得什么

### 📖 看到完整的开发过程

不是教程里那种"完美"的流程，而是真实的开发：

- 需求讨论记录（为什么这么做，而不是那么做）
- 设计文档（每次迭代的 spec）
- 复盘笔记（哪里做对了，哪里搞砸了）

### 🤖 学习和 AI 协作开发

这个项目全程用 AI 辅助生成代码，你可以看到：

- 实际用的 prompt 长什么样
- AI 犯了什么错，怎么修正的
- 哪些任务适合交给 AI，哪些不适合

### 🔧 可以跟着做，也可以自己改

每个迭代都有 Git tag，你可以：

```bash
git checkout E001-agent-loop  # 跳到任意迭代
```

Fork 后自己动手，是最好的学习方式。

---

## ⚠️ 这不是什么

这**不是一个可以直接用的 Agent 产品**。

如果你想找一个开箱即用的 AI 编程助手，去试试 Claude Code、Cursor、Codex 这些产品。

这里是**学习资源**，不是工具。跟着迭代走，你会逐步理解 Agent 是怎么从一个简单的循环演化成一个能用的工具。

---

## 项目结构

```
zero2agent/
├── packages/           # 代码
│   ├── core/           # Agent 核心逻辑
│   ├── tui/            # CLI 界面
│   └── shared/         # 共享代码
├── specs/              # 设计文档
├── retros/             # 复盘笔记
├── .vibecoding/        # AI 协作记录
├── .discuss/           # 需求讨论记录
└── CHANGELOG.md        # 迭代日志
```

---

## 迭代进度

| 迭代 | 内容 | 状态 |
|------|------|------|
| E001 | 基础 Agent 循环 | 🔜 Coming |

👉 查看完整迭代说明和学习指南：[CHANGELOG.md](./CHANGELOG.md)

---

## 跑起来

```bash
git clone git@github.com:alienzhou/zero2agent.git
cd zero2agent
pnpm install && pnpm build
pnpm --filter @zero2agent/tui start
```

环境要求：Node.js >= 22.0.0, pnpm >= 9.0.0

---

## License

MIT
