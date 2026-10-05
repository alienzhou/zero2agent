import { afterEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { Agent } from '../agent.js'
import { runLoop } from '../loop.js'
import { Session } from '../session.js'
import type { CompactionEvent } from '../context-manager.js'
import { createAnthropicClient } from '../llm/index.js'
import { ContextBudget, type ContextRequest } from '../context-budget.js'
import type { Tool } from '../tools/types.js'

vi.mock('../llm/index.js', () => ({
  createAnthropicClient: vi.fn(),
  getModelName: () => 'fixture',
}))

const context = {
  contextWindow: 16000,
  maxOutputTokens: 512,
  summaryTokens: 256,
  safetyTokens: 512,
}
const text = (value: string): Anthropic.Message =>
  ({
    content: [{ type: 'text', text: value, citations: null }],
    stop_reason: 'end_turn',
  }) as Anthropic.Message
const toolReply = (): Anthropic.Message =>
  ({
    content: [{ type: 'tool_use', id: 'side-effect', name: 'write', input: {} }],
    stop_reason: 'tool_use',
  }) as Anthropic.Message

function provider(
  replies: (Anthropic.Message | Error)[],
  summary = 'Keep public API unchanged. File modified once; inspect the saved result before continuing.'
) {
  const requests: ContextRequest[] = []
  const summaries: ContextRequest[] = []
  const client = {
    messages: {
      stream: vi.fn((request: ContextRequest) => {
        requests.push(structuredClone(request))
        const next = replies.shift()
        return {
          on: vi.fn(),
          finalMessage: async () => {
            if (next instanceof Error) throw next
            if (!next) throw new Error('Unexpected main request')
            return next
          },
        }
      }),
      create: vi.fn(async (request: ContextRequest) => {
        summaries.push(structuredClone(request))
        return text(summary)
      }),
    },
  }
  vi.mocked(createAnthropicClient).mockReturnValue(client as unknown as Anthropic)
  return { client, requests, summaries }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())

describe('compaction across the real loop and session', () => {
  it.each(['static', 'loop'])(
    'cancels orphaned background work after a %s one-shot run',
    async entry => {
      const reply = toolReply()
      reply.content.unshift({ type: 'text', text: 'analysis '.repeat(1200), citations: null })
      const tool: Tool = {
        permission: { effect: 'read' },
        name: 'write',
        description: 'write',
        input_schema: { type: 'object', properties: {} },
        execute: async () => 'done',
      }
      const { client } = provider([reply, text('completed')])
      let signal: AbortSignal | undefined
      client.messages.create.mockImplementationOnce(
        (_request, options?: { signal?: AbortSignal }) => {
          signal = options?.signal
          return new Promise<Anthropic.Message>(() => {})
        }
      )
      client.messages.stream
        .mockImplementationOnce(() => ({
          on: vi.fn(),
          finalMessage: async () => reply,
        }))
        .mockImplementationOnce(() => ({
          on: vi.fn(),
          finalMessage: async () => {
            await vi.waitFor(() => expect(signal).toBeDefined())
            return text('completed')
          },
        }))
      const options = { tools: [tool], context }
      expect(
        await (entry === 'static' ? Agent.run('task', options) : runLoop('task', options))
      ).toBe('completed')
      expect(signal?.aborted).toBe(true)
    }
  )

  it('recovers an upstream context rejection without repeating an executed tool', async () => {
    const execute = vi.fn(
      async () => 'changed file once; inspected original content ' + 'r'.repeat(3000)
    )
    const tool: Tool = {
      permission: { effect: 'read' },
      name: 'write',
      description: 'write',
      input_schema: { type: 'object', properties: {} },
      execute,
    }
    const { requests, summaries } = provider([
      toolReply(),
      new Error('400 prompt is too long: maximum context exceeded'),
      text('continued safely'),
    ])
    const agent = new Agent({ tools: [tool], context })
    expect(await agent.run('Keep public API unchanged; modify the file once.')).toBe(
      'continued safely'
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(3)
    expect(summaries).toHaveLength(1)
    expect(JSON.stringify(requests[2].messages)).toContain('File modified once')
    expect(JSON.stringify(agent.getHistory())).toContain('changed file once')
    expect(JSON.stringify(agent.getHistory())).not.toContain('maximum context exceeded')
    const budget = new ContextBudget('fixture', context)
    for (const request of [...requests, ...summaries])
      expect(budget.estimate(request)).toBeLessThanOrEqual(budget.inputLimit)
  })

  it('stops after two real context recoveries when the provider keeps rejecting', async () => {
    const execute = vi.fn(async () => 'saved once ' + 'r'.repeat(1000))
    const tool: Tool = {
      permission: { effect: 'read' },
      name: 'write',
      description: 'write',
      input_schema: { type: 'object', properties: {} },
      execute,
    }
    const overflow = new Error('400 prompt is too long: maximum context exceeded')
    const { requests, summaries } = provider([
      text('first evidence ' + 'a'.repeat(2000)),
      text('second evidence ' + 'b'.repeat(2000)),
      toolReply(),
      overflow,
      overflow,
      overflow,
      text('must not reach a fourth attempt'),
    ])
    // Leave distinct completed prefixes so both recoveries can genuinely reduce context.
    const recover = vi.spyOn(Session.prototype, 'recoverContext')
    const tighten = vi.spyOn(ContextBudget.prototype, 'tighten')
    const agent = new Agent({ tools: [tool], context })
    await agent.run('first constraint')
    await agent.run('second constraint')
    await expect(agent.run('write exactly once')).rejects.toBe(overflow)

    expect(recover).toHaveBeenCalledTimes(2)
    expect(await Promise.all(recover.mock.results.map(result => result.value))).toEqual([
      true,
      true,
    ])
    expect(tighten).toHaveBeenCalledTimes(2)
    expect(requests).toHaveLength(6)
    expect(summaries).toHaveLength(2)
    expect(execute).toHaveBeenCalledTimes(1)
    const budget = new ContextBudget('fixture', context)
    expect(budget.estimate(requests[4])).toBeLessThan(budget.estimate(requests[3]))
    expect(budget.estimate(requests[5])).toBeLessThan(budget.estimate(requests[4]))
    for (const request of requests.slice(0, 4))
      expect(budget.estimate(request)).toBeLessThanOrEqual(budget.inputLimit)
    for (const [index, summary] of summaries.entries()) {
      budget.tighten()
      expect(budget.estimate(summary)).toBeLessThanOrEqual(budget.inputLimit)
      expect(budget.estimate(requests[index + 4])).toBeLessThanOrEqual(budget.inputLimit)
    }
    const history = agent.getHistory()
    expect(history).toHaveLength(8)
    expect(history[5]).toEqual({ role: 'assistant', content: toolReply().content })
    expect(history[6]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'side-effect',
          content: 'saved once ' + 'r'.repeat(1000),
        },
      ],
    })
    expect(history[7].content).toContain('This turn was interrupted')
    expect(JSON.stringify(history)).not.toContain(overflow.message)
  })

  it('keeps mixed tool batches and a new tail when pending background work is adopted after failure', async () => {
    const write = vi.fn(async () => 'file saved exactly once')
    const fail = vi.fn(async () => {
      throw new Error('permission denied')
    })
    const inspect = vi.fn(async () => 'new tail: saved file inspected')
    const tools: Tool[] = [
      {
        permission: { effect: 'read' },
        name: 'write',
        description: 'write',
        input_schema: { type: 'object', properties: {} },
        execute: write,
      },
      {
        permission: { effect: 'read' },
        name: 'fail',
        description: 'fail',
        input_schema: { type: 'object', properties: {} },
        execute: fail,
      },
      {
        permission: { effect: 'read' },
        name: 'inspect',
        description: 'inspect',
        input_schema: { type: 'object', properties: {} },
        execute: inspect,
      },
    ]
    const batch = toolReply()
    batch.content.unshift({
      type: 'text',
      text: 'historical analysis ' + 'a'.repeat(9500),
      citations: null,
    })
    batch.content.push({ type: 'tool_use', id: 'failed-write', name: 'fail', input: {} })
    const tail = toolReply()
    tail.content = [{ type: 'tool_use', id: 'tail-inspect', name: 'inspect', input: {} }]
    const summaryStarted = deferred<AbortSignal | undefined>()
    const summaryReply = deferred<Anthropic.Message>()
    const tailRequest = deferred<void>()
    const failModel = deferred<void>()
    const waiting = deferred<void>()
    const events: CompactionEvent[] = []
    const toolEvents: string[] = []
    const networkError = new Error('network failed after the new tool pair')
    const { client, requests, summaries } = provider([])
    client.messages.create.mockImplementationOnce((request, options?: { signal?: AbortSignal }) => {
      summaries.push(structuredClone(request))
      summaryStarted.resolve(options?.signal)
      return summaryReply.promise
    })
    client.messages.stream.mockImplementation(request => {
      requests.push(structuredClone(request))
      const index = requests.length
      return {
        on: vi.fn(),
        finalMessage: async () => {
          if (index === 1) return batch
          if (index === 2) return tail
          if (index === 3) {
            tailRequest.resolve()
            await failModel.promise
            throw networkError
          }
          if (index === 4) return text('resumed without repeating tools')
          throw new Error('Unexpected main request')
        },
      }
    })
    const agent = new Agent({
      tools,
      context,
      events: {
        onToolEnd: name => {
          toolEvents.push(`ok:${name}`)
        },
        onToolError: name => {
          toolEvents.push(`error:${name}`)
        },
        onCompaction: event => {
          events.push(event)
          if (event.phase === 'waiting') waiting.resolve()
        },
      },
    })
    try {
      const operation = agent.run('Save once, report the failed write, then inspect.')
      const rejection = expect(operation).rejects.toBe(networkError)
      const signal = await summaryStarted.promise
      await tailRequest.promise
      expect(signal).toBeDefined()
      expect(signal?.aborted).toBe(false)
      expect(events.map(event => event.phase)).toEqual(['background'])
      expect(toolEvents).toEqual(['ok:write', 'error:fail', 'ok:inspect'])
      expect(summaries).toHaveLength(1)
      expect(JSON.stringify(summaries[0])).toContain('failed-write')
      expect(JSON.stringify(summaries[0])).toContain('permission denied')
      expect(JSON.stringify(summaries[0])).not.toContain('tail-inspect')
      // The next model request proves both batches were appended while the summary was pending.
      const recorded = structuredClone(requests[2].messages)
      expect(recorded).toEqual([
        { role: 'user', content: 'Save once, report the failed write, then inspect.' },
        { role: 'assistant', content: batch.content },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'side-effect', content: 'file saved exactly once' },
            {
              type: 'tool_result',
              tool_use_id: 'failed-write',
              content: 'Error: permission denied',
              is_error: true,
            },
          ],
        },
        { role: 'assistant', content: tail.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tail-inspect',
              content: 'new tail: saved file inspected',
            },
          ],
        },
      ])
      failModel.resolve()
      await rejection
      const history = agent.getHistory()
      expect(history.slice(0, -1)).toEqual(recorded)
      expect(history[history.length - 1].content).toContain('This turn was interrupted')
      expect(JSON.stringify(history)).not.toContain(networkError.message)

      // Foreground compaction must wait for the existing job, not replace it or consume the new tail.
      const compacting = agent.compact()
      await waiting.promise
      expect(events.map(event => event.phase)).toEqual(['background', 'waiting'])
      expect(client.messages.create).toHaveBeenCalledTimes(1)
      summaryReply.resolve(
        text('Historical batch: file saved once; second write failed with permission denied.')
      )
      expect(await compacting).toBe(true)
      expect(events.map(event => event.phase)).toEqual(['background', 'waiting', 'completed'])
      expect(agent.getHistory()).toEqual(history)
      expect(agent.getContext().slice(-3)).toEqual(history.slice(-3))
      expect(JSON.stringify(agent.getContext())).not.toContain('a'.repeat(9500))
      expect(await agent.run('Continue from the inspection; do not repeat writes.')).toBe(
        'resumed without repeating tools'
      )
      expect(requests[3].messages.slice(-4, -1)).toEqual(history.slice(-3))
      expect(agent.getHistory().slice(0, history.length)).toEqual(history)
      expect(agent.getHistory()).toHaveLength(history.length + 2)
      expect(write).toHaveBeenCalledTimes(1)
      expect(fail).toHaveBeenCalledTimes(1)
      expect(inspect).toHaveBeenCalledTimes(1)
      expect(client.messages.create).toHaveBeenCalledTimes(1)
      const budget = new ContextBudget('fixture', context)
      for (const request of [...requests, ...summaries])
        expect(budget.estimate(request)).toBeLessThanOrEqual(budget.inputLimit)
    } finally {
      failModel.resolve()
      summaryReply.resolve(text('cleanup summary'))
      agent.cancelCompaction()
    }
  })

  it('retains evidence when reactive summarization fails and accepts the next turn', async () => {
    const { client, requests } = provider([
      text('previous result ' + 'r'.repeat(3000)),
      new Error('400 prompt is too long'),
      text('recovered'),
    ])
    const agent = new Agent({ tools: [], context })
    await agent.run('first')
    client.messages.create.mockRejectedValueOnce(new Error('summary service unavailable'))
    await expect(agent.run('second')).rejects.toThrow('compression failed')
    expect(JSON.stringify(agent.getHistory())).toContain('previous result')
    expect(await agent.run('third')).toBe('recovered')
    expect(JSON.stringify(requests[2].messages)).toContain('previous result')
  })

  it('sends the same detached tool schema that was counted before an asynchronous wait', async () => {
    const tool: Tool = {
      permission: { effect: 'read' },
      name: 'write',
      description: 'write',
      input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      execute: async () => 'done',
    }
    const { client, requests } = provider([text('done')])
    let finish!: (value: { input_tokens: number }) => void
    const countTokens = vi
      .fn()
      .mockResolvedValueOnce({ input_tokens: 100 })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve
          })
      )
    Object.assign(client.messages, { countTokens })
    const agent = new Agent({ tools: [tool], context: { ...context, counting: 'provider' } })
    const operation = agent.run('task')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    tool.input_schema.properties.path = { type: 'string', description: 'x'.repeat(50000) }
    finish({ input_tokens: 100 })
    expect(await operation).toBe('done')
    expect(requests[0].tools?.[0].input_schema.properties).toEqual({ path: { type: 'string' } })
  })

  it('does not retry generic network errors as context overflow', async () => {
    const { requests, summaries } = provider([new Error('network unavailable')])
    const agent = new Agent({ tools: [], context })
    await expect(agent.run('task')).rejects.toThrow('network unavailable')
    expect(requests).toHaveLength(1)
    expect(summaries).toHaveLength(0)
  })

  it('uses a detached compacted context while keeping the complete transcript', async () => {
    const { requests } = provider([text('r'.repeat(4000)), text('next answer')])
    const agent = new Agent({ tools: [], context })
    await agent.run('initial constraints')
    const original = agent.getHistory()
    expect(await agent.compact()).toBe(true)
    expect(agent.getHistory()).toEqual(original)
    const snapshot = agent.getContext()
    snapshot[0].content = 'external mutation'
    await agent.run('next')
    expect(JSON.stringify(requests[1].messages)).not.toContain('external mutation')
    expect(JSON.stringify(requests[1].messages)).not.toContain('r'.repeat(4000))
    expect(agent.getHistory()).toHaveLength(4)
  })

  it('rejects run, reset and a second compact during a foreground compact', async () => {
    const { client } = provider([text('r'.repeat(4000)), text('resumed')])
    let finish!: (value: Anthropic.Message) => void
    client.messages.create.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const agent = new Agent({ tools: [], context })
    await agent.run('first')
    const compacting = agent.compact()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await expect(agent.run('parallel')).rejects.toThrow('already running')
    await expect(agent.compact()).rejects.toThrow('already running')
    expect(() => agent.reset()).toThrow('already running')
    finish(text('Prior work summarized.'))
    expect(await compacting).toBe(true)
    expect(await agent.run('after')).toBe('resumed')
  })

  it('rejects manual compaction while a normal model request is running', async () => {
    const { client } = provider([text('unused')])
    let finish!: (message: Anthropic.Message) => void
    client.messages.stream.mockImplementationOnce(() => ({
      on: vi.fn(),
      finalMessage: () =>
        new Promise(resolve => {
          finish = resolve
        }),
    }))
    const agent = new Agent({ tools: [], context })
    const operation = agent.run('first')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await expect(agent.compact()).rejects.toThrow('already running')
    expect(client.messages.create).not.toHaveBeenCalled()
    finish(text('normal answer'))
    expect(await operation).toBe('normal answer')
  })

  it('supports cancellation of foreground compression without leaking a stale summary', async () => {
    const { client } = provider([text('r'.repeat(4000)), text('resumed')])
    let finish!: (value: Anthropic.Message) => void
    client.messages.create.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const agent = new Agent({ tools: [], context })
    await agent.run('first')
    const original = agent.getHistory()
    const compacting = agent.compact()
    const rejection = expect(compacting).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    agent.cancelCompaction()
    await rejection
    finish(text('stale summary'))
    expect(agent.getHistory()).toEqual(original)
    expect(await agent.run('after')).toBe('resumed')
    expect(JSON.stringify(agent.getContext())).not.toContain('stale summary')
  })
})
