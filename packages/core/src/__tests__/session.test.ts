import { afterEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { Agent } from '../agent.js'
import { runLoop } from '../loop.js'
import { Session } from '../session.js'
import type { Tool } from '../tools/types.js'
import { createAnthropicClient } from '../llm/index.js'

vi.mock('../llm/index.js', () => ({
  createAnthropicClient: vi.fn(),
  getModelName: () => 'test-model',
}))

type Message = Anthropic.MessageParam
type Reply = Anthropic.Message
const text = (value: string): Anthropic.TextBlock => ({
  type: 'text',
  text: value,
  citations: null,
})
const call = (id = 'call-1', name = 'echo'): Anthropic.ToolUseBlock => ({
  type: 'tool_use',
  id,
  name,
  input: { message: 'value' },
})
const reply = (content: Reply['content'], stop: Reply['stop_reason'] = 'end_turn'): Reply =>
  ({ content, stop_reason: stop }) as Reply
const answer = (value: string) => reply([text(value)])
const echo: Tool = {
  name: 'echo',
  description: 'echo',
  input_schema: { type: 'object', properties: {} },
  execute: async () => 'observed-result',
}

/** Snapshot at the transport boundary: later array mutations must not satisfy earlier assertions. */
function transport(...outcomes: Array<Reply | Error | (() => Promise<Reply>)>) {
  const requests: Message[][] = []
  const stream = vi.fn((params: { messages: Message[] }) => {
    requests.push(structuredClone(params.messages))
    const next = outcomes.shift()
    return {
      on: vi.fn(),
      finalMessage: async () => {
        if (next instanceof Error) throw next
        if (typeof next === 'function') return next()
        if (!next) throw new Error('Unexpected model request')
        return next
      },
    }
  })
  vi.mocked(createAnthropicClient).mockReturnValue({ messages: { stream } } as unknown as Anthropic)
  return requests
}

function expectPaired(history: Message[]) {
  for (let i = 0; i < history.length; i++) {
    const message = history[i]
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    const calls = message.content.filter(block => block.type === 'tool_use')
    if (!calls.length) continue
    const next = history[i + 1]
    expect(next?.role).toBe('user')
    expect(Array.isArray(next?.content)).toBe(true)
    const results = next.content as Anthropic.ToolResultBlockParam[]
    expect(results.map(result => result.tool_use_id)).toEqual(calls.map(tool => tool.id))
  }
}

afterEach(() => vi.restoreAllMocks())

describe('in-memory sessions', () => {
  it('carries the entire prior user and assistant turn into the next request', async () => {
    const requests = transport(answer('first answer'), answer('second answer'))
    const agent = new Agent({ tools: [] })
    await agent.run('first question')
    await agent.run('follow up')
    expect(requests[0]).toEqual([{ role: 'user', content: 'first question' }])
    expect(requests[1]).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: [text('first answer')] },
      { role: 'user', content: 'follow up' },
    ])
    expect(agent.getHistory()).toHaveLength(4)
  })

  it('preserves multiple tool calls, their results and the final answer across turns', async () => {
    const requests = transport(
      reply([text('checking'), call('a'), call('b')], 'tool_use'),
      answer('done'),
      answer('next')
    )
    const agent = new Agent({ tools: [echo] })
    await agent.run('inspect')
    await agent.run('continue')
    expect(requests[2]).toHaveLength(5)
    expect(requests[2][2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'observed-result' },
      { type: 'tool_result', tool_use_id: 'b', content: 'observed-result' },
    ])
    expectPaired(agent.getHistory())
  })

  it('isolates Agent instances', async () => {
    const requests = transport(answer('a'), answer('b'))
    await new Agent({ tools: [] }).run('alice')
    await new Agent({ tools: [] }).run('bob')
    expect(requests[1]).toEqual([{ role: 'user', content: 'bob' }])
  })

  it('keeps static Agent.run and default runLoop one-shot', async () => {
    const requests = transport(answer('a'), answer('b'), answer('c'), answer('d'))
    await Agent.run('a', { tools: [] })
    await Agent.run('b', { tools: [] })
    await runLoop('c', { tools: [] })
    await runLoop('d', { tools: [] })
    expect(requests.map(request => request.length)).toEqual([1, 1, 1, 1])
  })

  it('allows explicit session reuse with runLoop', async () => {
    const requests = transport(answer('a'), answer('b'))
    const session = new Session()
    await runLoop('a', { session, tools: [] })
    await runLoop('b', { session, tools: [] })
    expect(requests[1]).toHaveLength(3)
  })

  it('reset removes history but retains tool configuration and cwd', async () => {
    const execute = vi.fn(async () => 'ok')
    const requests = transport(answer('old'), reply([call()], 'tool_use'), answer('fresh'))
    const agent = new Agent({ cwd: '/tmp/session-project', tools: [{ ...echo, execute }] })
    await agent.run('old')
    agent.reset()
    expect(agent.getHistory()).toEqual([])
    await agent.run('new')
    expect(requests[1]).toEqual([{ role: 'user', content: 'new' }])
    expect(execute).toHaveBeenCalledWith({ message: 'value' }, { cwd: '/tmp/session-project' })
  })

  it('returns a deep snapshot, including nested tool inputs', async () => {
    transport(reply([call()], 'tool_use'), answer('done'))
    const agent = new Agent({ tools: [echo] })
    await agent.run('inspect')
    const snapshot = agent.getHistory()
    const block = (snapshot[1].content as Anthropic.ToolUseBlock[])[0]
    ;(block.input as Record<string, unknown>).message = 'tampered'
    snapshot.push({ role: 'user', content: 'injected' })
    expect(JSON.stringify(agent.getHistory())).not.toMatch(/tampered|injected/)
  })

  it('rejects parallel turns and reset while running, then releases the lock', async () => {
    let finish!: (value: Reply) => void
    transport(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
      answer('next')
    )
    const agent = new Agent({ tools: [] })
    const pending = agent.run('first')
    await expect(agent.run('second')).rejects.toThrow('already running')
    expect(() => agent.reset()).toThrow('already running')
    expect(agent.getHistory()).toEqual([])
    finish(answer('first done'))
    await pending
    await agent.run('next')
    expect(agent.getHistory()).toHaveLength(4)
  })

  it('rejects blank input without calling the model or changing history', async () => {
    const requests = transport(answer('ok'))
    const agent = new Agent({ tools: [] })
    await expect(agent.run(' \n ')).rejects.toThrow('empty')
    expect(agent.getHistory()).toEqual([])
    expect(requests).toHaveLength(0)
    await agent.run('valid')
  })

  it('pins default cwd when the Agent is constructed', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/tmp/project-a')
    const execute = vi.fn(async () => 'ok')
    transport(reply([call()], 'tool_use'), answer('done'))
    const agent = new Agent({ tools: [{ ...echo, execute }] })
    cwd.mockReturnValue('/tmp/project-b')
    await agent.run('inspect')
    expect(execute).toHaveBeenCalledWith(expect.anything(), { cwd: '/tmp/project-a' })
  })
})

