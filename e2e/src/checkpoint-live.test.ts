import { it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { isLiveEnabled, runCli } from './helpers/cli.js'
import { startLivePty } from './helpers/live-pty.js'
import { CheckpointStore } from '../../packages/tui/dist/checkpoint-store.js'

it.skipIf(!isLiveEnabled() || process.platform === 'win32')(
  'E03-S006 live: real write_file effect, durable checkpoint, keyless undo/redo and no tool replay',
  async () => {
    const before = `BEFORE-${randomUUID()}\n`,
      after = `AFTER-${randomUUID()}\n`
    const p = await startLivePty(
      { 'checkpoint-probe.txt': before },
      { PERMISSION_MODE: 'accept-edits' },
      { ui: 'tui' }
    )
    try {
      await p.session.waitFor('你: ')
      p.session.write(
        `Use write_file exactly once to replace checkpoint-probe.txt with the following exact UTF-8 content including its final newline: ${JSON.stringify(after)}. Do not run shell commands. Then say done.\r`
      )
      await p.session.waitFor('已保存 r2')
      expect(await readFile(path.join(p.cwd, 'checkpoint-probe.txt'), 'utf8')).toBe(after)
      const store = await CheckpointStore.open(p.cwd),
        records = await store.list()
      const record = records.find(r => r.toolName === 'write_file')!
      expect(record).toBeTruthy()
      expect(record.changes[0].path).toBe('checkpoint-probe.txt')
      const requests = p.requests.length
      const env = { ...p.env, ZERO2AGENT_SKIP_LOCAL_ENV: '1', ANTHROPIC_API_KEY: undefined }
      const preview = await runCli({ cwd: p.cwd, env, args: ['--undo', record.id] })
      expect(preview.code).toBe(0)
      const token = preview.output.match(/确认令牌: ([0-9a-f]{64})/)![1]
      const undo = await runCli({
        cwd: p.cwd,
        env,
        args: ['--undo', record.id, '--confirm', token],
      })
      expect(undo.code).toBe(0)
      expect(await readFile(path.join(p.cwd, 'checkpoint-probe.txt'), 'utf8')).toBe(before)
      const [inverse] = await store.list(),
        redo = await store.preview(inverse.id)
      expect(
        (await runCli({ cwd: p.cwd, env, args: ['--undo', inverse.id, '--confirm', redo.token] }))
          .code
      ).toBe(0)
      expect(await readFile(path.join(p.cwd, 'checkpoint-probe.txt'), 'utf8')).toBe(after)
      expect(p.requests.length).toBe(requests)
      const calls = p.requests
        .flatMap(r => r.messages)
        .flatMap(m => (Array.isArray(m.content) ? m.content : []))
      expect(
        calls.some(
          b => b.type === 'tool_use' && b.id === record.toolCallId && b.name === 'write_file'
        )
      ).toBe(true)
      p.session.write('exit\r')
      expect(await p.session.waitExit()).toBe(0)
      if (process.env.E2E_EVIDENCE_DIR) {
        const evidence = JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            platform: process.platform,
            node: process.version,
            records: await store.list(),
            requests: p.requests,
            responses: p.responses,
            actualOutput: p.session.output,
            keylessUndoExit: undo.code,
            restoredBefore: before,
            restoredAfter: after,
            noNewProviderRequests: true,
          },
          null,
          2
        )
        if (evidence.includes(process.env.ANTHROPIC_API_KEY!))
          throw new Error('Credential in evidence')
        await mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
        await writeFile(
          path.join(process.env.E2E_EVIDENCE_DIR, 'checkpoint-live.json.gz'),
          gzipSync(evidence)
        )
      }
    } finally {
      await p.close()
    }
  },
  120_000
)
