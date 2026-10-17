import { buildSystemPrompt } from '../prompt/system.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { Agent } from '../agent.js'
import { createAnthropicClient } from '../llm/index.js'
import { messageStream } from './helpers/message-stream.js'
import { writeFileTool } from '../tools/write-file.js'
import { readFileTool } from '../tools/read-file.js'
import { McpController, McpUnknownOutcomeError, mcpToolName } from '../mcp/client.js'
import { RunBudget } from '../run-budget.js'
import { historyReference } from '../history-evidence.js'
import { validateSessionSnapshot } from '../session-snapshot.js'
import type { ContextRequest } from '../context-budget.js'
vi.mock('../llm/index.js', () => ({
  createAnthropicClient: vi.fn(),
  getModelName: () => 'claude-sonnet-4-20250514',
}))
const fixture = path.resolve(import.meta.dirname, '../../../../researches/mcp/issue-server.mjs')
let root: string
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'z2a-mcp-loop-')))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
const call = (
  id: string,
  name: string,
  input: Record<string, unknown> = {}
): Anthropic.ToolUseBlock => ({ type: 'tool_use', id, name, input })
const mcp = (id: string, name: string) => call(id, mcpToolName('issues', name))
const reply = (...content: Anthropic.ToolUseBlock[]) =>
  ({ content, stop_reason: 'tool_use' }) as Anthropic.Message
const answer = () =>
  ({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }) as Anthropic.Message
function provider(...responses: Anthropic.Message[]) {
  const requests: ContextRequest[] = []
  const stream = vi.fn((request: ContextRequest) => {
    requests.push(structuredClone(request))
    return messageStream(async () => {
      const next = responses.shift()
      if (!next) throw new Error('Unexpected request')
      return next
    })
  })
  const create = vi.fn(async () => answer())
  vi.mocked(createAnthropicClient).mockReturnValue({
    messages: { stream, create },
  } as unknown as Anthropic)
  return { requests, stream, create }
}
function options(mode = 'normal') {
  return {
    cwd: root,
    skills: false as const,
    projectInstructions: false as const,
    tools: [readFileTool, writeFileTool],
    permissions: { mode: 'bypass' as const },
    results: { directory: path.join(root, 'results') },
    mcp: {
      servers: [
        {
          id: 'issues',
          enabled: true,
          command: process.execPath,
          args: [fixture, mode, path.join(root, 'audit')],
        },
      ],
      callTimeoutMs: 100,
      startupTimeoutMs: 1500,
    },
  }
}
async function effects() {
  return (await readFile(path.join(root, 'audit'), 'utf8'))
    .trim()
    .split('\n')
    .map(l => JSON.parse(l))
    .filter(e => e.event === 'effect').length
}
function receipts(a: Agent) {
  return a
    .getHistory()
    .flatMap(m => (Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []))
}

