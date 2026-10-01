import { afterEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { Agent } from '../agent.js'
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

afterEach(() => vi.restoreAllMocks())

describe('compaction across the real loop and session', () => {
  it('recovers an upstream context rejection without repeating an executed tool', async () => {
    const execute = vi.fn(
      async () => 'changed file once; inspected original content ' + 'r'.repeat(3000)
    )
    const tool: Tool = {
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
