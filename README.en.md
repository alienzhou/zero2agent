# Zero2Agent

> From zero experience to fully mastering how to build a production-grade AI Agent.

[中文](./README.md) | English

![](./assets/zero2agent-banner.png)

## Is This for You?

If you:

- 🌱 **Want to get started with LLM application development**, but don't know where to begin
- 🤖 **Want to learn AI Agent development**, but find papers too abstract and frameworks too black-box
- 🛠️ **Want to see what real AI-assisted development looks like**, not the "done in 10 minutes" marketing stories
- 📚 **Prefer learning by doing**, rather than just reading theory

Then this project is for you.

---

## What Is This?

**A public learning repository for AI Agent development.**

There's plenty of Agent-related content out there—papers, frameworks, open-source products—but few people document the complete process of "building an Agent from scratch."

That's what this repository does:

- **Starting from the first line of code**, step by step building a Coding Agent similar to Claude Code / Codex
- **Completely open and transparent**, including design decisions, pitfalls, and detours
- **Recording the real process of collaborating with AI**, not just the "final correct answer," but including trial and error

You don't need Agent development experience. Follow along with the iterations, and you'll gradually understand how an Agent evolves from a simple loop into a usable tool.

---

## What You'll Get

### 📖 See the Complete Development Process

Not the "perfect" flow from tutorials, but real development:

- Requirements discussion records (why we did this, not that)
- Design documents (spec for each iteration)
- Retrospective notes (what went right, what went wrong)

### 🤖 Learn AI-Assisted Development

This project uses AI to assist code generation throughout. You can see:

- What the actual prompts look like
- What mistakes AI made and how they were corrected
- Which tasks are suitable for AI, which are not

### 🔧 Follow Along or Make It Your Own

Every iteration has a Git tag, you can:

```bash
git checkout E001-agent-loop  # Jump to any iteration
```

Fork it and get hands-on—that's the best way to learn.

---

## ⚠️ What This Is NOT

This is **NOT a ready-to-use Agent product**.

If you're looking for an out-of-the-box AI coding assistant, try Claude Code, Cursor, Codex, etc.

This is a **learning resource**, not a tool. Follow the iterations, and you'll gradually understand how an Agent evolves from a simple loop into a usable tool.

---

## Project Structure

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

## Iteration Progress

| Iteration | Content | Status |
|-----------|---------|--------|
| E001 | Basic Agent Loop | 🔜 Coming |

👉 See full iteration details and learning guide: [CHANGELOG.md](./CHANGELOG.md)

---

## Quick Start

```bash
git clone git@github.com:alienzhou/zero2agent.git
cd zero2agent
pnpm install && pnpm build
pnpm --filter @zero2agent/tui start
```

Requirements: Node.js >= 22.0.0, pnpm >= 9.0.0

---

## License

MIT
