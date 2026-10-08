import { afterEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { messageStream } from './helpers/message-stream.js'
import { Agent } from '../agent.js'
import { runLoop } from '../loop.js'
import { Session } from '../session.js'
import type { Tool } from '../tools/types.js'
import { createAnthropicClient } from '../llm/index.js'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  registerBackgroundProcess,
  unregisterBackgroundProcess,
  listBackgroundProcesses,
} from '../tools/process-registry.js'

vi.mock('../llm/index.js', () => ({
  createAnthropicClient: vi.fn(),
  getModelName: (config: { model?: string }) => config.model ?? 'claude-sonnet-4-20250514',
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
  permission: { effect: 'read' },
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
    return messageStream(async () => {
      if (next instanceof Error) throw next
      if (typeof next === 'function') return next()
      if (!next) throw new Error('Unexpected model request')
      return next
    })
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
  it('compacts working context without changing full history and returns detached snapshots', async () => {
    const requests = transport(
      answer('historical evidence '.repeat(150)),
      answer('follow-up answer')
    )
    const agent = new Agent({ tools: [], context: { maxInputTokens: 12_000 } })
    await agent.run('original task')
    const client = vi.mocked(createAnthropicClient).mock.results.at(-1)!.value as Anthropic
    const create = vi.fn(async () => answer('Summary: verified historical evidence retained.'))
    client.messages.create = create as unknown as Anthropic['messages']['create']
    const history = agent.getHistory()
    expect(await agent.compact()).toBe(true)
    expect(agent.getHistory()).toEqual(history)
    expect(agent.getContext()).toContainEqual({ role: 'user', content: 'original task' })
    expect(JSON.stringify(agent.getContext())).toContain(
      'Summary: verified historical evidence retained.'
    )
    expect(JSON.stringify(agent.getContext())).not.toContain('historical evidence '.repeat(150))
    const snapshot = agent.getContext()
    snapshot[0].content = 'tampered context'
    expect(JSON.stringify(agent.getContext())).not.toContain('tampered context')
    expect(create).toHaveBeenCalledTimes(1)
    const summaryRequest = create.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(summaryRequest[0]).not.toHaveProperty('tools')
    expect(summaryRequest[0]).not.toHaveProperty('stream')
    await agent.run('latest user intent')
    expect(JSON.stringify(requests[1])).toContain('Summary: verified historical evidence retained.')
    expect(requests[1].at(-1)).toEqual({ role: 'user', content: 'latest user intent' })
    expect(agent.getHistory()).toHaveLength(4)
    agent.reset()
    expect(agent.getContext()).toEqual([])
    expect(agent.getHistory()).toEqual([])
  })

  it('keeps the previously committed snapshot while a later turn is running', async () => {
    let finish!: (value: Reply) => void
    transport(
      answer('first answer'),
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const agent = new Agent({ tools: [] })
    await agent.run('first')
    const committed = agent.getHistory()
    const pending = agent.run('second')
    expect(agent.getHistory()).toEqual(committed)
    const snapshot = agent.getHistory()
    snapshot[0].content = 'tampered'
    expect(agent.getHistory()).toEqual(committed)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish(answer('second answer'))
    await pending
    expect(agent.getHistory()).toHaveLength(4)
  })

  it('preserves model config, system prompt and events after reset', async () => {
    transport(answer('old'), reply([call()], 'tool_use'), answer('new'))
    const config = {
      apiKey: 'test-placeholder',
      baseURL: 'http://127.0.0.1:9',
      model: 'custom-model',
    }
    const onToolEnd = vi.fn()
    const agent = new Agent({
      config,
      context: { contextWindow: 200_000 },
      systemPrompt: 'Keep this instruction',
      tools: [echo],
      events: { onToolEnd },
    })
    await agent.run('first')
    agent.reset()
    await agent.run('second')
    expect(createAnthropicClient).toHaveBeenLastCalledWith(config)
    const client = vi.mocked(createAnthropicClient).mock.results.at(-1)!.value
    expect(client.messages.stream).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'custom-model',
        system: 'Keep this instruction',
      }),
      { signal: expect.any(AbortSignal), maxRetries: 0, timeout: 120000 }
    )
    expect(onToolEnd).toHaveBeenCalledWith('echo', 'observed-result', expect.any(Number))
  })

  it('does not stop a registered background process or delete its log on reset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'z2a-session-reset-'))
    const logPath = join(dir, 'background.log')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      await writeFile(logPath, 'existing output')
      const entry = {
        pid: child.pid!,
        command: 'test background',
        logPath,
        startAt: 1,
        skippedAt: 2,
      }
      registerBackgroundProcess(entry)
      transport(answer('old'))
      const agent = new Agent({ tools: [] })
      await agent.run('first')
      agent.reset()
      expect(agent.getHistory()).toEqual([])
      expect(listBackgroundProcesses()).toContainEqual(entry)
      expect(() => process.kill(child.pid!, 0)).not.toThrow()
      expect(await readFile(logPath, 'utf8')).toBe('existing output')
    } finally {
      if (child.pid) unregisterBackgroundProcess(child.pid)
      if (child.pid && child.exitCode === null) {
        child.kill('SIGTERM')
        await exited
      }
      await rm(dir, { recursive: true, force: true })
    }
  })

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
    expect(execute).toHaveBeenCalledWith(
      { message: 'value' },
      { cwd: '/tmp/session-project', signal: expect.any(AbortSignal) }
    )
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
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
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
    expect(execute).toHaveBeenCalledWith(expect.anything(), {
      cwd: '/tmp/project-a',
      signal: expect.any(AbortSignal),
    })
  })
})

