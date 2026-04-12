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

Static Cursor skill: [skills/SKILL.md](./skills/SKILL.md) — copy or symlink into `.cursor/skills/cdp-debug/`.

## API

See `src/server/routes.ts` for HTTP routes. CLI wraps the same endpoints.
