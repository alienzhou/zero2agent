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
    const p = provider(reply(write('w', 'out'), write('skip', 'never')))
    const a = new Agent(o)
    await expect(a.run('write')).rejects.toThrow('not executed')
    expect(p.requests).toHaveLength(1)
    await expect(fs.stat(path.join(root, 'out'))).rejects.toThrow()
    expect(a.snapshot().recovery?.tools.map(t => t.state)).toEqual(['not-started', 'not-started'])
    expect(receipts(a)).toHaveLength(2)
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
