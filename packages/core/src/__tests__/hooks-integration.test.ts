import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import type Anthropic from '@anthropic-ai/sdk'
import { Agent } from '../agent.js'
import { Hooks, type HookConfig, type HookStage } from '../hooks.js'
import { createAnthropicClient } from '../llm/index.js'
import { messageStream } from './helpers/message-stream.js'
import { writeFileTool } from '../tools/write-file.js'
import { validateSessionSnapshot } from '../session-snapshot.js'
import type { ContextRequest } from '../context-budget.js'
vi.mock('../llm/index.js', () => ({
  createAnthropicClient: vi.fn(),
  getModelName: () => 'claude-sonnet-4-20250514',
}))
const fixture = path.resolve(import.meta.dirname, '../../../../researches/hooks/check.mjs')
let root: string
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'z2a-hook-loop-')))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})
const write = (id: string, file: string): Anthropic.ToolUseBlock => ({
  type: 'tool_use',
  id,
  name: 'write_file',
  input: { path: file, content: 'actual content' },
})
const reply = (...content: Anthropic.ToolUseBlock[]) =>
  ({ content, stop_reason: 'tool_use' }) as Anthropic.Message
const answer = () =>
  ({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }) as Anthropic.Message
function provider(...responses: Anthropic.Message[]) {
  const requests: ContextRequest[] = []
  const stream = vi.fn((r: ContextRequest) => {
    requests.push(structuredClone(r))
    return messageStream(async () => {
      const next = responses.shift()
      if (!next) throw new Error('Unexpected model request')
      return next
    })
  })
  vi.mocked(createAnthropicClient).mockReturnValue({
    messages: { stream, create: vi.fn(async () => answer()) },
  } as unknown as Anthropic)
  return { requests, stream }
}
async function options(stage: HookStage, mode = 'pass') {
  const config: HookConfig = {
    version: 1,
    hooks: [
      {
        id: 'gate',
        stage,
        command: process.execPath,
        args: [fixture, mode],
        sources: [fixture],
        env: { HOOK_AUDIT: path.join(root, 'audit') },
      },
    ],
  }
  const view = await new Hooks(root, { config }).inspect()
  return {
    cwd: root,
    skills: false as const,
    projectInstructions: false as const,
    tools: [writeFileTool],
    results: { directory: path.join(root, 'results') },
    permissions: { mode: 'accept-edits' as const },
    hooks: { config, trust: view.map(v => `${v.id}:${v.identity}`) },
  }
}
async function audit() {
  return (await fs.readFile(path.join(root, 'audit'), 'utf8'))
    .trim()
    .split('\n')
    .map(l => JSON.parse(l))
}
const receipts = (a: Agent) =>
  a
    .getHistory()
    .flatMap(m => (Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []))
