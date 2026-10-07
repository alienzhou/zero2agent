import { it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isLiveEnabled, runCli } from './helpers/cli.js'
import { startLivePty } from './helpers/live-pty.js'
import { SessionStore } from '../../packages/tui/dist/session-store.js'

it.skipIf(!isLiveEnabled() || process.platform === 'win32')(
  'E03-S004 live: a new process recalls saved conversation through the real provider',
  async () => {
    const p = await startLivePty({}, {}, { ui: 'tui' })
    const token = `BLUE-${randomUUID().slice(0, 8)}`
    try {
      await p.session.waitFor('你: ')
      p.session.write(
        `Remember this reference code for our next conversation turn: ${token}. Reply only ACK. Do not call tools.\r`
      )
      await p.session.waitFor('已保存 r2')
      const store = await SessionStore.open(p.cwd, path.join(p.cwd, '.zero2agent', 'sessions'))
      const [saved] = await store.list()
      expect(saved).toBeTruthy()
      p.session.write('exit\r')
      expect(await p.session.waitExit()).toBe(0)
      const before = p.requests.length
      const second = await runCli({
        cwd: p.cwd,
        env: {
          ...p.env,
          HOME: p.cwd,
          ZERO2AGENT_SESSION_DIR: path.join(p.cwd, '.zero2agent', 'sessions'),
          ZERO2AGENT_SKIP_LOCAL_ENV: '1',
        },
        args: [
          '--resume',
          saved.id,
          'What is the reference code I asked you to remember? Reply only with that code. Do not call tools.',
        ],
      })
      expect(second.code, second.stderr).toBe(0)
      // Single-shot stdout contains the actual generated response, never input echo.
      expect(second.stdout).toContain(token)
      expect(p.requests.length).toBeGreaterThan(before)
      expect(JSON.stringify(p.requests[before].messages)).toContain(token)
      expect(p.requests[before].messages.at(-1)?.content).not.toContain(token)
      expect((await store.load(saved.id)).state.messages.length).toBeGreaterThan(2)
      if (process.env.E2E_EVIDENCE_DIR) {
        await fs.mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
        await fs.writeFile(
          path.join(process.env.E2E_EVIDENCE_DIR, 'session-resume.json'),
          JSON.stringify(
            {
              completedAt: new Date().toISOString(),
              platform: process.platform,
              node: process.version,
              sessionId: saved.id,
              token,
              firstProcessExit: 0,
              secondProcessExit: second.code,
              actualSecondAnswer: second.stdout.trim(),
              requests: p.requests,
              responses: p.responses,
            },
            null,
            2
          ) + '\n'
        )
        await fs.writeFile(
          path.join(process.env.E2E_EVIDENCE_DIR, 'session-resume.ansi.gz'),
          gzipSync(p.session.output)
        )
      }
    } finally {
      await p.close()
    }
  },
  120_000
)
