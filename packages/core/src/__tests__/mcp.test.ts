import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  McpController,
  McpUnknownOutcomeError,
  mcpToolName,
  validateMcpOptions,
} from '../mcp/client.js'
import { PermissionController } from '../permissions.js'
import { compileMcpSchema } from '../mcp/schema.js'
import { executeToolCalls } from '../loop.js'
import type Anthropic from '@anthropic-ai/sdk'
const fixture = path.resolve(import.meta.dirname, '../../../../researches/mcp/issue-server.mjs')
let root: string
const clients: McpController[] = []
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'z2a-mcp-')))
})
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close()
  await rm(root, { recursive: true, force: true })
})
function client(mode = 'normal', extra = {}) {
  const c = new McpController(root, {
    servers: [
      {
        id: 'issues',
        enabled: true,
        command: process.execPath,
        args: [fixture, mode, path.join(root, 'audit')],
      },
    ],
    startupTimeoutMs: 1000,
    callTimeoutMs: 100,
    ...extra,
  })
  clients.push(c)
  return c
}
async function audit() {
  return (await readFile(path.join(root, 'audit'), 'utf8'))
    .trim()
    .split('\n')
    .map(l => JSON.parse(l))
}
const ctx = () => ({ cwd: root })
const call = (tool: string): Anthropic.ToolUseBlock => ({
  type: 'tool_use',
  id: 'call-1',
  name: mcpToolName('issues', tool),
  input: {},
})
const effectCount = async () => (await audit()).filter(e => e.event === 'effect').length