describe('Hooks in the actual loop and recovery control', () => {
  it('keeps disabled requests and legacy recovery unchanged', async () => {
    const p = provider(answer())
    const a = new Agent({
      cwd: root,
      skills: false,
      projectInstructions: false,
      hooks: false,
      systemPrompt: 'original',
    })
    await a.run('task')
    expect(p.requests[0].system).toBe('original')
    expect(p.requests[0].messages).toEqual([{ role: 'user', content: 'task' }])
    expect(a.snapshot().recovery).toBeUndefined()
    await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
  })
  it('runs beforeTool after authorization, then checkpoint, then the actual write', async () => {
    const o = await options('beforeTool')
    provider(reply(write('w', 'out')), answer())
    const checkpoint = vi.fn(async (_r, execute) => {
      expect((await audit())[0].stage).toBe('beforeTool')
      await expect(fs.stat(path.join(root, 'out'))).rejects.toThrow()
      return execute()
    })
    const a = new Agent({ ...o, fileMutations: checkpoint })
    await a.run('write')
    expect(checkpoint).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(path.join(root, 'out'), 'utf8')).toBe('actual content')
  })
  it('never invokes a Hook for a host-denied operation, and never widens read-only mode', async () => {
    const o = await options('beforeTool')
    const p = provider(reply(write('w', 'out')), answer())
    const a = new Agent({
      ...o,
      permissions: { mode: 'read-only', rules: [{ tool: 'write_file', action: 'allow' }] },
    })
    await a.run('write')
    expect(p.requests).toHaveLength(2)
    expect(receipts(a)[0].content).toContain('Permission denied')
    await expect(fs.stat(path.join(root, 'out'))).rejects.toThrow()
    await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
  })
  it('blocks before execution and pairs every unstarted call', async () => {
    const o = await options('beforeTool', 'block')
    const events: unknown[] = []
    const p = provider(reply(write('w', 'out'), write('skip', 'never')))
    const a = new Agent({ ...o, events: { onEvent: e => events.push(e) } })
    await expect(a.run('write')).rejects.toThrow('not executed')
    expect(p.requests).toHaveLength(1)
    await expect(fs.stat(path.join(root, 'out'))).rejects.toThrow()
    expect(a.snapshot().recovery?.tools.map(t => t.state)).toEqual(['not-started', 'not-started'])
    expect(receipts(a)).toHaveLength(2)
    expect(
      events.some(
        (e: any) =>
          e.type === 'tool-state' &&
          e.toolCallId === 'skip' &&
          e.status === 'error' &&
          e.output.includes('not executed')
      )
    ).toBe(true)
  })
  it('keeps settled tool facts after a post-check failure; restore and continuation never replay pending checks', async () => {
    const o = await options('afterTool', 'toggle')
    const p = provider(reply(write('w', 'out'), write('skip', 'never')))
    const a = new Agent(o)
    await expect(a.run('write')).rejects.toThrow('already executed')
    expect(p.requests).toHaveLength(1)
    expect(await fs.readFile(path.join(root, 'out'), 'utf8')).toBe('actual content')
    await expect(fs.stat(path.join(root, 'never'))).rejects.toThrow()
    const saved = a.snapshot()
    expect(saved.recovery?.version).toBe(2)
    expect(saved.recovery?.tools.map(t => t.state)).toEqual(['settled', 'not-started'])
    expect(receipts(a)[0].is_error).toBeUndefined()
    expect(validateSessionSnapshot(saved)).toEqual(saved)
    const count = (await audit()).length
    const b = new Agent(o)
    b.restore(saved)
    expect((await audit()).length).toBe(count)
    provider(answer())
    await expect(
      b.continueInterrupted('Inspect effects and continue without another write')
    ).rejects.toThrow('explicit-recheck')
    expect((await audit()).length).toBe(count)
    await fs.writeFile(path.join(root, 'allow-check'), 'yes')
    await b.recheckHooks('File already contains expected content; run a new check, no old tool')
    provider(answer())
    await b.continueInterrupted('Complete using the checked existing file')
    expect(b.needsRecovery).toBe(false)
    expect((await audit()).filter(e => e.event === 'start')).toHaveLength(2)
    expect(await fs.readFile(path.join(root, 'out'), 'utf8')).toBe('actual content')
  })
  it('saves the real receipt before invoking afterTool and never starts a Hook if publication fails', async () => {
    const o = await options('afterTool')
    provider(reply(write('w', 'out')))
    const a = new Agent({
      ...o,
      executionPersistence: async (_s, b) => {
        if (b === 'tool-settled') throw new Error('fixed storage failure')
      },
    })
    await expect(a.run('write')).rejects.toThrow('could not be saved')
    expect(await fs.readFile(path.join(root, 'out'), 'utf8')).toBe('actual content')
    await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
    expect(receipts(a)[0].is_error).toBeUndefined()
    expect(a.snapshot().recovery?.hooks?.checks[0].state).toBe('not-started')
  })
  it('retains pending Hook intent when saving it fails, with zero command and tool effects', async () => {
    const o = await options('beforeTool')
    provider(reply(write('w', 'out')))
    const a = new Agent({
      ...o,
      executionPersistence: async (_s, b) => {
        if (b === 'hook-start') throw new Error('storage failure')
      },
    })
    await expect(a.run('write')).rejects.toThrow()
    await expect(fs.stat(path.join(root, 'out'))).rejects.toThrow()
    await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
    expect(a.needsRecovery).toBe(true)
    expect(a.snapshot().recovery?.hooks?.checks[0].state).toBe('not-started')
  })
  it('stops completion without automatically asking the model to repair a failed Hook', async () => {
    const o = await options('beforeComplete', 'block')
    const p = provider(answer())
    const a = new Agent(o)
    await expect(a.run('finish')).rejects.toThrow('incomplete')
    expect(p.requests).toHaveLength(1)
    expect(a.needsRecovery).toBe(true)
  })
  it('cannot use a passing Hook to bypass the existing artifact contract', async () => {
    const o = await options('beforeComplete')
    const p = provider(answer(), answer())
    const a = new Agent(o)
    await expect(
      a.runWithContract('write report', {
        version: 1,
        artifacts: [
          {
            path: 'report.json',
            format: 'json',
            schema: {
              kind: 'object',
              fields: { ok: { kind: 'value', type: 'boolean' } },
              allowAdditional: false,
            },
          },
        ],
      })
    ).rejects.toThrow()
    expect(p.requests).toHaveLength(2)
    expect(a.snapshot().recovery?.artifactContract?.artifacts[0].path).toBe('report.json')
  })
  it('rejects downgraded or forged Hook state before replacing the current session', async () => {
    const o = await options('beforeComplete', 'block')
    provider(answer())
    const a = new Agent(o)
    await expect(a.run('finish')).rejects.toThrow()
    const saved = a.snapshot()
    const bad = structuredClone(saved)
    bad.recovery!.version = 1
    expect(() => a.restore(bad)).toThrow()
    expect(a.snapshot()).toEqual(saved)
    const disabled = new Agent({ ...o, hooks: false })
    disabled.restore(saved)
    provider(answer())
    await expect(disabled.continueInterrupted('continue')).rejects.toThrow('current-trust-required')
    expect(disabled.snapshot().recovery?.hooks).toEqual(saved.recovery?.hooks)
  })
})

