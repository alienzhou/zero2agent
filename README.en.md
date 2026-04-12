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

<h3 align="center">🚀 Build a Production-Grade Agent Harness from Scratch, Hands-on</h3>

<p align="center">
  <i>Dive into engineering details, implement your first Agent Harness (Coding Agent–class capabilities)</i>
</p>

---

## 🎯 About

> There's plenty of Agent-related content out there—papers, tutorials, products, open-source projects—but few teach you how to "implement a production-grade Agent Harness from scratch." This repository is such a **teaching case project**.

- **Starting from the first line of code**, step by step implementing the **Agent Harness** behind a Coding Agent like Claude Code / Codex (loop orchestration, tool use, context, and host integration)
- **Completely open and transparent**, including requirements analysis, design decisions, pitfalls, and detours
- **Recording the real process of collaborating with AI**, Vibe Coding / Agentic Engineering will be applied throughout development

---

## How Is This Different?

| Dimension              | Other Courses                          | Open-Source Products                  | Zero2Agent                                                            |
| ---------------------- | -------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| **Engineering Practice** | Concept-focused, demo-level code       | Only final code, no process           | Deep dive into real engineering problems, distilled from actual Agent Harness / Agent development experience |
| **Production-Grade**   | Basic features and cases               | Complete but complex, hard to learn   | Features curated from real products, designed as hands-on material    |
| **Step-by-Step**       | Chapter-based, large gaps, not detailed | Code changes too complex to follow    | Each iteration can be followed independently, right-sized, progressive |

> One concrete example makes the difference clear:
>
> **Grep Search.** We don't only show how to implement it—we also unpack, from product and engineering angles, the three layers behind **not** using RAG codebase search: effectiveness, cost, and controllability. (→ [grep search vs codebase search](./specs/E01-read-and-search/S002-content-search/deep-dive/04-grep-search-vs-codebase-search.md))

---

## Is This for You?

If you:

- **Want to get started with LLM application development**, but don't know where to begin
- **Want to learn how to implement an Agent Harness**, but find blog posts too abstract and frameworks too black-box
- **Want to see what real AI-assisted development looks like**, not the "done in 10 minutes" marketing stories
- **Prefer learning by doing**, rather than just reading theory

Then this teaching project is for you.

---

## 📦 What You'll Get

### See the Complete/Real Agent Harness Building Process

Content distilled from production projects as teaching cases, not purely a Toy Project, but based on real development.

> This incorporates the author's real product development experience—pitfalls encountered in actual product teams, design decisions made, and even detours taken.

- Starting from actual problems/requirements
- Including requirements discussion records (why we did this, not that), design documents (spec for each iteration, with Story entry pages and `details/` for technical deep dives)
- Accompanying code implementation
- Retrospective notes (what went right, what went wrong)

### Pressure-Free Follow-Along Mode

Every iteration has a Git tag, you can:

```bash
git checkout E01-S001-react-basic  # Jump to any iteration
```

Fork it and get hands-on—that's the best way to learn. Don't worry, you can enter at **any time, from any progress point** (git tag) to follow along, or pick the topics that interest you.

### Learn AI-Assisted Development

This project also uses AI-assisted development throughout, itself a journey of Vibe Coding/Agentic Engineering. You can see:

- What actual coding conversations and prompts with AI look like
- Practice of SSD development and other patterns
- How to use AI to do more

---

## 🗺️ Course Roadmap

The course content is organized into four layers:

- **README / Homepage**: quickly understand the project and where to start
- **Roadmap Overview**: see the full learning map first
- **Epic Page**: understand why a stage exists
- **Story Page**: enter a concrete topic through the course entry, then go into `details/` when you want the technical deep dive

### Current Roadmap

| Epic | Goal | Status |
| ---- | ---- | ---- |
| [Epic 1: Read / Search](./specs/E01-read-and-search/README.md) | Bootstraps a safe, explainable minimal read-only loop for the Agent Harness | In Progress |
| Epic 2: Act / Modify / Execute | Move the Agent Harness from "can inspect" to "can take action" | Planned |
| Epic 3: Core Capabilities and Productization | Move the Agent Harness from a demo toward a usable product shape | Planned |
| Epic 4: Robustness and Context Management | Handle failures, long context, and complex runtime situations | Planned |
| Epic 5: Extensibility | Add AGENTS, Skills, MCP, Hooks, and other extension capabilities | Planned |

### How to Enter

- If this is your first time here, start with the [Course Roadmap Overview](./docs/roadmap/README.md)
  - It gives you the full learning map before you enter a specific Epic or Story
- If you want to jump straight into the first full example, start from [E1-S1: Bootstrapping the Minimal Read-Only Loop for the Agent Harness](./specs/E01-read-and-search/S001-react-basic/README.md)
  - It first tells you what problem this Story solves; when you want the implementation details, continue into the Story's `details/` docs
- If you want to see what changed recently, go to [CHANGELOG.md](./CHANGELOG.md)
  - You can then enter the related Epic or Story from the iteration record

**Recommended first-time reading order**:

1. [Course Roadmap Overview](./docs/roadmap/README.md)
2. [Epic 1: Read / Search](./specs/E01-read-and-search/README.md)
3. [E1-S1: Bootstrapping the Minimal Read-Only Loop for the Agent Harness](./specs/E01-read-and-search/S001-react-basic/README.md)

---

## What This Is NOT

This is not an Agent product intended for direct production use—it's more of a "teaching tool" focused on **implementing an Agent Harness**, not shipping a turnkey product.

If you're looking for an out-of-the-box Coding Agent or assistant, try Claude Code, Cursor, Codex, or projects like Open Code, PI.

This is a **learning resource**, not a pure tool.

---

## Project Structure

```
zero2agent/
├── packages/           # Code
│   ├── core/           # Agent Harness core logic
│   ├── tui/            # CLI interface
│   └── shared/         # Shared code
├── specs/              # Course entry pages and Story technical docs
├── retros/             # Retrospective notes
├── .vibecoding/        # AI collaboration records
├── .discuss/           # Requirements discussion records
└── CHANGELOG.md        # Iteration log
```

---

## Iteration Progress

**Latest update**: E01-S003 File Search (find_files) is done — [see details](./CHANGELOG.md#e01-s003-file-search-done)

| Iteration | Content           | Status    |
| --------- | ----------------- | --------- |
| [E01-S001](./specs/E01-read-and-search/S001-react-basic/README.md) | Basic Agent Harness loop | Done |
| [E01-S002](./specs/E01-read-and-search/S002-content-search/README.md) | Content Search (grep_search) | Done |
| [E01-S003](./specs/E01-read-and-search/S003-file-search/README.md) | File Search (find_files) | Done |

See full iteration records and learning guides: [CHANGELOG.md](./CHANGELOG.md) | [Course Roadmap](./docs/roadmap/README.md)

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