describe('failed and incomplete turns', () => {
  it('continues after two failed turns without replaying tools or losing completed messages', async () => {
    const execute = vi.fn(async () => 'saved once')
    const requests = transport(
      reply([call()], 'tool_use'),
      new Error('first failure'),
      new Error('second failure'),
      answer('recovered')
    )
    const agent = new Agent({ tools: [{ ...echo, execute }] })
    await expect(agent.run('change')).rejects.toThrow('first failure')
    await expect(agent.run('retry the conversation')).rejects.toThrow('second failure')
    expect(await agent.run('inspect current state')).toBe('recovered')
    expect(execute).toHaveBeenCalledTimes(1)
    expectPaired(agent.getHistory())
    expect(requests[3]).toHaveLength(7)
    expect(requests[3][0].content).toBe('change')
    expect(requests[3][4].content).toBe('retry the conversation')
    expect(requests[3][6].content).toBe('inspect current state')
  })

  it('rejects a tool_use stop without calls and keeps the next turn usable', async () => {
    transport(reply([text('incomplete protocol')], 'tool_use'), answer('recovered'))
    const agent = new Agent({ tools: [] })
    await expect(agent.run('first')).rejects.toThrow('without any tool calls')
    expect(JSON.stringify(agent.getHistory())).not.toContain('incomplete protocol')
    expect(await agent.run('second')).toBe('recovered')
    expectPaired(agent.getHistory())
  })

  it('records a visible host notice when the model returns no content', async () => {
    transport(reply([]), answer('next'))
    const onText = vi.fn()
    const agent = new Agent({ tools: [], events: { onText } })
    expect(await agent.run('first')).toContain('[Harness] Model returned no content.')
    expect(onText).toHaveBeenCalledWith(expect.stringContaining('Model returned no content'))
    expect(await agent.run('second')).toBe('next')
    expect(agent.getHistory()[1].content).toContain('Model returned no content')
  })

  it.each([
    Object.create(null),
    {
      toString: () => {
        throw new Error('broken formatter')
      },
    },
    Object.defineProperty(new Error(), 'message', {
      get: () => {
        throw new Error('broken getter')
      },
    }),
  ])('keeps all batch results when a thrown value cannot be formatted (%#)', async thrown => {
    const execute = vi.fn(async () => {
      throw thrown
    })
    transport(reply([call('a'), call('b', 'fail'), call('c')], 'tool_use'), answer('done'))
    const agent = new Agent({ tools: [echo, { ...echo, name: 'fail', execute }] })
    await agent.run('try batch')
    expectPaired(agent.getHistory())
    const results = agent.getHistory()[2].content as Anthropic.ToolResultBlockParam[]
    expect(results).toHaveLength(3)
    expect(results[0].content).toBe('observed-result')
    expect(results[1]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('unprintable'),
    })
    expect(results[2].content).toBe('observed-result')
  })

  it('isolates input mutations by observers and tools from both execution and history', async () => {
    transport(reply([call()], 'tool_use'), answer('done'))
    let observed: unknown
    const execute = vi.fn(async (input: Record<string, unknown>) => {
      observed = input.message
      input.message = 'tool mutation'
      return 'ok'
    })
    const agent = new Agent({
      tools: [{ ...echo, execute }],
      events: {
        onToolStart: (_name, input) => {
          input.message = 'observer mutation'
        },
      },
    })
    await agent.run('inspect')
    const block = (agent.getHistory()[1].content as Anthropic.ToolUseBlock[])[0]
    expect(block.input).toEqual({ message: 'value' })
    expect(observed).toBe('value')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('consumes rejected async observer promises without changing tool results', async () => {
    transport(reply([call()], 'tool_use'), answer('done'))
    const agent = new Agent({
      tools: [echo],
      events: {
        onToolEnd: async () => {
          throw new Error('async UI failure')
        },
      },
    })
    await agent.run('inspect')
    await new Promise(resolve => setImmediate(resolve))
    expect(agent.getHistory()[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'call-1', content: 'observed-result' },
    ])
  })

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

  it('shows streamed fragments to the UI without committing them after a stream failure', async () => {
    const onText = vi.fn()
    vi.mocked(createAnthropicClient).mockReturnValue({
      messages: {
        stream: () => ({
          on: (event: string, callback: (text: string) => void) => {
            if (event === 'text') callback('unfinished-fragment')
          },
          finalMessage: async () => {
            throw new Error('connection lost')
          },
        }),
      },
    } as unknown as Anthropic)
    const agent = new Agent({ tools: [], events: { onText } })
    await expect(agent.run('inspect')).rejects.toThrow('connection lost')
    expect(onText).toHaveBeenCalledWith('unfinished-fragment')
    expect(JSON.stringify(agent.getHistory())).not.toContain('unfinished-fragment')
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
    const onText = vi.fn()
    const agent = new Agent({ tools: [], events: { onText } })
    expect(await agent.run('long')).toBe('partial')
    expect(agent.getHistory()[1].content).toEqual([text('partial')])
    expect(agent.getHistory().at(-1)?.content).toContain('truncated')
    expect(onText).toHaveBeenCalledWith(expect.stringContaining('[Harness]'))
  })

  it('ends the iteration limit with paired tool results and accepts a new turn', async () => {
    const requests = transport(
      ...Array.from({ length: 20 }, (_, i) => reply([call(`c${i}`)], 'tool_use')),
      answer('next')
    )
    const agent = new Agent({ tools: [echo] })
    await expect(agent.run('loop')).rejects.toMatchObject({ limitReason: 'iterations' })
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
