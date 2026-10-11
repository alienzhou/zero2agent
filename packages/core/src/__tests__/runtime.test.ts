import { afterEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { messageStream } from './helpers/message-stream.js'
import { Agent } from '../agent.js'
import { runLoop } from '../loop.js'
import { Session } from '../session.js'
import { TurnCancelledError, type RuntimeEvent } from '../runtime.js'
import { createAnthropicClient } from '../llm/index.js'
import type { Tool } from '../tools/types.js'
import type { ApprovalRequest } from '../permissions.js'

vi.mock('../llm/index.js', () => ({
  createAnthropicClient: vi.fn(),
  getModelName: () => 'claude-sonnet-4-20250514',
}))

const answer = (text = 'done'): Anthropic.Message =>
  ({
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
  }) as Anthropic.Message
const calls = (...names: string[]): Anthropic.Message =>
  ({
    content: names.map((name, i) => ({
      type: 'tool_use',
      id: `call-${i}`,
      name,
      input: { value: 'original' },
    })),
    stop_reason: 'tool_use',
  }) as Anthropic.Message
const echo: Tool = {
  name: 'echo',
  description: '',
  permission: { effect: 'read' },
  input_schema: { type: 'object', properties: {} },
  execute: async () => 'recorded evidence',
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
function transport(...replies: Array<Anthropic.Message | Promise<Anthropic.Message>>) {
  const texts: Array<(text: string) => void> = []
  const stream = vi.fn((_request: unknown, _options?: { signal?: AbortSignal }) =>
    messageStream(
      async () => {
        const next = replies.shift()
        if (!next) throw new Error('Unexpected model request')
        return next
      },
      listener => texts.push(listener)
    )
  )
  const client = { messages: { stream, create: vi.fn(), countTokens: vi.fn() } }
  vi.mocked(createAnthropicClient).mockReturnValue(client as unknown as Anthropic)
  return { stream, texts, client }
}
function results(agent: Agent) {
  return agent
    .getHistory()
    .flatMap(message =>
      Array.isArray(message.content)
        ? message.content.filter(block => block.type === 'tool_result')
        : []
    ) as Anthropic.ToolResultBlockParam[]
}

afterEach(() => vi.restoreAllMocks())

describe('runtime events', () => {
  it('gives every turn an identity and monotonic sequence, and separates notices from model text', async () => {
    const partial = answer('partial')
    partial.stop_reason = 'max_tokens'
    const done = deferred<Anthropic.Message>()
    const { texts } = transport(done.promise, partial)
    const events: RuntimeEvent[] = []
    const legacy = vi.fn()
    const agent = new Agent({
      tools: [],
      events: { onEvent: event => events.push(event), onText: legacy },
    })
    const pending = agent.run('first')
    await vi.waitFor(() => expect(texts).toHaveLength(1))
    texts[0]('fragment')
    done.resolve(answer())
    await pending
    const first = [...events]
    expect(first[0].type).toBe('turn-start')
    expect(first.at(-1)).toMatchObject({ type: 'turn-end', status: 'completed' })
    expect(first.some(event => event.type === 'phase' && event.phase === 'requesting')).toBe(true)
    expect(first.some(event => event.type === 'phase' && event.phase === 'streaming')).toBe(true)
    expect(first.filter(event => event.type === 'text-delta')).toMatchObject([{ text: 'fragment' }])
    texts[0]('late fragment')
    expect(events).toEqual(first)
    await agent.run('second')
    const second = events.slice(first.length)
    expect(second[0].turnId).not.toBe(first[0].turnId)
    for (const batch of [first, second]) {
      expect(new Set(batch.map(event => event.turnId)).size).toBe(1)
      expect(batch.map(event => event.seq)).toEqual(batch.map((_, i) => i + 1))
    }
    expect(second.filter(event => event.type === 'notice')).toMatchObject([
      { text: expect.stringContaining('truncated') },
    ])
    expect(second.filter(event => event.type === 'text-delta')).toEqual([])
    expect(legacy).toHaveBeenCalledWith(expect.stringContaining('[Harness]'))
    expect(legacy).not.toHaveBeenCalledWith('late fragment')
  })

  it('reports distinct tool calls, policy denial, missing tools and Error-prefixed output', async () => {
    transport(calls('echo', 'missing', 'denied', 'bad'), answer())
    const events: RuntimeEvent[] = []
    const agent = new Agent({
      tools: [
        echo,
        { ...echo, name: 'denied' },
        { ...echo, name: 'bad', execute: async () => 'Error: missing file' },
      ],
      permissions: { rules: [{ tool: 'denied', action: 'deny' }] },
      events: { onEvent: event => events.push(event) },
    })
    await agent.run('inspect')
    const terminal = events.filter(
      event =>
        event.type === 'tool-state' && ['completed', 'denied', 'error'].includes(event.status)
    )
    expect(terminal).toMatchObject([
      {
        toolCallId: 'call-0',
        status: 'completed',
        output: 'recorded evidence',
        durationMs: expect.any(Number),
      },
      { toolCallId: 'call-1', status: 'error' },
      { toolCallId: 'call-2', status: 'denied' },
      { toolCallId: 'call-3', status: 'error', output: 'Error: missing file' },
    ])
    expect(results(agent).map(result => !!result.is_error)).toEqual([false, true, true, true])
  })

  it('isolates mutations and rejected observers from execution and the committed transcript', async () => {
    transport(calls('echo'), answer())
    const execute = vi.fn(async input => {
      expect(input.value).toBe('original')
      return 'ok'
    })
    const agent = new Agent({
      tools: [{ ...echo, execute }],
      events: {
        onEvent: async event => {
          if (event.type === 'tool-state' && event.input) event.input.value = 'tampered'
          throw new Error('UI failed')
        },
      },
    })
    expect(await agent.run('go')).toBe('done')
    await new Promise(resolve => setImmediate(resolve))
    expect(JSON.stringify(agent.getHistory())).not.toContain('tampered')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('pairs skipped truncated calls and reports why they were not executed', async () => {
    const truncated = calls('echo', 'echo')
    truncated.stop_reason = 'max_tokens'
    transport(truncated)
    const execute = vi.fn()
    const events: RuntimeEvent[] = []
    const agent = new Agent({
      tools: [{ ...echo, execute }],
      events: { onEvent: event => events.push(event) },
    })
    await agent.run('go')
    expect(execute).not.toHaveBeenCalled()
    expect(results(agent)).toHaveLength(2)
    expect(events.filter(event => event.type === 'tool-state')).toMatchObject([
      { toolCallId: 'call-0', status: 'error', reason: expect.stringContaining('truncated') },
      { toolCallId: 'call-1', status: 'error', reason: expect.stringContaining('truncated') },
    ])
  })
})

describe('whole-turn cancellation', () => {
  it('aborts model transport, ignores late text and permits a fresh turn', async () => {
    const done = deferred<Anthropic.Message>()
    const { stream, texts } = transport(done.promise, answer('fresh'))
    const events: RuntimeEvent[] = []
    const agent = new Agent({ tools: [], events: { onEvent: event => events.push(event) } })
    expect(agent.cancelTurn()).toBe(false)
    const pending = agent.run('wait')
    const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
    await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce())
    const signal = stream.mock.calls[0][1]?.signal
    expect(agent.cancelTurn()).toBe(true)
    await rejection
    expect(signal?.aborted).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'turn-end', status: 'cancelled' })
    const length = events.length
    texts[0]('late text')
    done.resolve(answer('late answer'))
    await Promise.resolve()
    expect(events).toHaveLength(length)
    expect(JSON.stringify(agent.getHistory())).not.toContain('late')
    expect(agent.cancelTurn()).toBe(false)
    expect(await agent.run('next')).toBe('fresh')
  })

  it('rejects a pre-aborted run without creating a request', async () => {
    const { stream } = transport()
    const controller = new AbortController()
    controller.abort()
    await expect(runLoop('go', { tools: [], signal: controller.signal })).rejects.toBeInstanceOf(
      TurnCancelledError
    )
    expect(stream).not.toHaveBeenCalled()
  })

  it('cancels pending approval, pairs the entire batch and never starts later calls', async () => {
    const { stream } = transport(calls('echo', 'echo'))
    let request: ApprovalRequest | undefined
    const approval = deferred<{ requestId: string; decision: 'allow' }>()
    const execute = vi.fn()
    const events: RuntimeEvent[] = []
    const agent = new Agent({
      tools: [{ ...echo, permission: { effect: 'write' }, execute }],
      permissions: {
        requestApproval: current => {
          request = current
          return approval.promise
        },
      },
      events: { onEvent: event => events.push(event) },
    })
    const pending = agent.run('write')
    const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
    await vi.waitFor(() => expect(request).toBeDefined())
    expect(events.some(event => event.type === 'tool-state' && event.status === 'approval')).toBe(
      true
    )
    agent.cancelTurn()
    await rejection
    expect(request!.signal.aborted).toBe(true)
    approval.resolve({ requestId: request!.id, decision: 'allow' })
    await Promise.resolve()
    expect(execute).not.toHaveBeenCalled()
    expect(stream).toHaveBeenCalledTimes(1)
    expect(results(agent).map(result => result.tool_use_id)).toEqual(['call-0', 'call-1'])
    expect(
      events.filter(event => event.type === 'tool-state' && event.status === 'cancelled')
    ).toHaveLength(2)
  })

  it('retains a non-cooperative tool result and holds the session until it truly settles', async () => {
    const { stream } = transport(calls('echo', 'echo'), answer('next'))
    const completed = deferred<string>()
    const execute = vi.fn(() => completed.promise)
    const events: RuntimeEvent[] = []
    const agent = new Agent({
      tools: [{ ...echo, execute }],
      events: { onEvent: event => events.push(event) },
    })
    const pending = agent.run('change')
    const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    agent.cancelTurn()
    await expect(agent.run('overlap')).rejects.toThrow('already running')
    await expect(agent.compact()).rejects.toThrow('already running')
    expect(() => agent.reset()).toThrow('already running')
    expect(agent.getHistory()).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'phase', phase: 'cancelling' })
    completed.resolve('file changed once')
    await rejection
    expect(results(agent)).toMatchObject([
      { tool_use_id: 'call-0', content: 'file changed once' },
      { tool_use_id: 'call-1', is_error: true },
    ])
    expect(
      events.find(
        event =>
          event.type === 'tool-state' &&
          event.toolCallId === 'call-0' &&
          event.status === 'completed'
      )
    ).toMatchObject({ output: 'file changed once' })
    expect(execute).toHaveBeenCalledOnce()
    expect(stream).toHaveBeenCalledOnce()
    expect(await agent.run('inspect')).toBe('next')
  })

  it('accepts external runLoop cancellation during a cooperative tool', async () => {
    transport(calls('echo', 'echo'))
    const controller = new AbortController()
    const entered = deferred<void>()
    const execute = vi.fn(
      (_input, ctx) =>
        new Promise<string>((_resolve, reject) => {
          ctx.signal!.addEventListener('abort', () => reject(new Error('stopped')), { once: true })
          entered.resolve()
        })
    )
    const session = new Session()
    const pending = runLoop('go', {
      session,
      signal: controller.signal,
      tools: [{ ...echo, execute }],
    })
    const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
    await entered.promise
    controller.abort()
    await rejection
    expect(execute).toHaveBeenCalledOnce()
    expect(JSON.stringify(session.getHistory())).toContain('call-1')
    expect(() => session.reset()).not.toThrow()
  })

  it('cancels API token counting before sending any model request', async () => {
    const { stream, client } = transport()
    let signal: AbortSignal | undefined
    client.messages.countTokens.mockImplementation((_input, options) => {
      signal = options.signal
      return new Promise(() => {})
    })
    const agent = new Agent({ tools: [], context: { counting: 'provider' } })
    const pending = agent.run('count first')
    const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
    await vi.waitFor(() => expect(signal).toBeDefined())
    agent.cancelTurn()
    await rejection
    expect(signal!.aborted).toBe(true)
    expect(stream).not.toHaveBeenCalled()
    agent.reset()
  })

  it('cancels a manual summary, rejects late completion and preserves history', async () => {
    const { client } = transport(answer('earlier evidence '.repeat(300)))
    const agent = new Agent({ tools: [] })
    await agent.run('first')
    const before = agent.getHistory()
    let signal: AbortSignal | undefined
    const late = deferred<Anthropic.Message>()
    client.messages.create.mockImplementation((_request, options) => {
      signal = options.signal
      return late.promise
    })
    const pending = agent.compact()
    const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
    await vi.waitFor(() => expect(signal).toBeDefined())
    agent.cancelTurn()
    await rejection
    expect(signal!.aborted).toBe(true)
    late.resolve(answer('stale summary'))
    await new Promise(resolve => setImmediate(resolve))
    expect(agent.getHistory()).toEqual(before)
    expect(JSON.stringify(agent.getContext())).not.toContain('stale summary')
    agent.reset()
  })

  it('honors cancellation from a final Harness notice observer', async () => {
    const truncated = answer('partial')
    truncated.stop_reason = 'max_tokens'
    transport(truncated)
    const events: RuntimeEvent[] = []
    const agent = new Agent({
      tools: [],
      events: {
        onEvent: event => {
          events.push(event)
          if (event.type === 'notice') agent.cancelTurn()
        },
      },
    })
    await expect(agent.run('go')).rejects.toBeInstanceOf(TurnCancelledError)
    expect(events.at(-1)).toMatchObject({ type: 'turn-end', status: 'cancelled' })
  })

  it('does not interpret arbitrary tool text as a terminal cancellation receipt', async () => {
    transport(calls('echo'), answer())
    const events: RuntimeEvent[] = []
    const agent = new Agent({
      tools: [{ ...echo, execute: async () => 'Status: cancelled by user' }],
      events: { onEvent: event => events.push(event) },
    })
    await agent.run('go')
    expect(events.find(event => event.type === 'tool-state' && event.output)).toMatchObject({
      status: 'completed',
    })
    expect(results(agent)[0].is_error).toBeUndefined()
  })

  it('cancels from turn-start synchronously without starting preparation', async () => {
    const { stream } = transport()
    const events: RuntimeEvent[] = []
    const agent = new Agent({
      tools: [],
      events: {
        onEvent: event => {
          events.push(event)
          if (event.type === 'turn-start') agent.cancelTurn()
        },
      },
    })
    await expect(agent.run('go')).rejects.toBeInstanceOf(TurnCancelledError)
    expect(stream).not.toHaveBeenCalled()
    expect(events.map(event => event.type)).toEqual(['turn-start', 'phase', 'turn-end'])
  })
})
