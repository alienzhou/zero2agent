<p align="center">
  <img src="./assets/zero2agent-banner.png" alt="Zero2Agent Banner" />
</p>

<h1 align="center">Zero2Agent</h1>

<p align="center">
  <a href="https://github.com/alienzhou/zero2agent"><img src="https://img.shields.io/badge/language-TypeScript-blue" alt="Language" /></a>
  <a href="https://github.com/alienzhou/zero2agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <a href="https://github.com/alienzhou/zero2agent"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" /></a>
</p>

<p align="center">
  <a href="./README.md">中文</a> | <a href="./README.en.md">English</a>
</p>

<h3 align="center">🚀 A Hands-on Course for Building Production-Grade AI Agents from Scratch</h3>

<p align="center">
  <i>Dive into engineering details, build your first Coding Agent</i>
</p>

---

## 🎯 About

> There's plenty of Agent-related content out there—papers, tutorials, products, open-source projects—but few teach you how to "build a production-grade Agent from scratch." This repository is such a **teaching case project**.

- **Starting from the first line of code**, step by step building a production-grade Coding Agent similar to Claude Code / Codex
- **Completely open and transparent**, including requirements analysis, design decisions, pitfalls, and detours
- **Recording the real process of collaborating with AI**, Vibe Coding / Agentic Engineering will be applied throughout development

---

## ✨ How Is This Different?

| Dimension              | Other Courses                          | Open-Source Products                  | Zero2Agent                                                            |
| ---------------------- | -------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| **Engineering Practice** | Concept-focused, demo-level code       | Only final code, no process           | Deep dive into real engineering problems, distilled from actual Agent development experience |
| **Production-Grade**   | Basic features and cases               | Complete but complex, hard to learn   | Features curated from real products, designed as hands-on material    |
| **Step-by-Step**       | Chapter-based, large gaps, not detailed | Code changes too complex to follow    | Each iteration can be followed independently, right-sized, progressive |

---

## 🎓 Is This for You?

If you:

- 🌱 **Want to get started with LLM application development**, but don't know where to begin
- 🤖 **Want to learn AI Agent development**, but find blog posts too abstract and frameworks too black-box
- 🛠️ **Want to see what real AI-assisted development looks like**, not the "done in 10 minutes" marketing stories
- 📚 **Prefer learning by doing**, rather than just reading theory

Then this teaching project is for you.

---

## 📦 What You'll Get

### 📖 See the Complete/Real AI Agent Building Process

Content distilled from production projects as teaching cases, not purely a Toy Project, but based on real development:

- Starting from actual problems/requirements
- Including requirements discussion records (why we did this, not that), design documents (spec for each iteration)
- Accompanying code implementation
- Retrospective notes (what went right, what went wrong)

### 🤖 Learn AI-Assisted Development

This project also uses AI-assisted development throughout, itself a journey of Vibe Coding/Agentic Engineering. You can see:

- What actual coding conversations and prompts with AI look like
- Practice of SSD development and other patterns
- How to use AI to do more

### 🔧 Pressure-Free Follow-Along Mode

Every iteration has a Git tag, you can:

```bash
git checkout E001-agent-loop  # Jump to any iteration
```

Fork it and get hands-on—that's the best way to learn. Don't worry, you can enter at **any time, from any progress point** (git tag) to follow along, or pick the topics that interest you.

---

## ⚠️ What This Is NOT

This is not an Agent product intended for direct production use, it's more of a "teaching tool."

If you're looking for an out-of-the-box AI Agent, try Claude Code, Cursor, Codex, or projects like Open Code, PI.

This is a **learning resource**, not a pure tool.

---

## 📁 Project Structure

```
zero2agent/
├── packages/           # Code
│   ├── core/           # Agent core logic
│   ├── tui/            # CLI interface
│   └── shared/         # Shared code
├── specs/              # Design documents
├── retros/             # Retrospective notes
├── .vibecoding/        # AI collaboration records
├── .discuss/           # Requirements discussion records
└── CHANGELOG.md        # Iteration log
```

---

## 📈 Iteration Progress

| Iteration | Content           | Status    |
| --------- | ----------------- | --------- |
| E001      | Basic Agent Loop  | 🔜 Coming |

👉 See full iteration details and learning guide: [CHANGELOG.md](./CHANGELOG.md)

---

## 🚀 Quick Start

```bash
git clone git@github.com:alienzhou/zero2agent.git
cd zero2agent
pnpm install && pnpm build
pnpm --filter @zero2agent/tui start
```

Requirements: Node.js >= 22.0.0, pnpm >= 9.0.0

---

## 📄 License

MIT
