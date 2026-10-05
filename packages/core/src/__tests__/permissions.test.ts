import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PermissionController,
  type PermissionOptions,
  type ApprovalRequest,
} from '../permissions.js'
import { executeToolCalls } from '../loop.js'
import { allTools, writeFileTool, deleteTool, replaceInFileTool } from '../tools/index.js'
import type { Tool } from '../tools/types.js'

const temp: string[] = []
const ctx = { cwd: process.cwd() }
const tool = (effect?: 'read' | 'write' | 'execute'): Tool => ({
  name: 'custom',
  description: '',
  input_schema: { type: 'object', properties: {} },
  ...(effect && { permission: { effect } }),
  execute: vi.fn(async () => 'done'),
})
const controller = (options?: PermissionOptions) => new PermissionController(options)
const call = (id: string, name: string, input: Record<string, unknown> = {}) => ({
  type: 'tool_use' as const,
  id,
  name,
  input,
})
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'z2a-permission-'))
  temp.push(dir)
  await mkdir(join(dir, 'inside'))
  await mkdir(join(dir, 'outside'))
  return { dir, cwd: join(dir, 'inside'), outside: join(dir, 'outside') }
}
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temp.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('permission rules and host configuration', () => {
  it.each([
    ['default', 'read', 'allow'],
    ['default', 'write', 'ask'],
    ['default', 'execute', 'ask'],
    ['read-only', 'read', 'allow'],
    ['read-only', 'write', 'deny'],
    ['read-only', 'execute', 'deny'],
    ['accept-edits', 'read', 'allow'],
    ['accept-edits', 'write', 'allow'],
    ['accept-edits', 'execute', 'ask'],
    ['bypass', 'write', 'allow'],
    ['bypass', 'execute', 'allow'],
  ] as const)('%s / %s -> %s', (mode, effect, expected) => {
    expect(controller({ mode }).evaluate(tool(effect), {}, ctx).action).toBe(expected)
  })
  it('does not infer read privilege from a familiar name', () => {
    expect(controller().evaluate({ ...tool(), name: 'read_file' }, {}, ctx).action).toBe('ask')
  })
  it.each(['default', 'accept-edits', 'bypass'] as const)(
    'deny beats conflicting allow/ask in %s',
    mode => {
      expect(
        controller({
          mode,
          rules: [
            { tool: '*', action: 'allow' },
            { tool: 'custom', action: 'ask' },
            { tool: '*', action: 'deny' },
          ],
        }).evaluate(tool(), {}, ctx).action
      ).toBe('deny')
    }
  )
  it('ask beats allow, including bypass', () => {
    expect(
      controller({
        mode: 'bypass',
        rules: [
          { tool: 'custom', action: 'allow' },
          { tool: '*', action: 'ask' },
        ],
      }).evaluate(tool('read'), {}, ctx).action
    ).toBe('ask')
  })
  it('matches exact input, not a shell prefix', () => {
    const p = controller({
      rules: [
        { tool: 'custom', action: 'allow', input: { command: 'git status', interactive: false } },
      ],
    })
    expect(p.evaluate(tool(), { command: 'git status', interactive: false }, ctx).action).toBe(
      'allow'
    )
    expect(
      p.evaluate(tool(), { command: 'git status; echo changed', interactive: false }, ctx).action
    ).toBe('ask')
    expect(p.evaluate(tool(), { command: 'git status' }, ctx).action).toBe('ask')
  })
  it('copies configuration so later mutation cannot broaden access', () => {
    const rules = [{ tool: 'custom', action: 'deny' as const }]
    const p = controller({ rules })
    rules.splice(0)
    expect(p.evaluate(tool(), {}, ctx).action).toBe('deny')
  })
  it.each([
    { mode: 'invalid' },
    { approvalTimeoutMs: 0 },
    { approvalTimeoutMs: NaN },
    { approvalTimeoutMs: Infinity },
    { rules: {} },
    { rules: null },
    { mode: null },
    { rules: [{ tool: '', action: 'allow' }] },
    { rules: [{ tool: 'x', action: 'unknown' }] },
    { rules: [{ tool: 'x', action: 'allow', input: [] }] },
    { rules: [{ tool: 'x', action: 'allow', input: { path: {} } }] },
    { requestApproval: true },
  ])('rejects invalid config %j', options =>
    expect(() => controller(options as PermissionOptions)).toThrow()
  )
  it('read-only cannot be loosened by allow rules', () => {
    expect(
      controller({ mode: 'read-only', rules: [{ tool: '*', action: 'allow' }] }).evaluate(
        tool('write'),
        {},
        ctx
      ).action
    ).toBe('deny')
  })
  it('every built-in has explicit effect metadata', () => {
    expect(allTools.every(t => t.permission?.effect)).toBe(true)
  })
})

