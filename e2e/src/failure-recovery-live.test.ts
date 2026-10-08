import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { isLiveEnabled, runCli, makeTempWorkspace } from './helpers/cli.js'
import { CheckpointStore } from '../../packages/tui/dist/checkpoint-store.js'
import { LogStore } from '../../packages/tui/dist/run-log.js'

it.skipIf(!isLiveEnabled())(
  'E04-S001 live: injected transport failures preserve a real model write and retry only requests',
  async () => {
    const workspace = await makeTempWorkspace()
    const content = `RECOVERY-${randomUUID()}`
    const requests: Array<{ injected?: number; status?: number; body: Record<string, unknown> }> =
      []
    const upstream = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
    let injectedAfterWrite = false
    const server = createServer(async (req, res) => {
      const controller = new AbortController()
      res.once('close', () => {
        if (!res.writableEnded) controller.abort()
      })
      try {
        let raw = ''
        for await (const chunk of req) raw += chunk
        const observation: (typeof requests)[number] = { body: JSON.parse(raw) }
        requests.push(observation)
        const written = await readFile(path.join(workspace.dir, 'effect.txt'), 'utf8').catch(
          () => ''
        )
        const injected =
          requests.length === 1 ? 500 : written === content && !injectedAfterWrite ? 503 : undefined
        if (injected) {
          if (injected === 503) injectedAfterWrite = true
          observation.injected = injected
          res.writeHead(injected, { 'content-type': 'application/json', 'retry-after-ms': '1' })
          res.end(
            JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: 'Local live-test transport fault' },
            })
          )
          return
        }
        const headers = new Headers()
        for (const [name, value] of Object.entries(req.headers)) {
          if (['host', 'connection', 'content-length', 'accept-encoding'].includes(name)) continue
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
        const response = await fetch(upstream.replace(/\/$/, '') + req.url, {
          method: req.method,
          headers,
          body: raw,
          signal: controller.signal,
        })
        observation.status = response.status
        if (!response.ok) {
          // Never retain or echo an upstream diagnostic body; it can contain credentials.
          res.writeHead(response.status, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: `Live upstream HTTP ${response.status}` },
            })
          )
          return
        }
        res.writeHead(response.status, {
          'content-type': response.headers.get('content-type') ?? 'application/json',
        })
        if (response.body) for await (const chunk of response.body) res.write(chunk)
        res.end()
      } catch {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'api_error', message: 'Live upstream transport failed' },
          })
        )
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Missing proxy port')
    try {
      const result = await runCli({
        cwd: workspace.dir,
        env: {
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
          ZERO2AGENT_SKIP_LOCAL_ENV: '1',
          PERMISSION_MODE: 'accept-edits',
          PERMISSION_RULES: '[]',
          CONTEXT_COUNTING: 'conservative',
          ZERO2AGENT_MAX_REQUESTS: '8',
          ZERO2AGENT_MAX_ITERATIONS: '4',
          ZERO2AGENT_MAX_TOOL_CALLS: '2',
          ZERO2AGENT_MAX_DURATION_MS: '180000',
          ZERO2AGENT_REQUEST_TIMEOUT_MS: '90000',
          ZERO2AGENT_RETRY_BASE_MS: '1',
        },
        args: [
          `Use write_file exactly once to create effect.txt with the exact UTF-8 content ${JSON.stringify(content)} and no trailing newline. Do not call shell tools. Then say done. This is a filesystem integration test; do not simulate tool results.`,
        ],
      })
      const checkpointStore = await CheckpointStore.open(workspace.dir)
      const records = await checkpointStore.list()
      const logStore = await LogStore.open(workspace.dir)
      const [item] = await logStore.list()
      const journal = await logStore.read(item.id)
      const evidence = JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          platform: process.platform,
          node: process.version,
          scope:
            'Real configured model service; local proxy injects one initial 500 and one 503 after actual write. No naturally occurring provider failure claimed.',
          requests,
          cliExit: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
          actualFile: await readFile(path.join(workspace.dir, 'effect.txt'), 'utf8').catch(
            () => null
          ),
          records,
          journal,
          sourceHashes: Object.fromEntries(
            await Promise.all(
              [
                'packages/core/src/loop.ts',
                'packages/core/src/request-executor.ts',
                'packages/tui/src/cli.ts',
              ].map(async name => [
                name,
                createHash('sha256')
                  .update(await readFile(path.resolve(import.meta.dirname, '../..', name)))
                  .digest('hex'),
              ])
            )
          ),
        },
        null,
        2
      )
      if (evidence.includes(process.env.ANTHROPIC_API_KEY!))
        throw Error('Credential in evidence; refusing to save')
      if (process.env.E2E_EVIDENCE_DIR) {
        await mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
        await writeFile(
          path.join(process.env.E2E_EVIDENCE_DIR, 'failure-recovery-live.json.gz'),
          gzipSync(evidence)
        )
      }
      expect(result.code).toBe(0)
      expect(await readFile(path.join(workspace.dir, 'effect.txt'), 'utf8')).toBe(content)
      expect(records.filter(record => record.toolName === 'write_file')).toHaveLength(1)
      expect(requests.filter(request => request.injected)).toHaveLength(2)
      expect(requests.filter(request => request.injected).map(request => request.injected)).toEqual(
        [500, 503]
      )
      expect(requests.filter(request => request.status === 200)).toHaveLength(2)
      expect(requests).toHaveLength(4)
      expect(requests[0].body).toEqual(requests[1].body)
      expect(requests[2].body).toEqual(requests[3].body)
      expect(journal.warnings).toEqual([])
      expect(
        journal.records.filter(record => record.kind === 'request' && record.event === 'retry')
      ).toHaveLength(2)
      expect(
        journal.records.filter(record => record.kind === 'tool' && record.event === 'running')
      ).toHaveLength(1)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await workspace.cleanup()
    }
  },
  210_000
)
