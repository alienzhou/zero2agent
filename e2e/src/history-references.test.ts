import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { runCli, makeTempWorkspace, REPO_ROOT } from './helpers/cli.js'
import { sendSSEReply } from './helpers/sse.js'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { historyReference } from '../../packages/core/dist/history-evidence.js'

it('E04-S003: new CLI processes recover source roles, recheck original paths, and never replay a saved tool', async () => {
  const marker = `OBSERVED-${randomUUID()}`
  const correction = `CORRECTION-${randomUUID()}: use port 9237, never deploy`
  const ws = await makeTempWorkspace({ 'outside.txt': 'old observation '.repeat(70) + marker })
  const root = await fs.realpath(ws.dir)
  const cwd = path.join(root, 'project')
  await fs.mkdir(cwd)
  const outside = path.join(root, 'outside.txt')
  const requests: Record<string, unknown>[] = []
  const cli: Record<string, unknown> = {}
  let mode = 'create',
    reference = ''
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    const last = body.messages.at(-1)
    const result = Array.isArray(last.content)
      ? last.content.find((b: { type: string }) => b.type === 'tool_result')
      : undefined
    if (result) {
      sendSSEReply(res, [{ type: 'text', text: String(result.content) }])
      return
    }
    sendSSEReply(
      res,
      [
        {
          type: 'tool_use',
          id: `${mode}-call`,
          name: mode === 'create' ? 'read_file' : 'read_history',
          input:
            mode === 'create'
              ? { path: outside }
              : mode === 'user'
                ? { query: 'CORRECTION-' }
                : { reference, limit: 4096 },
        },
      ],
      'tool_use'
    )
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const env = {
    ANTHROPIC_API_KEY: 'synthetic-test-placeholder',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    MODEL_NAME: 'history-contract',
    CONTEXT_WINDOW: '64000',
    MAX_INPUT_TOKENS: '56000',
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    CONTEXT_COUNTING: 'conservative',
    PERMISSION_MODE: 'bypass',
    PERMISSION_RULES: '[]',
    ZERO2AGENT_SESSION_DIR: path.join(root, 'sessions'),
    ZERO2AGENT_RESULT_DIR: path.join(root, 'results'),
    ZERO2AGENT_LOG_DIR: path.join(root, 'logs'),
    ZERO2AGENT_CHECKPOINT_DIR: path.join(root, 'checkpoints'),
  }
  try {
    const created = await runCli({ cwd, env, args: [correction] })
    cli.create = created
    expect(created.code, created.output).toBe(0)
    expect(created.output).toContain(marker)
    const store = await SessionStore.open(cwd, env.ZERO2AGENT_SESSION_DIR)
    const [item] = await store.list()
    let saved = await store.load(item.id)
    const binding = saved.state.history!.sources[0]
    expect(binding.paths).toContain(outside)
    reference = historyReference(saved.state.messages[binding.message], binding.message)
    // A deliberately wrong legacy handoff makes the original source necessary. This is a
    // persisted-snapshot contract, not a claim that a real model generated this summary.
    saved = await store.save(saved, {
      ...saved.state,
      context: {
        through: saved.state.messages.length,
        summary: 'Port 8123. Observation unknown.',
      },
    })
    for (const step of ['user', 'recall', 'deny', 'legacy']) {
      mode = step
      if (step === 'legacy') {
        saved = await store.load(item.id)
        const state = { ...saved.state }
        delete state.history
        await store.save(saved, state)
      }
      const output = await runCli({
        cwd,
        env: { ...env, PERMISSION_MODE: step === 'deny' ? 'read-only' : 'bypass' },
        args: ['--resume', item.id, `Inspect existing evidence: ${step}`],
      })
      cli[step] = output
      expect(output.code, output.output).toBe(0)
      const request = requests.at(-1)!
      const messages = request.messages as Array<{ content: unknown }>
      const currentResult = JSON.stringify(messages.at(-1))
      if (step === 'user') {
        expect(currentResult).toContain(correction)
        expect(currentResult).toContain('quoted_user_statement')
      } else if (step === 'recall') {
        expect(currentResult).toContain(marker)
        expect(currentResult).toContain('tool_observation')
        expect(currentResult).toContain('create-call')
        expect(currentResult).toContain('read_file')
      } else {
        expect(currentResult).not.toContain(marker)
        expect(currentResult).toContain(step === 'deny' ? 'Permission denied' : 'provenance')
      }
    }
    const final = await store.load(item.id)
    const calls = final.state.messages.flatMap(m =>
      Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_use') : []
    )
    expect(calls.filter(c => c.name === 'read_file')).toHaveLength(1)
    expect(calls.filter(c => c.name === 'read_history')).toHaveLength(4)
    expect(await fs.readFile(outside, 'utf8')).toBe('old observation '.repeat(70) + marker)
    expect(requests).toHaveLength(10)
    if (process.env.E2E_EVIDENCE_DIR) {
      const sourceHashes = Object.fromEntries(
        await Promise.all(
          [
            'packages/core/src/history-evidence.ts',
            'packages/core/src/tools/read-history.ts',
            'packages/core/src/loop.ts',
            'packages/core/src/session-snapshot.ts',
            'e2e/src/history-references.test.ts',
          ].map(async file => [
            file,
            createHash('sha256')
              .update(await fs.readFile(path.join(REPO_ROOT, file)))
              .digest('hex'),
          ])
        )
      )
      await fs.mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
      await fs.writeFile(
        path.join(process.env.E2E_EVIDENCE_DIR, 'history-restart.json.gz'),
        gzipSync(
          JSON.stringify({
            capturedAt: new Date().toISOString(),
            node: process.version,
            platform: process.platform,
            sourceHashes,
            cli,
            requests,
            sourceCalls: 1,
          })
        )
      )
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await ws.cleanup()
  }
})