describe('single approval lifecycle', () => {
  it('waits for the host before execution and scopes approval to one call', async () => {
    let answer!: (value: { requestId: string; decision: 'allow' }) => void
    let request!: ApprovalRequest
    const requestApproval = vi.fn(async r => {
      request = r
      return new Promise<{ requestId: string; decision: 'allow' }>(resolve => {
        answer = resolve
      })
    })
    const t = tool()
    const p = controller({ requestApproval })
    const run = executeToolCalls([call('a', t.name, { path: 'x' })], [t], ctx, undefined, p)
    await vi.waitFor(() => expect(requestApproval).toHaveBeenCalledOnce())
    expect(t.execute).not.toHaveBeenCalled()
    expect(Object.isFrozen(request.input)).toBe(true)
    answer({ requestId: request.id, decision: 'allow' })
    expect((await run)[0].content).toBe('done')
    const again = p.authorize('b', t, {}, ctx)
    await vi.waitFor(() => expect(requestApproval).toHaveBeenCalledTimes(2))
    p.cancelPending()
    expect((await again).action).toBe('deny')
  })
  it.each(['mismatch', 'invalid', 'throws', 'rejects', 'missing'] as const)(
    'fails closed when host %s',
    async kind => {
      const p = controller(
        kind === 'missing'
          ? {}
          : {
              requestApproval: async request => {
                if (kind === 'throws' || kind === 'rejects') throw new Error('host failure')
                return {
                  requestId: kind === 'mismatch' ? 'other' : request.id,
                  decision: kind === 'invalid' ? 'always' : 'deny',
                } as never
              },
            }
      )
      const t = tool()
      const result = await executeToolCalls([call('a', t.name)], [t], ctx, undefined, p)
      expect(t.execute).not.toHaveBeenCalled()
      expect(result[0]).toMatchObject({ tool_use_id: 'a', is_error: true })
    }
  )
  it('times out, aborts the request and ignores a late approval', async () => {
    vi.useFakeTimers()
    let request!: ApprovalRequest
    let answer!: (value: unknown) => void
    const p = controller({
      approvalTimeoutMs: 40,
      requestApproval: async r => {
        request = r
        return new Promise(resolve => {
          answer = resolve
        }) as never
      },
    })
    const t = tool()
    const run = executeToolCalls([call('a', t.name)], [t], ctx, undefined, p)
    await vi.advanceTimersByTimeAsync(41)
    expect((await run)[0].content).toContain('timed out')
    expect(request.signal.aborted).toBe(true)
    answer({ requestId: request.id, decision: 'allow' })
    await Promise.resolve()
    expect(t.execute).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancel is instance-local and clears waiting timers', async () => {
    const a = controller({ requestApproval: async () => new Promise(() => {}) })
    const b = controller({ requestApproval: async r => ({ requestId: r.id, decision: 'allow' }) })
    const result = a.authorize('a', tool(), {}, ctx)
    a.cancelPending()
    expect((await result).action).toBe('deny')
    expect((await b.authorize('b', tool(), {}, ctx)).action).toBe('allow')
  })
  it('observer failures and input mutation cannot change approved arguments', async () => {
    const t = tool()
    const input = { nested: { x: 'original' } }
    const p = controller({
      requestApproval: async r => {
        expect(() => {
          ;(r.input.nested as { x: string }).x = 'changed'
        }).toThrow()
        return { requestId: r.id, decision: 'allow' }
      },
    })
    const results = await executeToolCalls(
      [call('a', t.name, input), call('b', 'unknown')],
      [t],
      ctx,
      {
        onPermission: () => {
          throw new Error('display')
        },
        onToolStart: (_name, args) => {
          ;(args.nested as { x: string }).x = 'observer'
        },
      },
      p
    )
    expect(t.execute).toHaveBeenCalledWith(input, ctx)
    expect(results.map(r => r.tool_use_id)).toEqual(['a', 'b'])
  })
  it('returned Error receipts are error tool results', async () => {
    const t = { ...tool('read'), execute: async () => 'Error: no file' }
    expect((await executeToolCalls([call('a', t.name)], [t], ctx))[0].is_error).toBe(true)
  })
})

