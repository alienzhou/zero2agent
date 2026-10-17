# @zero2agent/cdp-debug

HTTP Server + CLI for programmatic Node.js debugging via CDP (`chrome-remote-interface`). Session state is stored in `.cdp-debug.json` under the project cwd.

## Build

```bash
pnpm --filter @zero2agent/cdp-debug build
```

## CLI

```bash
pnpm exec cdp-debug --help
```

## Skill

Agent Skills example: [cdp-debug-node/SKILL.md](./skills/cdp-debug-node/SKILL.md). Copy or symlink the `cdp-debug-node` directory into `.agents/skills/cdp-debug-node/` (or a client's supported skill root), keeping the directory name equal to the frontmatter `name`. Discovery and loading provide instructions; debugger commands still require the current tool permissions.

## API

See `src/server/routes.ts` for HTTP routes. CLI wraps the same endpoints.