describe('MCP native stdio, discovery and current permissions', () => {
  it('keeps construction/disabled configuration inert and environment explicit', async () => {
    const c = client()
    expect(c.view()[0].state).toBe('configured')
    await expect(readFile(path.join(root, 'audit'))).rejects.toThrow()
    const disabled = client('normal', {
      servers: [{ id: 'issues', command: process.execPath, args: [fixture] }],
    })
    await disabled.open()
    expect(disabled.tools()).toEqual([])
    await c.open()
    expect((await audit())[0].envKeys).not.toContain('ANTHROPIC_API_KEY')
    expect((await audit())[0].envKeys).not.toContain('HOME')
  })
  it('initializes, pages, calls JSON, and actually removes the native PID', async () => {
    const c = client()
    await c.open()
    expect(c.tools()).toHaveLength(3)
    expect(await c.tools()[0].execute({}, ctx())).toContain('ISSUE-42')
    const records = await audit()
    expect(records.filter(e => e.method === 'tools/list')).toHaveLength(2)
    expect(records.some(e => e.method === 'notifications/initialized')).toBe(true)
    const pid = records[0].pid
    expect(() => process.kill(pid, 0)).not.toThrow()
    await c.close()
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('isolates same tool names across two explicitly enabled servers', async () => {
    const c = client('normal', {
      servers: ['alpha', 'beta'].map(id => ({
        id,
        enabled: true,
        command: process.execPath,
        args: [fixture, 'normal', path.join(root, 'audit'), id],
      })),
    })
    await c.open()
    expect(new Set(c.tools().map(t => t.name)).size).toBe(6)
    for (const id of ['alpha', 'beta'])
      expect(
        await c
          .tools()
          .find(t => t.name === mcpToolName(id, 'get_issue'))!
          .execute({}, ctx())
      ).toContain(`"label":"${id}"`)
  })
  it.each([
    'bad-version',
    'bad-capability',
    'cycle',
    'too-many-pages',
    'bad-schema',
    'bad-name',
    'duplicate',
    'too-many-tools',
    'oversize-frame',
    'invalid-frame',
    'hang-init',
    'hang-list',
  ])('rejects %s visibly and closes the process', async mode => {
    const c = client(mode, { startupTimeoutMs: 100 })
    await c.open()
    expect(c.tools()).toEqual([])
    expect(c.view()[0].state).toBe('failed')

    const pid = (await audit())[0].pid
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('accepts the tool count at the bound', async () => {
    const c = client('tools-at-limit')
    await c.open()
    expect(c.tools()).toHaveLength(32)
  })
  it.each(['default', 'accept-edits', 'read-only'] as const)(
    'does not let readOnlyHint grant permission in %s',
    async mode => {
      const c = client()
      await c.open()
      const result = await executeToolCalls(
        [call('record_action')],
        c.tools(),
        ctx(),
        undefined,
        new PermissionController({ mode }),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        c
      )
      expect(result[0].is_error).toBe(true)
      expect(await effectCount()).toBe(0)
    }
  )
  it('uses current explicit allow and deny rules without trusting annotations', async () => {
    const c = client()
    await c.open()
    const t = c.tools().find(t => t.name === mcpToolName('issues', 'record_action'))!
    const result = await executeToolCalls(
      [call('record_action')],
      c.tools(),
      ctx(),
      undefined,
      new PermissionController({ rules: [{ tool: t.name, action: 'allow' }] }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      c
    )
    expect(result[0].is_error).toBeUndefined()
    expect(await effectCount()).toBe(1)
  })
  it('validates input before any business request', async () => {
    const c = client()
    await c.open()
    await expect(c.tools()[0].execute({ unexpected: true }, ctx())).rejects.toThrow('not sent')
    expect((await audit()).filter(e => e.method === 'tools/call')).toHaveLength(0)
  })
  it.each(['tool-error', 'protocol-error'])(
    'preserves settled %s separately from disconnect',
    async mode => {
      const c = client(mode)
      await c.open()
      expect(await c.tools()[0].execute({}, ctx())).toMatch(/^Error: MCP/)
      expect(c.hasUnknownOutcome).toBe(false)
    }
  )
  it.each(['effect-disconnect', 'effect-hang'])('never retries an effect before %s', async mode => {
    const c = client(mode)
    await c.open()
    await expect(
      c
        .tools()
        .find(t => t.name === mcpToolName('issues', 'record_action'))!
        .execute({}, ctx())
    ).rejects.toBeInstanceOf(McpUnknownOutcomeError)
    expect(await effectCount()).toBe(1)
    expect(c.hasUnknownOutcome).toBe(true)
  })
  it('awaits native cleanup when cancelled after the effect', async () => {
    const c = client('effect-hang', { callTimeoutMs: 1000 })
    await c.open()
    const cancel = new AbortController()
    const promise = c.tools()[2].execute({}, { ...ctx(), signal: cancel.signal })
    for (let i = 0; i < 100 && !(await effectCount()); i++) await new Promise(r => setTimeout(r, 5))
    cancel.abort()
    await expect(promise).rejects.toBeInstanceOf(McpUnknownOutcomeError)
    expect(await effectCount()).toBe(1)

    const pid = (await audit())[0].pid
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it.each(['unsupported', 'invalid-output'])(
    'marks %s incomplete rather than dropping result data',
    async mode => {
      const c = client(mode)
      await c.open()
      await expect(c.tools()[0].execute({}, ctx())).rejects.toBeInstanceOf(McpUnknownOutcomeError)
    }
  )
  it('does not silently refresh a stale tool table', async () => {
    const c = client('stale')
    await c.open()
    await c.tools()[0].execute({}, ctx())
    await new Promise(r => setTimeout(r, 10))
    expect(() => c.assertCurrent()).toThrow('catalogue')
    await expect(c.tools()[1].execute({}, ctx())).rejects.toThrow('not executed')
    expect((await audit()).filter(e => e.method === 'tools/call')).toHaveLength(1)
  })
  it('kills a server that ignores TERM on close', async () => {
    const c = client('hang-close')
    await c.open()
    const pid = (await audit())[0].pid
    await c.close()
    expect(() => process.kill(pid, 0)).toThrow()
  })
})
describe('MCP configuration, schema and names are bounded', () => {
  it('validates config counts and explicit local command, without changing caller configuration', () => {
    expect(() =>
      validateMcpOptions({
        servers: Array.from({ length: 5 }, (_, i) => ({ id: 's' + i, command: process.execPath })),
      })
    ).toThrow()
    for (const options of [
      { servers: [{ id: 'x', command: 'node' }] },
      { servers: [{ id: 'x', command: process.execPath, env: { BAD_KEY: 3 } }] },
      { servers: [], callTimeoutMs: 30001 },
    ])
      expect(() => validateMcpOptions(options as never)).toThrow()
    expect(validateMcpOptions({ servers: [] })).toEqual({ servers: [] })
  })
  it('keeps name length under model bounds and distinguishes raw names', () => {
    expect(mcpToolName('x'.repeat(32), 'a'.repeat(128)).length).toBeLessThanOrEqual(64)
    expect(mcpToolName('x', 'a.b')).not.toBe(mcpToolName('x', 'a_b'))
  })
  it.each([
    { $ref: 'https://example.com/schema' },
    { pattern: 'x' },
    { $schema: 'http://json-schema.org/draft-07/schema#' },
    { unknown: true },
  ])('rejects unsupported schema %j', extra => {
    expect(() => compileMcpSchema({ type: 'object', ...extra })).toThrow()
  })
  it('validates object schema values, rejects invalid schemas without weakening them', () => {
    const validate = compileMcpSchema({
      type: 'object',
      properties: { x: { type: 'integer', minimum: 0 } },
      required: ['x'],
      additionalProperties: false,
    })
    expect(validate({ x: 0 })).toBe(true)
    expect(validate({ x: -1 })).toBe(false)
    expect(validate({ x: 0, y: 1 })).toBe(false)
    expect(() => compileMcpSchema({ type: 'object', required: 7 })).toThrow()
  })
})