describe('workspace paths and real file effects', () => {
  it('allows reads inside, asks outside, rejects outside in read-only', async () => {
    const { cwd, outside } = await workspace()
    const t = { ...tool('read'), permission: { effect: 'read' as const, paths: ['path'] } }
    expect(controller().evaluate(t, { path: '.' }, { cwd }).action).toBe('allow')
    expect(controller().evaluate(t, { path: outside }, { cwd }).action).toBe('ask')
    expect(controller({ mode: 'read-only' }).evaluate(t, { path: outside }, { cwd }).action).toBe(
      'deny'
    )
  })
  it.each(['default', 'accept-edits', 'bypass'] as const)(
    'hard-denies traversal and symlink writes in %s',
    async mode => {
      const { cwd, outside } = await workspace()
      await symlink(outside, join(cwd, 'link'))
      for (const path of ['../outside/x', 'link/new/deep.txt', '.']) {
        const p = controller({
          mode,
          rules: [{ tool: '*', action: 'allow' }],
          requestApproval: vi.fn(),
        })
        expect(p.evaluate(writeFileTool, { path, content: 'x' }, { cwd }).action).toBe('deny')
        expect(await writeFileTool.execute({ path, content: 'x' }, { cwd })).toContain('outside')
      }
      await expect(readFile(join(outside, 'x'))).rejects.toThrow()
    }
  )
  it('checks boundary again after the approval wait', async () => {
    const { cwd, outside } = await workspace()
    await mkdir(join(cwd, 'target'))
    const p = controller({
      requestApproval: async r => {
        await rm(join(cwd, 'target'), { recursive: true })
        await symlink(outside, join(cwd, 'target'))
        return { requestId: r.id, decision: 'allow' }
      },
    })
    const start = vi.fn()
    const result = await executeToolCalls(
      [call('write', writeFileTool.name, { path: 'target/file', content: 'x' })],
      [writeFileTool],
      { cwd },
      { onToolStart: start },
      p
    )
    expect(start).not.toHaveBeenCalled()
    expect(result[0].is_error).toBe(true)
    await expect(readFile(join(outside, 'file'))).rejects.toThrow()
  })
  it('creates missing directories and permits names beginning with two dots', async () => {
    const { cwd } = await workspace()
    const p = controller({ mode: 'accept-edits' })
    expect(
      (
        await executeToolCalls(
          [call('a', writeFileTool.name, { path: '..notes/new/file', content: 'ok' })],
          [writeFileTool],
          { cwd },
          undefined,
          p
        )
      )[0].is_error
    ).toBeUndefined()
    expect(await readFile(join(cwd, '..notes/new/file'), 'utf8')).toBe('ok')
  })
  it('rejects the entire batch before deletion when any path is outside', async () => {
    const { cwd } = await workspace()
    await writeFile(join(cwd, 'keep'), 'ok')
    const result = await executeToolCalls(
      [call('a', deleteTool.name, { paths: ['keep', '../outside/x'] })],
      [deleteTool],
      { cwd },
      undefined,
      controller({ mode: 'bypass' })
    )
    expect(result[0].is_error).toBe(true)
    expect(await readFile(join(cwd, 'keep'), 'utf8')).toBe('ok')
  })
  it('deletes an internal symlink itself, preserving its target', async () => {
    const { cwd } = await workspace()
    await writeFile(join(cwd, 'target'), 'ok')
    await symlink(join(cwd, 'target'), join(cwd, 'link'))
    expect(await deleteTool.execute({ paths: ['link'] }, { cwd })).toContain('Deleted')
    await expect(lstat(join(cwd, 'link'))).rejects.toThrow()
    expect(await readFile(join(cwd, 'target'), 'utf8')).toBe('ok')
  })
  it('direct replace refuses external symlink targets', async () => {
    const { cwd, outside } = await workspace()
    await writeFile(join(outside, 'file'), 'original')
    await symlink(join(outside, 'file'), join(cwd, 'link'))
    expect(
      await replaceInFileTool.execute(
        { path: 'link', old_string: 'original', new_string: 'changed' },
        { cwd }
      )
    ).toContain('outside')
    expect(await readFile(join(outside, 'file'), 'utf8')).toBe('original')
  })
  it('dangling links fail closed', async () => {
    const { cwd, outside } = await workspace()
    await symlink(join(outside, 'missing'), join(cwd, 'link'))
    expect(
      controller({ mode: 'bypass' }).evaluate(
        writeFileTool,
        { path: 'link', content: 'x' },
        { cwd }
      ).action
    ).toBe('deny')
  })
})
