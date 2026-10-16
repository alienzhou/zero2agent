import { createServer, type ServerResponse } from 'node:http'
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  symlink,
  mkdir,
  rename,
  realpath,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import { ResultStore } from '../result-store.js'
import { readToolResultTool } from '../tools/read-tool-result.js'
import { TurnCancelledError } from '../runtime.js'
import { type DiagnosticEvent } from '../diagnostics.js'
import {
  type ArtifactContract,
  ArtifactIssues,
  checkArtifactValue,
  formatArtifactTask,
  validateArtifactContract,
} from '../artifact-contract.js'
import { allTools } from '../tools/index.js'
import { type Tool } from '../tools/types.js'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function provider(
  handle: (body: Record<string, unknown>, res: ServerResponse, index: number, url: string) => void
) {
  const requests: Array<Record<string, unknown>> = []
  const urls: string[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
    requests.push(body)
    urls.push(req.url ?? '')
    handle(body, res, requests.length, req.url ?? '')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close(error => (error ? reject(error) : resolve()))
      })
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  return {
    config: { apiKey: 'test-placeholder', baseURL: `http://127.0.0.1:${address.port}` },
    requests,
    urls,
  }
}
function sse(
  res: ServerResponse,
  blocks: Array<Record<string, unknown>>,
  stop = 'end_turn',
  complete = true
) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, fields: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`)
  event('message_start', {
    message: {
      id: 'fixture',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-20250514',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 0 },
    },
  })
  blocks.forEach((block, index) => {
    event('content_block_start', {
      index,
      content_block:
        block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' },
    })
    event('content_block_delta', {
      index,
      delta:
        block.type === 'tool_use'
          ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
          : { type: 'text_delta', text: block.text },
    })
    event('content_block_stop', { index })
  })
  event('message_delta', {
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  if (complete) event('message_stop', {})
  res.end()
}
const answer = (res: ServerResponse, text = 'completed') => sse(res, [{ type: 'text', text }])

const contract = (): ArtifactContract => ({
  version: 1,
  artifacts: [
    {
      path: 'artifact.json',
      format: 'json',
      schema: {
        kind: 'object',
        allowAdditional: false,
        fields: {
          build: { kind: 'value', type: 'number' },
          stage: { kind: 'value', choices: ['queued', 'finished', 'unknown'] },
        },
      },
    },
  ],
})
const valid = '{"build":19,"stage":"finished"}'
const write = (id = 'write', content = valid) => ({
  type: 'tool_use',
  id,
  name: 'write_file',
  input: { path: 'artifact.json', content },
})
const tools = allTools.filter(t => ['write_file', 'read_file'].includes(t.name))
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'z2a-artifact-test-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}
const limits = { retryBaseMs: 1, requestTimeoutMs: 2000 }

describe('explicit one-turn artifact contracts', () => {
  it('matches all golden paired inputs without deriving rules from prompt text', async () => {
    const inputs = JSON.parse(
      await readFile(
        new URL(
          '../../../../researches/summary-quality/evaluation/contract-pair-v1/inputs.json',
          import.meta.url
        ),
        'utf8'
      )
    )
    for (const input of inputs)
      expect(formatArtifactTask(input.originalTask, input.contract)).toBe(input.task)
  })
  it('rejects malformed, accessor, circular, traversal and oversized declarations before any request', async () => {
    const p = await provider((_body, res) => answer(res))
    const agent = new Agent({ config: p.config, tools: [], limits })
    for (const path of ['../x', '/x', 'a/../x', 'a//x', 'a/./x', 'a\\x', 'C:x', '', 'x\n']) {
      const c = contract()
      c.artifacts[0].path = path
      await expect(agent.runWithContract('task', c)).rejects.toThrow('Invalid or unbounded')
    }
    const getter = {
      get version() {
        throw new Error('getter executed')
      },
      artifacts: [],
    }
    expect(() => validateArtifactContract(getter)).toThrow('Invalid or unbounded')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => validateArtifactContract(cyclic)).toThrow('Invalid or unbounded')
    const c = contract()
    c.artifacts[0].schema = { kind: 'value', choices: ['x'.repeat(17000)] }
    expect(() => validateArtifactContract(c)).toThrow('Invalid or unbounded')
    expect(p.requests).toHaveLength(0)
    expect(agent.getHistory()).toHaveLength(0)
  })
  it('keeps feedback bounded and omits unexpected names and artifact values; structure does not certify truth', () => {
    const rule = {
      kind: 'object' as const,
      allowAdditional: false,
      fields: Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          String(i) + '长'.repeat(80),
          { kind: 'value' as const },
        ])
      ),
    }
    const issues = new ArtifactIssues()
    checkArtifactValue({ 'secret-unexpected-name': 'secret-value' }, rule, 0, issues, '/parent')
    expect(issues.count).toBe(101)
    expect(Buffer.byteLength(issues.feedback())).toBeLessThanOrEqual(4096)
    expect(issues.feedback()).not.toMatch(/secret-/)
    expect(issues.feedback()).toContain('omitted')
    const clean = new ArtifactIssues()
    checkArtifactValue({ build: -999, stage: 'finished' }, contract().artifacts[0].schema, 0, clean)
    expect(clean.count).toBe(0)
  })
  it.each(['missing', 'invalid-json', 'wrong-keys'])(
    'repairs %s once using the same task, then reads the real file',
    async initial => {
      const cwd = await workspace()
      if (initial !== 'missing')
        await writeFile(
          join(cwd, 'artifact.json'),
          initial === 'invalid-json'
            ? '{oops'
            : '{"build":"nineteen","stage":"done","secret-key":"private"}'
        )
      const p = await provider((_body, res, index) =>
        index === 2
          ? sse(res, [write()], 'tool_use')
          : answer(res, index === 1 ? 'claimed done' : 'fixed')
      )
      const records: DiagnosticEvent[] = []
      const agent = new Agent({
        cwd,
        tools,
        config: p.config,
        limits,
        permissions: { mode: 'accept-edits' },
        diagnostics: e => records.push(e),
      })
      expect(await agent.runWithContract('Create the build artifact.', contract())).toBe('fixed')
      expect(await readFile(join(cwd, 'artifact.json'), 'utf8')).toBe(valid)
      expect(p.requests).toHaveLength(3)
      expect(JSON.stringify(p.requests[1])).toContain('Harness artifact validation')
      expect(JSON.stringify(p.requests[1])).toContain('Create the build artifact.')
      expect(JSON.stringify(p.requests[1])).not.toContain('secret-key')
      expect(JSON.stringify(agent.snapshot())).not.toContain('Harness artifact validation')
      expect(JSON.stringify(agent.snapshot())).toContain('claimed done')
      expect(records.filter(e => e.kind === 'artifact-check').map(e => e.event)).toEqual([
        'started',
        'failed',
        'repair',
        'started',
        'passed',
      ])
      expect(JSON.stringify(records)).not.toMatch(
        /nineteen|secret-key|artifact.json|Create the build/
      )
      const restored = new Agent({ cwd, tools: [], config: p.config, limits })
      restored.restore(agent.snapshot())
      await rm(join(cwd, 'artifact.json'))
      expect(await restored.run('Next ordinary task')).toBe('fixed')
      expect(p.requests).toHaveLength(4)
      expect(JSON.stringify(p.requests[3])).not.toContain('Harness artifact validation')
    }
  )
  it('preserves explicit field meanings as bounded input without pretending to validate semantics', () => {
    const c = contract()
    if (c.artifacts[0].schema.kind !== 'object') throw new Error('test contract')
    c.artifacts[0].schema.fields.build.description =
      'Identifier of the build, distinct from its exit status.'
    const frozen = validateArtifactContract(c)
    expect(formatArtifactTask('Write the observed build.', c)).toContain(
      'Identifier of the build, distinct from its exit status.'
    )
    const issues = new ArtifactIssues()
    checkArtifactValue({ build: 1, stage: 'finished' }, frozen.artifacts[0].schema, 0, issues)
    expect(issues.count).toBe(0)
    c.artifacts[0].schema.fields.build.description = 'long'.repeat(257)
    expect(() => validateArtifactContract(c)).toThrow()
  })
  it('checks every declared file and charges a separate read to the tool budget', async () => {
    const cwd = await workspace()
    await writeFile(join(cwd, 'artifact.json'), valid)
    await writeFile(join(cwd, 'second.json'), valid)
    const p = await provider((_body, res) => answer(res))
    const c = contract()
    c.artifacts.push({ ...c.artifacts[0], path: 'second.json' })
    const limited = new Agent({
      cwd,
      tools: [],
      config: p.config,
      limits: { ...limits, maxToolCalls: 1 },
    })
    await expect(limited.runWithContract('Inspect both files', c)).rejects.toMatchObject({
      name: 'RunBudgetError',
      limitReason: 'tools',
    })
    const allowed = new Agent({
      cwd,
      tools: [],
      config: p.config,
      limits: { ...limits, maxToolCalls: 2 },
    })
    expect(await allowed.runWithContract('Inspect both files', c)).toBe('completed')
    const denied = new Agent({
      cwd,
      tools: [],
      config: p.config,
      limits,
      permissions: {
        rules: [{ tool: 'read_file', input: { path: 'second.json' }, action: 'deny' }],
      },
    })
    await expect(denied.runWithContract('Inspect both files', c)).rejects.toMatchObject({
      reason: 'permission',
    })
    expect(p.requests).toHaveLength(3)
  })
  it('bounds declarations and escapes own property names without accepting inherited fields', () => {
    const duplicate = contract()
    duplicate.artifacts.push(duplicate.artifacts[0])
    expect(() => validateArtifactContract(duplicate)).toThrow()
    expect(() => validateArtifactContract({ version: 1, artifacts: [] })).toThrow()
    const many = contract()
    many.artifacts = Array.from({ length: 5 }, (_, n) => ({
      ...many.artifacts[0],
      path: n + '.json',
    }))
    expect(() => validateArtifactContract(many)).toThrow()
    const nested = contract()
    let rule = nested.artifacts[0].schema
    for (let i = 0; i < 13; i++)
      rule = { kind: 'object', allowAdditional: false, fields: { nested: rule } }
    nested.artifacts[0].schema = rule
    expect(() => validateArtifactContract(nested)).toThrow()
    const special = JSON.parse(
      '{"version":1,"artifacts":[{"path":"artifact.json","format":"json","schema":{"kind":"object","allowAdditional":true,"fields":{"__proto__":{"kind":"value"},"a/b~c":{"kind":"value"}}}}]}'
    )
    const frozen = validateArtifactContract(special)
    const issues = new ArtifactIssues()
    checkArtifactValue({}, frozen.artifacts[0].schema, 0, issues)
    expect(issues.count).toBe(2)
    expect(issues.feedback()).toContain('/a~1b~0c')
    expect(issues.feedback()).toContain('/__proto__')
  })
  it('does not add a model request or rewrite an already conforming file', async () => {
    const cwd = await workspace()
    await writeFile(join(cwd, 'artifact.json'), valid)
    const p = await provider((_body, res) => answer(res))
    const agent = new Agent({ cwd, tools: [], config: p.config, limits })
    expect(await agent.runWithContract('Inspect existing artifact', contract())).toBe('completed')
    expect(p.requests).toHaveLength(1)
    expect(await readFile(join(cwd, 'artifact.json'), 'utf8')).toBe(valid)
  })
  it('stops after one repair stage; ordinary next turn inherits neither contract nor repair state', async () => {
    const cwd = await workspace()
    const p = await provider((_body, res) => answer(res, 'still absent'))
    const agent = new Agent({ cwd, tools: [], config: p.config, limits })
    await expect(agent.runWithContract('Create artifact', contract())).rejects.toMatchObject({
      reason: 'invalid-artifact',
    })
    expect(p.requests).toHaveLength(2)
    expect(await agent.run('New task')).toBe('still absent')
    expect(p.requests).toHaveLength(3)
  })
  it.each(['requests', 'tools', 'iterations'])(
    'charges completion and repair to the existing %s limit',
    async limit => {
      const cwd = await workspace()
      const p = await provider((_body, res) => answer(res))
      const agent = new Agent({
        cwd,
        tools: [],
        config: p.config,
        limits: {
          ...limits,
          ...(limit === 'requests'
            ? { maxRequests: 1 }
            : limit === 'tools'
              ? { maxToolCalls: 1 }
              : { maxIterations: 1 }),
        },
      })
      await expect(agent.runWithContract('Create artifact', contract())).rejects.toMatchObject({
        name: 'RunBudgetError',
        limitReason: limit,
      })
      expect(p.requests.length).toBe(limit === 'tools' ? 2 : 1)
    }
  )
  it('honors current read denial and never starts repair', async () => {
    const cwd = await workspace()
    await writeFile(join(cwd, 'artifact.json'), valid)
    const p = await provider((_body, res) => answer(res))
    const agent = new Agent({
      cwd,
      tools: [],
      config: p.config,
      limits,
      permissions: { mode: 'bypass', rules: [{ tool: 'read_file', action: 'deny' }] },
    })
    await expect(agent.runWithContract('Inspect artifact', contract())).rejects.toMatchObject({
      reason: 'permission',
    })
    expect(p.requests).toHaveLength(1)
  })
  it('waits for current approval, freezes caller input, and cancellation prevents reads/repair', async () => {
    const cwd = await workspace()
    const p = await provider((_body, res) => answer(res))
    let started!: () => void
    const pending = new Promise<void>(resolve => {
      started = resolve
    })
    const c = contract()
    const agent = new Agent({
      cwd,
      tools: [],
      config: p.config,
      limits,
      permissions: {
        rules: [{ tool: 'read_file', action: 'ask' }],
        requestApproval: async request => {
          started()
          await new Promise(resolve =>
            request.signal.addEventListener('abort', resolve, { once: true })
          )
          return { requestId: request.id, decision: 'allow' }
        },
      },
    })
    const running = agent.runWithContract('Create artifact', c)
    c.artifacts[0].path = 'mutated.json'
    await pending
    expect(agent.cancelTurn()).toBe(true)
    await expect(running).rejects.toMatchObject({ name: 'TurnCancelledError' })
    expect(JSON.stringify(p.requests)).not.toContain('mutated.json')
    expect(p.requests).toHaveLength(1)
  })
  it.each([
    'deny',
    'write-error',
    'unknown-error',
    'native-decline',
    'native-cancelled',
    'read-cancelled',
  ])(
    'does not start completion repair after %s, retaining paired results and effects',
    async mode => {
      const cwd = await workspace()
      let executions = 0
      const p = await provider((_body, res, index) =>
        index === 1
          ? sse(res, [{ type: 'tool_use', id: 'effect', name: 'effect', input: {} }], 'tool_use')
          : answer(res)
      )
      const effect: Tool = {
        name: 'effect',
        description: '',
        input_schema: { type: 'object', properties: {} },
        ...(mode !== 'unknown-error' && {
          permission: {
            effect:
              mode.startsWith('native-') || mode === 'read-cancelled'
                ? ('read' as const)
                : ('write' as const),
          },
        }),
        execute: async (_input, ctx) => {
          executions++
          await writeFile(join(cwd, 'settled.txt'), 'effect retained')
          if (mode === 'read-cancelled') throw new TurnCancelledError()
          if (mode.startsWith('native-')) {
            ctx.onResultMetadata?.({
              terminalOutcome: mode === 'native-decline' ? 'declined' : 'cancelled',
            })
            return 'declined'
          }
          throw new Error('failed after effect')
        },
      }
      const agent = new Agent({
        cwd,
        tools: [effect],
        config: p.config,
        limits,
        permissions: {
          mode: 'bypass',
          rules: mode === 'deny' ? [{ tool: 'effect', action: 'deny' }] : [],
        },
      })
      await expect(agent.runWithContract('Create artifact', contract())).rejects.toMatchObject({
        reason: 'unsafe-effects',
      })
      expect(executions).toBe(mode === 'deny' ? 0 : 1)
      expect(p.requests).toHaveLength(2)
      expect(JSON.stringify(agent.getHistory())).toContain('tool_result')
      if (executions)
        expect(await readFile(join(cwd, 'settled.txt'), 'utf8')).toBe('effect retained')
    }
  )
  it.each(['max_tokens', 'refusal', 'stop_sequence'])(
    'does not repair an incomplete %s response',
    async stop => {
      const cwd = await workspace()
      const p = await provider((_body, res) =>
        sse(res, [{ type: 'text', text: 'unfinished' }], stop)
      )
      const agent = new Agent({ cwd, tools: [], config: p.config, limits })
      await expect(agent.runWithContract('Create artifact', contract())).rejects.toMatchObject({
        reason: 'incomplete-response',
      })
      expect(p.requests).toHaveLength(1)
    }
  )
  it.each(['outside-link', 'inside-link', 'directory', 'oversized', 'fifo', 'utf8'])(
    'rejects unsafe or unreadable %s without a repair request',
    async kind => {
      const cwd = await workspace()
      const outside = await workspace()
      const artifact = join(cwd, 'artifact.json')
      if (kind === 'outside-link' || kind === 'inside-link') {
        const target = join(kind === 'outside-link' ? outside : cwd, 'target')
        await writeFile(target, valid)
        await symlink(target, artifact)
      } else if (kind === 'directory') await mkdir(artifact)
      else if (kind === 'fifo') execFileSync('mkfifo', [artifact])
      else await writeFile(artifact, kind === 'oversized' ? 'x'.repeat(65537) : Buffer.from([0xff]))
      const p = await provider((_body, res) => answer(res))
      const agent = new Agent({
        cwd,
        tools: [],
        config: p.config,
        limits,
        permissions: { mode: 'bypass' },
      })
      await expect(agent.runWithContract('Inspect artifact', contract())).rejects.toMatchObject({
        name: 'ArtifactCompletionError',
      })
      expect(p.requests).toHaveLength(1)
    }
  )
  it('rechecks parent links after approval instead of reading outside the workspace', async () => {
    const cwd = await workspace()
    const outside = await workspace()
    await mkdir(join(cwd, 'output'))
    await writeFile(join(outside, 'artifact.json'), valid)
    const p = await provider((_body, res) => answer(res))
    const c = contract()
    c.artifacts[0].path = 'output/artifact.json'
    const agent = new Agent({
      cwd,
      tools: [],
      config: p.config,
      limits,
      permissions: {
        rules: [{ tool: 'read_file', action: 'ask' }],
        requestApproval: async request => {
          await rename(join(cwd, 'output'), join(cwd, 'previous'))
          await symlink(outside, join(cwd, 'output'))
          return { requestId: request.id, decision: 'allow' }
        },
      },
    })
    await expect(agent.runWithContract('Inspect artifact', c)).rejects.toMatchObject({
      reason: 'unsafe-path',
    })
    expect(p.requests).toHaveLength(1)
  })
})

async function savedEvidence() {
  const cwd = await realpath(await workspace())
  const directory = join(cwd, 'results')
  const store = new ResultStore({ directory })
  store.setWorkspace(cwd)
  const entry = await store.save('filler '.repeat(800) + '\nbuild=19; stage=finished', {
    toolName: 'terminal',
    toolCallId: 'historical-build',
    paths: [cwd],
  })
  const read = (id: string, input: Record<string, unknown> = { tail: true }) => ({
    type: 'tool_use',
    id,
    name: 'read_tool_result',
    input: { reference: entry.reference, ...input },
  })
  const restore = (agent: Agent) =>
    agent.restore({ messages: [], context: { through: 0, summary: '' }, results: store.snapshot() })
  return { cwd, directory, store, entry, read, restore }
}

describe('unresolved saved-evidence reads', () => {
  it('corrects an ignored input error before accepting a structurally valid artifact, with current permissions and no replay', async () => {
    const f = await savedEvidence()
    await writeFile(join(f.cwd, 'artifact.json'), '{"build":0,"stage":"unknown"}')
    const p = await provider((_body, res, index) => {
      if (index === 1) sse(res, [f.read('bad', { tail: true, offset: f.entry.bytes })], 'tool_use')
      else if (index === 3) sse(res, [f.read('correct')], 'tool_use')
      else if (index === 4) sse(res, [write()], 'tool_use')
      else answer(res)
    })
    const diagnostics: DiagnosticEvent[] = []
    const agent = new Agent({
      cwd: f.cwd,
      results: { directory: f.directory },
      config: p.config,
      tools,
      limits,
      permissions: { mode: 'accept-edits' },
      diagnostics: e => diagnostics.push(e),
    })
    f.restore(agent)
    await expect(
      agent.runWithContract('Recover build evidence and write artifact.json.', contract())
    ).resolves.toBe('completed')
    expect(diagnostics.filter(e => e.kind === 'evidence-read').map(e => e.event)).toEqual([
      'invalid-input',
      'correcting',
      'resolved',
    ])
    expect(p.requests).toHaveLength(5)
    expect(JSON.stringify(p.requests[2])).toContain('One correction stage')
    expect(JSON.stringify(p.requests[3])).not.toContain('One correction stage')
    expect(JSON.stringify(agent.snapshot())).not.toContain('One correction stage')
    expect(await readFile(join(f.cwd, 'artifact.json'), 'utf8')).toBe(valid)
    expect(
      diagnostics.filter(
        e => e.kind === 'permission' && e.event === 'initial' && e.toolName === 'read_tool_result'
      )
    ).toHaveLength(2)
    expect(
      diagnostics.filter(e => e.kind === 'artifact-check' && e.event === 'started')
    ).toHaveLength(1)
    const history = JSON.stringify(agent.getHistory())
    expect(history).toContain('INVALID_RESULT_RANGE')
    expect(history).toContain('build=19; stage=finished')
    expect(
      diagnostics.filter(
        e => e.kind === 'permission' && e.event === 'initial' && e.toolName === 'terminal'
      )
    ).toHaveLength(0)
  })
  it('works without artifact contracts and never inherits a pending correction in a new turn or restored session', async () => {
    const f = await savedEvidence()
    const p = await provider((_body, res, index) =>
      index === 1 ? sse(res, [f.read('bad', { tail: true, offset: 0 })], 'tool_use') : answer(res)
    )
    const agent = new Agent({
      cwd: f.cwd,
      results: { directory: f.directory },
      config: p.config,
      tools: [],
      limits,
    })
    f.restore(agent)
    await expect(agent.run('Read saved evidence')).rejects.toMatchObject({
      name: 'EvidenceReadIncompleteError',
    })
    expect(p.requests).toHaveLength(3)
    const restored = new Agent({
      cwd: f.cwd,
      results: { directory: f.directory },
      config: p.config,
      tools: [],
      limits,
    })
    restored.restore(agent.snapshot())
    await expect(agent.run('Unrelated next task')).resolves.toBe('completed')
    await expect(restored.run('Unrelated restored task')).resolves.toBe('completed')
    expect(p.requests).toHaveLength(5)
    expect(JSON.stringify(p.requests.slice(3))).not.toContain('One correction stage')
  })
  it.each(['requests', 'iterations', 'tools'] as const)(
    'uses the original %s budget for corrective reading',
    async limit => {
      const f = await savedEvidence()
      const p = await provider((_body, res, index) =>
        index === 1
          ? sse(res, [f.read('bad', { tail: true, offset: 0 })], 'tool_use')
          : index === 3
            ? sse(res, [f.read('correct')], 'tool_use')
            : answer(res)
      )
      const agent = new Agent({
        cwd: f.cwd,
        results: { directory: f.directory },
        config: p.config,
        tools: [],
        limits: {
          ...limits,
          ...(limit === 'requests'
            ? { maxRequests: 2 }
            : limit === 'iterations'
              ? { maxIterations: 2 }
              : { maxToolCalls: 1 }),
        },
      })
      f.restore(agent)
      await expect(agent.run('Read saved evidence')).rejects.toMatchObject({
        name: 'RunBudgetError',
        limitReason: limit,
      })
      expect(p.requests).toHaveLength(limit === 'tools' ? 3 : 2)
    }
  )
  it.each(['other-reference', 'empty-eof', 'model-prose'] as const)(
    'does not clear pending reads from %s',
    async kind => {
      const f = await savedEvidence()
      const other = await f.store.save('other evidence', {
        toolName: 'read_file',
        toolCallId: 'other',
        paths: [f.cwd],
      })
      const p = await provider((_body, res, index) => {
        if (index === 1) sse(res, [f.read('bad', { tail: true, offset: 0 })], 'tool_use')
        else if (index === 3 && kind !== 'model-prose')
          sse(
            res,
            [
              f.read(
                'different',
                kind === 'other-reference'
                  ? { reference: other.reference, tail: true }
                  : { offset: f.entry.bytes }
              ),
            ],
            'tool_use'
          )
        else answer(res, 'The evidence read succeeded. Task done.')
      })
      const agent = new Agent({
        cwd: f.cwd,
        results: { directory: f.directory },
        config: p.config,
        tools: [],
        limits,
      })
      f.restore(agent)
      await expect(agent.run('Read saved evidence')).rejects.toMatchObject({
        name: 'EvidenceReadIncompleteError',
      })
      expect(p.requests).toHaveLength(kind === 'model-prose' ? 3 : 4)
    }
  )
  it('does not retry denied reads, and denial after an input error blocks correction', async () => {
    const f = await savedEvidence()
    let approvals = 0
    const p = await provider((_body, res, index) =>
      index === 1
        ? sse(res, [f.read('bad', { tail: true, offset: 0 }), f.read('denied')], 'tool_use')
        : answer(res)
    )
    const agent = new Agent({
      cwd: f.cwd,
      results: { directory: f.directory },
      config: p.config,
      tools: [],
      limits,
      permissions: {
        rules: [{ tool: 'read_tool_result', action: 'ask' }],
        requestApproval: async request => ({
          requestId: request.id,
          decision: ++approvals === 1 ? 'allow' : 'deny',
        }),
      },
    })
    f.restore(agent)
    await expect(agent.run('Read saved evidence')).rejects.toMatchObject({
      name: 'EvidenceReadIncompleteError',
    })
    expect(approvals).toBe(2)
    expect(p.requests).toHaveLength(2)
    expect(JSON.stringify(p.requests)).not.toContain('One correction stage')
  })
  it('cancellation during correction stops before another request or read', async () => {
    const f = await savedEvidence()
    let pending!: () => void
    const started = new Promise<void>(resolve => {
      pending = resolve
    })
    const p = await provider((_body, res, index) => {
      if (index === 1) sse(res, [f.read('bad', { tail: true, offset: 0 })], 'tool_use')
      else if (index === 2) answer(res)
      else pending()
    })
    const agent = new Agent({
      cwd: f.cwd,
      results: { directory: f.directory },
      config: p.config,
      tools: [],
      limits,
    })
    f.restore(agent)
    const running = agent.run('Read saved evidence')
    const outcome = expect(running).rejects.toMatchObject({ name: 'TurnCancelledError' })
    await started
    agent.cancelTurn()
    await outcome
    expect(p.requests).toHaveLength(3)
  })
  it('does not reclassify missing or expired bodies as argument errors', async () => {
    const f = await savedEvidence()
    await expect(
      readToolResultTool.execute(
        { reference: f.entry.reference, offset: -1 },
        { cwd: f.cwd, results: f.store }
      )
    ).rejects.toMatchObject({ name: 'ResultReadInputError' })
    await rm(f.directory, { recursive: true, force: true })
    await expect(
      readToolResultTool.execute(
        { reference: f.entry.reference, tail: true },
        { cwd: f.cwd, results: f.store }
      )
    ).rejects.not.toMatchObject({ name: 'ResultReadInputError' })
  })
})