describe('MCP through loop, paired recovery and provenance', () => {
  it('keeps the default scope unchanged and adjusts it only for enabled MCP', () => {
    const original = buildSystemPrompt()
    expect(original).toContain('- 访问网络')
    expect(original).not.toContain('MCP')
    expect(buildSystemPrompt({ mcp: false })).toBe(original)
    const enabled = buildSystemPrompt({ mcp: true })
    expect(enabled).toContain('MCP 工具仍须逐次遵守宿主授权')
    expect(
      enabled.replace(
        '- 通过未获授权的外部工具访问数据；已启用的 MCP 工具仍须逐次遵守宿主授权',
        '- 访问网络'
      )
    ).toBe(original)
  })
  it.each([false, undefined])('preserves no-MCP request compatibility (%s)', async value => {
    const { requests } = provider(answer())
    const a = new Agent({ ...options(), mcp: value, systemPrompt: 'original' })
    await a.run('task')
    expect(requests[0].messages).toEqual([{ role: 'user', content: 'task' }])
    expect(requests[0].system).toBe('original')
    expect(requests[0].tools?.some(t => t.name.startsWith('mcp_'))).toBe(false)
  })
  it('runs external and built-in tools under the same loop; disables native connection at turn end', async () => {
    const { requests } = provider(
      reply(
        mcp('issue', 'get_issue'),
        call('write', 'write_file', { path: 'fixed.txt', content: 'fixed' })
      ),
      answer()
    )
    const a = new Agent(options())
    await a.run('task')
    expect(await readFile(path.join(root, 'fixed.txt'), 'utf8')).toBe('fixed')
    expect(requests[0].tools?.some(t => t.name === mcpToolName('issues', 'get_issue'))).toBe(true)
    expect(a.getMcpServers()[0].state).toBe('closed')
    expect(receipts(a)).toHaveLength(2)
    expect(a.snapshot().history?.version).toBe(2)
  })
  it.each(['effect-disconnect', 'effect-hang'])(
    'stops after %s, retains completed effects, pairs unknown/unstarted, requires explicit continuation',
    async mode => {
      const { stream } = provider(
        reply(
          mcp('first', 'get_issue'),
          mcp('effect', 'record_action'),
          call('skip', 'write_file', { path: 'must-not-exist', content: 'bad' })
        ),
        answer()
      )
      const a = new Agent(options(mode))
      await expect(a.run('record once')).rejects.toThrow('unknown')
      expect(stream).toHaveBeenCalledTimes(1)
      expect(await effects()).toBe(1)
      await expect(readFile(path.join(root, 'must-not-exist'))).rejects.toThrow()
      expect(receipts(a)).toHaveLength(3)
      const snapshot = a.snapshot()
      expect(snapshot.recovery?.tools.map(t => t.state)).toEqual([
        'settled',
        'unknown',
        'not-started',
      ])
      expect(snapshot.recovery?.safe).toBe(false)
      expect(validateSessionSnapshot(snapshot).recovery).toEqual(snapshot.recovery)
      expect(a.needsRecovery).toBe(true)
      await expect(a.run('retry')).rejects.toThrow('requires review')
      const restored = new Agent(options(mode))
      restored.restore(snapshot)
      expect(await effects()).toBe(1)
      await restored.continueInterrupted(
        'I inspected the local counter. Keep its existing effect; do not record again.'
      )
      expect(await effects()).toBe(1)
      expect(restored.needsRecovery).toBe(false)
      expect(stream).toHaveBeenCalledTimes(2)
    }
  )
  it('retains unknown state after actual cancellation, without another model request', async () => {
    const { stream } = provider(reply(mcp('effect', 'record_action'), mcp('skip', 'record_action')))
    const a = new Agent({
      ...options('effect-hang'),
      mcp: { ...options('effect-hang').mcp, callTimeoutMs: 1000 },
    })
    const running = expect(a.run('record once')).rejects.toThrow()
    for (let i = 0; i < 200; i++) {
      try {
        if (await effects()) break
      } catch {}
      await new Promise(r => setTimeout(r, 5))
    }
    expect(await effects()).toBe(1)
    a.cancelTurn()
    await running
    expect(a.needsRecovery).toBe(true)
    expect(a.snapshot().recovery?.tools.map(t => t.state)).toEqual(['unknown', 'not-started'])
    expect(stream).toHaveBeenCalledTimes(1)
    expect(await effects()).toBe(1)
  })
  it('keeps unknown effects when publishing the interrupted receipt also fails', async () => {
    const { stream } = provider(reply(mcp('effect', 'record_action'), mcp('skip', 'record_action')))
    const a = new Agent({
      ...options('effect-disconnect'),
      executionPersistence: async (_snapshot, boundary) => {
        if (boundary === 'tool-settled') throw new Error('fixed storage failure')
      },
    })
    await expect(a.run('record once')).rejects.toThrow('unknown')
    const snapshot = a.snapshot()
    expect(snapshot.recovery?.reason).toBe('storage-error')
    expect(snapshot.recovery?.tools.map(t => t.state)).toEqual(['unknown', 'not-started'])
    expect(validateSessionSnapshot(snapshot).recovery).toEqual(snapshot.recovery)
    expect(await effects()).toBe(1)
    expect(stream).toHaveBeenCalledTimes(1)
    await expect(a.run('retry')).rejects.toThrow('requires review')
  })
  it('preserves unknown errors and releases the turn budget when final cleanup reports failure', async () => {
    const close = McpController.prototype.close
    let closes = 0
    vi.spyOn(McpController.prototype, 'close').mockImplementation(async function () {
      await close.call(this)
      if (++closes > 1) throw new Error('fixed cleanup failure')
    })
    const budgetClose = vi.spyOn(RunBudget.prototype, 'close')
    provider(reply(mcp('effect', 'record_action')))
    const a = new Agent(options('effect-disconnect'))
    await expect(a.run('record once')).rejects.toBeInstanceOf(McpUnknownOutcomeError)
    expect(budgetClose).toHaveBeenCalledTimes(1)
    expect(a.snapshot().recovery?.tools[0].state).toBe('unknown')
    expect(await effects()).toBe(1)
  })
  it('releases inspection ownership even when cleanup reports failure', async () => {
    const close = McpController.prototype.close
    let closes = 0
    const cleanup = vi
      .spyOn(McpController.prototype, 'close')
      .mockImplementation(async function () {
        await close.call(this)
        if (++closes > 1) throw new Error('fixed cleanup failure')
      })
    const a = new Agent(options())
    await expect(a.inspectMcp()).rejects.toThrow('fixed cleanup failure')
    cleanup.mockRestore()
    await expect(a.close()).resolves.toBeUndefined()
    await expect(a.inspectMcp()).resolves.toMatchObject([{ state: 'ready' }])
  })
  it('keeps built-ins usable when server discovery fails and reports that limit in model context', async () => {
    const { requests } = provider(
      reply(call('write', 'write_file', { path: 'ok', content: 'builtin' })),
      answer()
    )
    const a = new Agent(options('bad-schema'))
    await a.run('task')
    expect(await readFile(path.join(root, 'ok'), 'utf8')).toBe('builtin')
    expect(requests[0].system).toContain('MCP unavailable')
    expect(a.getMcpServers()[0].state).toBe('failed')
  })
  it('stores external provenance with long results and blocks recall under disabled current config', async () => {
    provider(reply(mcp('logs', 'get_logs')), answer())
    const a = new Agent(options())
    await a.run('logs')
    const snapshot = a.snapshot()
    expect(snapshot.results?.version).toBe(2)
    expect(snapshot.results?.entries[0].source.external?.[0].server).toBe('issues')
    const reference = snapshot.results!.entries[0].reference
    const resultIndex = snapshot.messages.findIndex(
      m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result')
    )
    const historyRef = historyReference(snapshot.messages[resultIndex], resultIndex)
    const { requests } = provider(
      reply(
        call('read', 'read_tool_result', { reference, tail: true }),
        call('history', 'read_history', { reference: historyRef })
      ),
      answer()
    )
    const disabled = new Agent({ ...options(), mcp: false })
    disabled.restore(snapshot)
    await disabled.run('read saved results')
    expect(
      receipts(disabled)
        .slice(-2)
        .every(r => r.is_error)
    ).toBe(true)
    expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain(
      'VERDICT: integer-cents required'
    )
    expect(
      receipts(disabled)
        .slice(-2)
        .map(r => r.content)
        .join(' ')
    ).toContain('source is disabled')
  })
  it('applies current source permission before body recall, carries provenance through history and snapshot', async () => {
    provider(reply(mcp('logs', 'get_logs')), answer())
    const a = new Agent(options())
    await a.run('logs')
    const saved = a.snapshot(),
      reference = saved.results!.entries[0].reference
    const { requests } = provider(
      reply(call('read', 'read_tool_result', { reference, tail: true })),
      answer()
    )
    const enabled = new Agent(options())
    enabled.restore(saved)
    await enabled.run('read saved tail')
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain('VERDICT: integer-cents required')
    const snapshot = enabled.snapshot()
    expect(snapshot.history?.sources.at(-1)?.external?.[0].server).toBe('issues')
    const resultIndex = snapshot.messages.findLastIndex(
      m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result')
    )
    const historyRef = historyReference(snapshot.messages[resultIndex], resultIndex)
    provider(reply(call('h', 'read_history', { reference: historyRef })), answer())
    const denied = new Agent({ ...options(), permissions: { mode: 'read-only' } })
    denied.restore(snapshot)
    await denied.run('read history')
    expect(receipts(denied).at(-1)?.content).toContain('MCP source read denied')
  })
  it('rejects old result when the enabled command identity changed, without starting it during restore', async () => {
    provider(reply(mcp('logs', 'get_logs')), answer())
    const a = new Agent(options())
    await a.run('logs')
    const saved = a.snapshot(),
      reference = saved.results!.entries[0].reference
    const changed = options()
    changed.mcp.servers[0].args.push('changed-identity')
    provider(reply(call('r', 'read_tool_result', { reference, tail: true })), answer())
    const b = new Agent(changed)
    b.restore(saved)
    await b.run('read')
    expect(receipts(b).at(-1)?.content).toContain('source is disabled or has changed')
  })
  it('checks combined external provenance capacity before a new effect', async () => {
    provider(reply(mcp('logs', 'get_logs')), answer())
    const a = new Agent(options())
    await a.run('logs')
    const saved = a.snapshot()
    const source = saved.history!.sources[0].external![0]
    saved.history!.sources[0].external = Array.from({ length: 128 }, (_, i) => ({
      ...source,
      tool: 'historical_' + i,
    }))
    const index = saved.history!.sources[0].message
    const reference = historyReference(saved.messages[index], index)
    provider(
      reply(call('history', 'read_history', { reference }), mcp('effect', 'record_action')),
      answer()
    )
    const restored = new Agent(options())
    restored.restore(saved)
    await restored.run('read historical source then record')
    expect(await effects()).toBe(0)
    expect(receipts(restored).at(-1)?.is_error).toBe(true)
    expect(receipts(restored).at(-1)?.content).toContain('external source catalog')
    expect(validateSessionSnapshot(restored.snapshot())).toBeTruthy()
  })
  it('rejects malformed or downgraded external provenance before replacing session state', async () => {
    provider(reply(mcp('logs', 'get_logs')), answer())
    const a = new Agent(options())
    await a.run('logs')
    const saved = a.snapshot()
    const bad = structuredClone(saved)
    bad.results!.version = 1
    expect(() => a.restore(bad)).toThrow()
    const badHistory = structuredClone(saved)
    badHistory.history!.sources[0].external![0].identity = 'bad'
    expect(() => a.restore(badHistory)).toThrow()
    expect(a.snapshot()).toEqual(saved)
  })
})
