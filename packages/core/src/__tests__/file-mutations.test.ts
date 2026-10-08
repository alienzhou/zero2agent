import { describe, expect, it, vi } from 'vitest'
import { executeToolCalls } from '../loop.js'
import { PermissionController } from '../permissions.js'
import type { Tool } from '../tools/types.js'
import type { FileMutationHandler } from '../file-mutations.js'
const call = { type: 'tool_use' as const, id: 'write-1', name: 'write', input: { path: 'a.txt' } }
function tool(execute = vi.fn(async () => 'written')): Tool {
  return {
    name: 'write',
    description: '',
    input_schema: { type: 'object', properties: {} },
    permission: { effect: 'write', paths: ['path'] },
    checkpointPaths: ['path'],
    execute,
  }
}
describe('awaited file mutation control boundary', () => {
  it('waits after permission and before execution, preserving tool result pairing', async () => {
    const order: string[] = []
    const t = tool(
      vi.fn(async () => {
        order.push('effect')
        return 'written'
      })
    )
    const hook: FileMutationHandler = async (info, execute) => {
      expect(info.paths).toEqual(['a.txt'])
      expect(info.sessionId).toBe('session')
      order.push('before')
      const result = await execute()
      order.push('after')
      return result
    }
    const permissions = new PermissionController({
      requestApproval: async request => {
        order.push('approval')
        return { requestId: request.id, decision: 'allow' }
      },
    })
    const result = await executeToolCalls(
      [call],
      [t],
      { cwd: process.cwd() },
      undefined,
      permissions,
      undefined,
      undefined,
      hook,
      'session'
    )
    expect(order).toEqual(['approval', 'before', 'effect', 'after'])
    expect(result[0]).toMatchObject({ tool_use_id: 'write-1', content: 'written' })
  })
  it('does not capture denied calls, read tools or undeclared execute tools', async () => {
    const hook = vi.fn<FileMutationHandler>(async (_info, run) => run()),
      t = tool()
    await executeToolCalls(
      [call],
      [t],
      { cwd: process.cwd() },
      undefined,
      new PermissionController({ mode: 'read-only' }),
      undefined,
      undefined,
      hook
    )
    expect(hook).not.toHaveBeenCalled()
    expect(t.execute).not.toHaveBeenCalled()
    delete t.checkpointPaths
    await executeToolCalls(
      [call],
      [t],
      { cwd: process.cwd() },
      undefined,
      new PermissionController({ mode: 'bypass' }),
      undefined,
      undefined,
      hook
    )
    expect(t.execute).toHaveBeenCalledOnce()
    expect(hook).not.toHaveBeenCalled()
  })
  it('blocks effects on capture failure and returns an actual paired error', async () => {
    const t = tool(),
      hook: FileMutationHandler = async () => {
        throw new Error('storage full')
      }
    const result = await executeToolCalls(
      [call],
      [t],
      { cwd: process.cwd() },
      undefined,
      new PermissionController({ mode: 'bypass' }),
      undefined,
      undefined,
      hook
    )
    expect(t.execute).not.toHaveBeenCalled()
    expect(result[0]).toMatchObject({
      tool_use_id: 'write-1',
      is_error: true,
      content: 'Error: storage full',
    })
  })
  it('rechecks cancellation after awaited capture and settles rather than racing a started mutation', async () => {
    const controller = new AbortController(),
      t = tool()
    const hook: FileMutationHandler = async (_info, run) => {
      controller.abort()
      return run()
    }
    const result = await executeToolCalls(
      [call],
      [t],
      { cwd: process.cwd(), signal: controller.signal },
      undefined,
      new PermissionController({ mode: 'bypass' }),
      undefined,
      undefined,
      hook
    )
    expect(t.execute).not.toHaveBeenCalled()
    expect(result[0].is_error).toBe(true)
  })
})
