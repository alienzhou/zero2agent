// Production SDK + disk session. Parent tests kill this real host at frozen boundaries.
import fs from 'node:fs/promises'
import path from 'node:path'
import { hostname } from 'node:os'
import { Agent, Hooks, allTools } from '../../../packages/core/dist/index.js'
import { SessionStore } from '../../../packages/tui/dist/session-store.js'
const [cwd, baseURL, stop] = process.argv.slice(2)
const config = JSON.parse(await fs.readFile(path.join(cwd, 'hooks.json'), 'utf8'))
const views = await new Hooks(cwd, { file: path.join(cwd, 'hooks.json') }).inspect()
const write = allTools.find(t => t.name === 'write_file')
const a = new Agent({
  cwd,
  skills: process.argv[5] === 'combined' ? { selected: ['fix-with-tests'] } : false,
  projectInstructions: process.argv[5] === 'combined' ? { root: cwd } : false,
  ...(process.argv[5] === 'combined' && {
    mcp: {
      servers: [
        {
          id: 'issues',
          enabled: true,
          command: process.execPath,
          args: [
            path.resolve(import.meta.dirname, '../../../researches/mcp/issue-server.mjs'),
            'normal',
            path.join(cwd, 'mcp-audit'),
          ],
        },
      ],
    },
  }),
  hooks: { file: path.join(cwd, 'hooks.json'), trust: views.map(v => `${v.id}:${v.identity}`) },
  config: { apiKey: 'fixture', baseURL },
  permissions: { mode: 'accept-edits' },
  tools: [
    {
      ...write,
      execute: async (i, c) => {
        const result = await write.execute(i, c)
        await fs.appendFile(path.join(cwd, 'effects'), 'write\n')
        return result
      },
    },
  ],
})
const store = await SessionStore.open(cwd, path.join(cwd, 'sessions'))
let current = await store.save(store.fresh(), a.snapshot(), {
  kind: 'turn',
  pid: process.pid,
  host: hostname(),
})
a.setExecutionPersistence(async (snapshot, boundary) => {
  current = await store.save(current, snapshot, current.pending)
  if (boundary === stop) process.kill(process.pid, 'SIGKILL')
})
await a.run('Write first.txt exactly once; do not replay after interruption.')
