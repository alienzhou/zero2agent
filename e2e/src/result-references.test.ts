import { it, expect } from 'vitest'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { runCli, makeTempWorkspace, REPO_ROOT } from './helpers/cli.js'
import { sendSSEReply } from './helpers/sse.js'
import { SessionStore } from '../../packages/tui/dist/session-store.js'

it.each(['read_file', 'terminal'] as const)(
  'E04-S002 %s: real CLI saves once, resumes in a new process, and rechecks permissions and body availability',
  async source => {
    const marker = `EVIDENCE-${randomUUID()}`
    const full = 'filler-'.repeat(45000) + marker
    const ws = await makeTempWorkspace({ 'large.txt': full })
    const workspace = await fs.realpath(ws.dir)
    const requests: Record<string, unknown>[] = []
    let reference = '',
      bytes = 0,
      mode = 'create'
    const server = createServer(async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      requests.push(body)
      const messages = body.messages as Array<{ role: string; content: unknown }>
      const last = messages.at(-1)!
      const result = Array.isArray(last.content)
        ? last.content.find(b => b.type === 'tool_result')
        : undefined
      if (!result) {
        if (mode === 'create')
          sendSSEReply(
            res,
            [
              {
                type: 'tool_use',
                id: 'source-once',
                name: source,
                input:
                  source === 'read_file' ? { path: 'large.txt' } : { command: 'cat large.txt' },
              },
            ],
            'tool_use'
          )
        else
          sendSSEReply(
            res,
            [
              {
                type: 'tool_use',
                id: `recall-${mode}`,
                name: 'read_tool_result',
                input: { reference, offset: bytes - Buffer.byteLength(marker), limit: 4096 },
              },
            ],
            'tool_use'
          )
      } else if (result.tool_use_id === 'source-once') {
        const text = String(result.content)
        const receipt = JSON.parse(text.slice(text.indexOf('{"kind":"tool_result_reference"')))
        reference = receipt.reference
        bytes = receipt.bytes
        sendSSEReply(
          res,
          [
            {
              type: 'tool_use',
              id: 'read-tail',
              name: 'read_tool_result',
              input: { reference, offset: bytes - Buffer.byteLength(marker), limit: 4096 },
            },
          ],
          'tool_use'
        )
      } else {
        sendSSEReply(res, [
          {
            type: 'text',
            text: result.is_error
              ? String(result.content)
              : JSON.parse(result.content).untrusted_text,
          },
        ])
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No provider port')
    const env = {
      ANTHROPIC_API_KEY: 'test-placeholder',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      ANTHROPIC_MODEL: 'contract-model',
      ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      CONTEXT_COUNTING: 'conservative',
      PERMISSION_MODE: 'bypass',
      PERMISSION_RULES: '[]',
      ZERO2AGENT_SESSION_DIR: path.join(workspace, 'sessions'),
      ZERO2AGENT_RESULT_DIR: path.join(workspace, 'results'),
      ZERO2AGENT_LOG_DIR: path.join(workspace, 'logs'),
      ZERO2AGENT_CHECKPOINT_DIR: path.join(workspace, 'checkpoints'),
    }
    try {
      const created = await runCli({ cwd: workspace, env, args: ['inspect the tail'] })
      expect(created.code).toBe(0)
      expect(created.output).toContain(marker)
      const sessions = await SessionStore.open(workspace, env.ZERO2AGENT_SESSION_DIR)
      const [item] = await sessions.list()
      const saved = await sessions.load(item.id)
      expect(saved.state.results!.entries).toHaveLength(1)
      expect(saved.state.results!.entries[0].source).toMatchObject({
        toolName: source,
        toolCallId: 'source-once',
      })
      expect(JSON.stringify(saved.state)).not.toContain('filler-'.repeat(10))
      const entry = saved.state.results!.entries[0]
      const location = path.join(
        env.ZERO2AGENT_RESULT_DIR,
        createHash('sha256').update(workspace).digest('hex'),
        saved.state.results!.scope
      )
      const bodyPath = path.join(location, `${entry.sha256}.body`)
      const initialBody = await fs.readFile(bodyPath)
      expect(createHash('sha256').update(initialBody).digest('hex')).toBe(entry.sha256)
      expect((await fs.readdir(location)).filter(name => name.endsWith('.body'))).toHaveLength(1)
      mode = 'resume'
      const resumed = await runCli({
        cwd: workspace,
        env: { ...env, PERMISSION_MODE: 'read-only' },
        args: ['--resume', item.id, 'read saved evidence again'],
      })
      expect(resumed.code).toBe(0)
      expect(resumed.output).toContain(marker)
      expect(await fs.readFile(bodyPath)).toEqual(initialBody)
      mode = 'deny'
      const denied = await runCli({
        cwd: workspace,
        env: { ...env, PERMISSION_RULES: '[{"tool":"read_tool_result","action":"deny"}]' },
        args: ['--resume', item.id, 'read with current denial'],
      })
      expect(denied.output).toContain('Permission denied')
      const deniedRequest = requests.at(-1)!
      expect(JSON.stringify((deniedRequest.messages as unknown[]).at(-1))).not.toContain(marker)
      await fs.rm(bodyPath)
      mode = 'missing'
      const missing = await runCli({
        cwd: workspace,
        env,
        args: ['--resume', item.id, 'check cleaned output'],
      })
      expect(missing.output).toContain('RESULT_MISSING')
      expect(missing.output).toContain('not be replayed')
      expect(requests.every(request => Buffer.byteLength(JSON.stringify(request)) < 30000)).toBe(
        true
      )
      expect(requests).toHaveLength(9)
      const final = await sessions.load(item.id)
      const sourceCalls = final.state.messages.flatMap(message =>
        Array.isArray(message.content)
          ? message.content.filter(block => block.type === 'tool_use' && block.name === source)
          : []
      )
      expect(sourceCalls).toHaveLength(1)
      if (process.env.E2E_EVIDENCE_DIR) {
        await fs.mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
        const hashes = Object.fromEntries(
          await Promise.all(
            [
              'packages/core/src/result-store.ts',
              'packages/core/src/loop.ts',
              'packages/core/src/tools/terminal.ts',
              'packages/core/src/session-snapshot.ts',
            ].map(async file => [
              file,
              createHash('sha256')
                .update(await fs.readFile(path.join(REPO_ROOT, file)))
                .digest('hex'),
            ])
          )
        )
        await fs.writeFile(
          path.join(process.env.E2E_EVIDENCE_DIR, `${source}-restart.json.gz`),
          gzipSync(
            JSON.stringify(
              {
                capturedAt: new Date().toISOString(),
                node: process.version,
                platform: process.platform,
                sourceHashes: hashes,
                source,
                marker,
                sourceCalls: sourceCalls.length,
                requests,
                cli: { created, resumed, denied, missing },
                body: { bytes: entry.bytes, sha256: entry.sha256 },
              },
              null,
              2
            )
          )
        )
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await ws.cleanup()
    }
  }
)