it('preserves array-valued trusted write paths at the pre-tool boundary', async () => {
  const o = await options('beforeTool')
  const file = path.join(root, 'readonly.json')
  const p = provider(
    reply({
      type: 'tool_use',
      id: 'many',
      name: 'write_many',
      input: { paths: ['readonly.json', 'ok.json'] },
    })
  )
  let effects = 0
  const a = new Agent({
    ...o,
    tools: [
      {
        name: 'write_many',
        description: 'trusted fixture',
        input_schema: {
          type: 'object',
          properties: { paths: { type: 'array', items: { type: 'string' } } },
        },
        permission: { effect: 'write', paths: ['paths'] },
        checkpointPaths: ['paths'],
        execute: async () => {
          effects++
          await fs.writeFile(file, 'must never write')
          return 'ok'
        },
      },
    ],
  })
  await expect(a.run('write declared paths')).rejects.toThrow('not executed')
  expect(effects).toBe(0)
  expect(p.requests).toHaveLength(1)
  await expect(fs.stat(file)).rejects.toThrow()
  expect((await audit())[0].input.tool.paths).toContain(file)
})
it('does not let the internal completion audit read a host-denied source', async () => {
  const o = await options('beforeComplete')
  o.hooks.config.watch = ['private.txt']
  await fs.writeFile(path.join(root, 'private.txt'), 'PRIVATE_BODY_SENTINEL')
  const views = await new Hooks(root, { config: o.hooks.config }).inspect()
  o.hooks.trust = views.map(v => `${v.id}:${v.identity}`)
  provider(answer())
  const a = new Agent({
    ...o,
    permissions: { mode: 'accept-edits', rules: [{ tool: 'read_file', action: 'deny' }] },
  })
  await expect(a.run('finish')).rejects.toThrow('unverifiable')
  await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
  expect(JSON.stringify(a.snapshot())).not.toContain('PRIVATE_BODY_SENTINEL')
})
it('keeps passing Hook output and private stderr out of model history and diagnostics', async () => {
  const script = path.join(root, 'private-check.mjs')
  await fs.writeFile(
    script,
    "process.stderr.write('PRIVATE_HOOK_SENTINEL');process.stdout.write(JSON.stringify({version:1,decision:'pass',reason:'PRIVATE_HOOK_SENTINEL'}))"
  )
  const config: HookConfig = {
    version: 1,
    hooks: [
      {
        id: 'private',
        stage: 'beforeComplete',
        command: process.execPath,
        args: [script],
        sources: [script],
      },
    ],
  }
  const views = await new Hooks(root, { config }).inspect()
  const p = provider(answer())
  const events: unknown[] = []
  const diagnostics: unknown[] = []
  const a = new Agent({
    cwd: root,
    skills: false,
    projectInstructions: false,
    hooks: { config, trust: views.map(v => `${v.id}:${v.identity}`) },
    events: { onEvent: e => events.push(e) },
    diagnostics: e => diagnostics.push(e),
  })
  await a.run('finish')
  expect(events.some((e: any) => e.type === 'hook-check' && e.status === 'passed')).toBe(true)
  expect(diagnostics.some((e: any) => e.kind === 'hook-check')).toBe(true)
  expect(JSON.stringify([p.requests, a.snapshot(), events, diagnostics])).not.toContain(
    'PRIVATE_HOOK_SENTINEL'
  )
})