describe('failed and incomplete turns', () => {
  it('retains completed side-effect evidence when the next model stream fails', async () => {
    const execute = vi.fn(async () => 'file changed')
    const requests = transport(
      reply([call()], 'tool_use'),
      new Error('transport-secret'),
      answer('recovered')
    )
    const agent = new Agent({ tools: [{ ...echo, execute }] })
    await expect(agent.run('change file')).rejects.toThrow('transport-secret')
    expect(execute).toHaveBeenCalledTimes(1)
    expectPaired(agent.getHistory())
    expect(JSON.stringify(agent.getHistory())).toContain('file changed')
    expect(JSON.stringify(agent.getHistory())).not.toContain('transport-secret')
    expect(agent.getHistory().at(-1)?.content).toMatch(/\[Harness\].*interrupted/)
    await agent.run('what happened?')
    expect(requests[2]).toHaveLength(5)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('releases a session after an aborted stream and allows reset', async () => {
    transport(new DOMException('aborted', 'AbortError'), answer('fresh'))
    const agent = new Agent({ tools: [] })
    await expect(agent.run('a')).rejects.toThrow('aborted')
    agent.reset()
    await agent.run('b')
    expect(agent.getHistory()).toHaveLength(2)
  })

  it('matches unknown and throwing tools with is_error results even if observers throw', async () => {
    transport(reply([call('a', 'missing'), call('b', 'echo')], 'tool_use'), answer('done'))
    const fail = () => {
      throw new Error('observer failed')
    }
    const agent = new Agent({
      tools: [
        {
          ...echo,
          execute: async () => {
            throw 'tool failure'
          },
        },
      ],
      events: { onToolStart: fail, onToolEnd: fail, onToolError: fail },
    })
    await agent.run('try')
    const results = agent.getHistory()[2].content as Anthropic.ToolResultBlockParam[]
    expect(results.every(result => result.is_error)).toBe(true)
    expect(results[1].content).toBe('Error: tool failure')
    expectPaired(agent.getHistory())
  })

  it('does not relabel a successful tool if its display observer throws', async () => {
    transport(reply([call()], 'tool_use'), answer('done'))
    const agent = new Agent({
      tools: [echo],
      events: {
        onToolEnd: () => {
          throw new Error('UI')
        },
      },
    })
    await agent.run('go')
    expect(agent.getHistory()[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'call-1', content: 'observed-result' },
    ])
  })

  it('never executes truncated tool arguments, and pairs every skipped call', async () => {
    const execute = vi.fn(async () => 'unsafe')
    transport(reply([text('partial'), call('a'), call('b')], 'max_tokens'), answer('next'))
    const agent = new Agent({ tools: [{ ...echo, execute }] })
    expect(await agent.run('go')).toBe('partial')
    expect(execute).not.toHaveBeenCalled()
    expectPaired(agent.getHistory())
    const results = agent.getHistory()[2].content as Anthropic.ToolResultBlockParam[]
    expect(
      results.every(result => result.is_error && String(result.content).includes('truncated'))
    ).toBe(true)
    await agent.run('continue')
  })

  it('keeps partial text with a Harness truncation notice', async () => {
    transport(reply([text('partial')], 'max_tokens'))
    const agent = new Agent({ tools: [] })
    expect(await agent.run('long')).toBe('partial')
    expect(agent.getHistory()[1].content).toEqual([text('partial')])
    expect(agent.getHistory().at(-1)?.content).toContain('truncated')
  })

  it('ends the iteration limit with paired tool results and accepts a new turn', async () => {
    const requests = transport(
      ...Array.from({ length: 20 }, (_, i) => reply([call(`c${i}`)], 'tool_use')),
      answer('next')
    )
    const agent = new Agent({ tools: [echo] })
    expect(await agent.run('loop')).toContain('Maximum iterations')
    expectPaired(agent.getHistory())
    expect(agent.getHistory().at(-1)?.content).toContain('[Harness]')
    await agent.run('next')
    expect(requests).toHaveLength(21)
  })

  it.each(['stop_sequence', 'refusal'] as const)(
    'stores a %s response as a completed turn',
    async stop => {
      transport(reply([text('stopped')], stop))
      const agent = new Agent({ tools: [] })
      expect(await agent.run('go')).toBe('stopped')
      expect(agent.getHistory()).toHaveLength(2)
    }
  )

  it('rejects unsupported stop reasons without leaving a partial assistant response', async () => {
    transport(reply([text('unfinished')], null), answer('ok'))
    const agent = new Agent({ tools: [] })
    await expect(agent.run('go')).rejects.toThrow('Unsupported')
    expect(JSON.stringify(agent.getHistory())).not.toContain('unfinished')
    await agent.run('again')
  })

  it('does not execute calls from an end_turn response', async () => {
    const execute = vi.fn(async () => 'unsafe')
    transport(reply([call()], 'end_turn'))
    const agent = new Agent({ tools: [{ ...echo, execute }] })
    await agent.run('go')
    expect(execute).not.toHaveBeenCalled()
    expectPaired(agent.getHistory())
  })
})