it('does not execute completion Hooks while an evidence read is unresolved', async () => {
  provider(reply({ type: 'tool_use', id: 'large', name: 'large_read', input: {} }), answer())
  const seed = new Agent({
    cwd: root,
    results: { directory: path.join(root, 'results') },
    skills: false,
    projectInstructions: false,
    tools: [
      {
        name: 'large_read',
        description: 'fixture',
        permission: { effect: 'read' },
        input_schema: { type: 'object', properties: {} },
        execute: async () => 'x'.repeat(30000),
      },
    ],
  })
  await seed.run('read large body')
  const saved = seed.snapshot(),
    reference = saved.results!.entries[0].reference
  const o = await options('beforeComplete')
  const p = provider(
    reply({
      type: 'tool_use',
      id: 'bad',
      name: 'read_tool_result',
      input: { reference, offset: 0, tail: true },
    }),
    answer(),
    answer()
  )
  const a = new Agent(o)
  a.restore(saved)
  await expect(a.run('read evidence before finishing')).rejects.toThrow()
  expect(a.snapshot().recovery?.read.pending).toHaveLength(1)
  await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
  expect(p.requests).toHaveLength(3)
})

it('rejects an oversized planned after-check before the declared tool effect', async () => {
  const o = await options('afterTool')
  const paths = Array.from({ length: 10 }, (_, i) => 'x'.repeat(3500) + i)
  const p = provider(reply({ type: 'tool_use', id: 'big', name: 'write_many', input: { paths } }))
  let effects = 0
  const a = new Agent({
    ...o,
    tools: [
      {
        name: 'write_many',
        description: 'trusted fixture',
        input_schema: { type: 'object', properties: {} },
        permission: { effect: 'execute' },
        checkpointPaths: ['paths'],
        execute: async () => {
          effects++
          return 'done'
        },
      },
    ],
    permissions: { mode: 'bypass' },
  })
  await expect(a.run('write')).rejects.toThrow('input-capacity')
  expect(effects).toBe(0)
  expect(p.requests).toHaveLength(1)
  expect(validateSessionSnapshot(a.snapshot())).toBeTruthy()
})

it.each(['mutation', 'denied-read'] as const)(
  'preserves contract-only audit paths during explicit completion recheck: %s',
  async mode => {
    const script = path.join(root, 'completion-check.mjs')
    const report = path.join(root, 'report.json')
    await fs.writeFile(report, '{"ok":true}')
    await fs.writeFile(
      script,
      `import fs from 'node:fs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.appendFileSync('starts', '1');
const pass = fs.existsSync('allow-check');
if (pass) fs.writeFileSync('report.json', '{"ok":false}');
process.stdout.write(JSON.stringify({version:1, decision:pass?'pass':'block'}));`
    )
    const config: HookConfig = {
      version: 1,
      hooks: [
        {
          id: 'gate',
          stage: 'beforeComplete',
          command: process.execPath,
          args: [script],
          sources: [script],
        },
      ],
    }
    const views = await new Hooks(root, { config }).inspect()
    const o = {
      cwd: root,
      skills: false as const,
      projectInstructions: false as const,
      hooks: { config, trust: views.map(v => `${v.id}:${v.identity}`) },
    }
    const p = provider(answer())
    const a = new Agent(o)
    await expect(
      a.runWithContract('verify existing report', {
        version: 1,
        artifacts: [
          {
            path: 'report.json',
            format: 'json',
            schema: {
              kind: 'object',
              fields: { ok: { kind: 'value', type: 'boolean' } },
              allowAdditional: false,
            },
          },
        ],
      })
    ).rejects.toThrow('blocked')
    const saved = a.snapshot()
    expect(saved.recovery!.hooks!.writes).toEqual([])
    await fs.writeFile(path.join(root, 'allow-check'), 'user reviewed existing effects')
    const b = new Agent({
      ...o,
      permissions: {
        mode: 'accept-edits',
        ...(mode === 'denied-read' && { rules: [{ tool: 'read_file', action: 'deny' } as const] }),
      },
    })
    b.restore(saved)
    await expect(
      b.recheckHooks('Run an independent new check of the existing report')
    ).rejects.toThrow(mode === 'mutation' ? 'files-changed' : 'unverifiable')
    expect(p.requests).toHaveLength(1)
    expect(b.snapshot().recovery?.hooks?.checks[0].state).toBe('blocked')
    if (mode === 'mutation') {
      expect(await fs.readFile(report, 'utf8')).toBe('{"ok":false}')
      expect(b.snapshot().recovery?.hooks?.checks.at(-1)?.state).toBe('blocked')
      expect(await fs.readFile(path.join(root, 'starts'), 'utf8')).toBe('11')
    } else {
      expect(await fs.readFile(report, 'utf8')).toBe('{"ok":true}')
      expect(await fs.readFile(path.join(root, 'starts'), 'utf8')).toBe('1')
    }
  }
)
