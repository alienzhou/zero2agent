import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ContextBudget } from '../context-budget.js'
import { ContextManager, type CompactionRuntime, type CompactionEvent } from '../context-manager.js'

type Message = Anthropic.MessageParam
const user = (content: string): Message => ({ role: 'user', content })
const assistant = (content: string): Message => ({ role: 'assistant', content })
const longHistory = (): Message[] => [
  user('original requirement ' + 'u'.repeat(1200)),
  assistant('a'.repeat(6000)),
  user('continue'),
]
const managers: ContextManager[] = []
const artifacts: string[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function fixture(
  summarize: Mock<(messages: Message[], signal: AbortSignal) => Promise<string>> = vi.fn(
    async () => 'Summary of completed work and remaining requirements.'
  )
) {
  const manager = new ContextManager()
  managers.push(manager)
  const budget = new ContextBudget('fixture', {
    contextWindow: 12000,
    maxOutputTokens: 512,
    summaryTokens: 128,
    safetyTokens: 256,
  })
  const events: CompactionEvent[] = []
  const runtime: CompactionRuntime = {
    budget,
    client: {} as Anthropic,
    request: messages => ({ model: 'fixture', max_tokens: budget.outputTokens, messages }),
    summarize,
    onCompaction: event => {
      events.push(event)
    },
  }
  return { manager, runtime, events, summarize }
}

afterEach(async () => {
  for (const manager of managers.splice(0)) manager.cancel()
  for (const path of artifacts.splice(0)) await rm(path, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('tiered context management', () => {
  it('leaves small contexts unchanged without calling the summarizer', async () => {
    const { manager, runtime, summarize } = fixture()
    const messages = [user('hi')]
    expect((await manager.prepare(messages, runtime)).messages).toEqual(messages)
    expect(summarize).not.toHaveBeenCalled()
  })

  it('starts one background summary without waiting while there is room', async () => {
    const pending = deferred<string>()
    const { manager, runtime, summarize, events } = fixture(vi.fn(() => pending.promise))
    const messages = longHistory()
    const request = await manager.prepare(messages, runtime)
    expect(request.messages).toEqual(messages)
    expect(events.map(e => e.phase)).toEqual(['background'])
    await manager.prepare(messages, runtime)
    expect(summarize).toHaveBeenCalledTimes(1)
    pending.resolve('Prior work is complete; continue the remaining task.')
  })

  it('adopts a completed prefix while retaining messages appended during background work', async () => {
    const pending = deferred<string>()
    const { manager, runtime, events } = fixture(vi.fn(() => pending.promise))
    const messages = longHistory()
    await manager.prepare(messages, runtime)
    messages.push(assistant('new answer'), user('latest correction: do not delete files'))
    const originals = structuredClone(messages)
    pending.resolve('Old work summarized.')
    await pending.promise
    await Promise.resolve()
    const request = await manager.prepare(messages, runtime)
    expect(JSON.stringify(request.messages)).toContain('Old work summarized.')
    expect(request.messages.slice(-3)).toEqual(messages.slice(-3))
    expect(messages).toEqual(originals)
    expect(events.some(e => e.phase === 'completed')).toBe(true)
  })

  it('promotes background work to blocking before the next request would exceed its budget', async () => {
    const pending = deferred<string>()
    const { manager, runtime, summarize, events } = fixture(vi.fn(() => pending.promise))
    const messages = longHistory()
    await manager.prepare(messages, runtime)
    messages.push(assistant('b'.repeat(3100)), user('new question'))
    let sent = false
    const preparing = manager.prepare(messages, runtime).then(request => {
      sent = true
      return request
    })
    await vi.waitFor(() => expect(events.some(e => e.phase === 'waiting')).toBe(true))
    expect(sent).toBe(false)
    expect(summarize).toHaveBeenCalledTimes(1)
    pending.resolve('Old completed work summarized.')
    const request = await preparing
    expect(runtime.budget.estimate(request)).toBeLessThanOrEqual(runtime.budget.inputLimit)
    expect(request.messages.at(-1)).toEqual(user('new question'))
  })

  it('blocks in foreground immediately after a large single-turn growth', async () => {
    const pending = deferred<string>()
    const { manager, runtime, events } = fixture(vi.fn(() => pending.promise))
    const messages = [user('task'), assistant('a'.repeat(11000)), user('continue')]
    const preparing = manager.prepare(messages, runtime)
    await vi.waitFor(() => expect(events.some(e => e.phase === 'foreground')).toBe(true))
    pending.resolve('The task is unfinished; earlier analysis is summarized.')
    const request = await preparing
    expect(runtime.budget.estimate(request)).toBeLessThan(runtime.budget.inputLimit)
  })

  it('retains original history when foreground compaction fails and sends nothing', async () => {
    const { manager, runtime } = fixture(
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    const messages = [user('task'), assistant('a'.repeat(15000)), user('continue')]
    const original = structuredClone(messages)
    await expect(manager.prepare(messages, runtime)).rejects.toThrow('compression failed')
    expect(manager.getContext(messages)).toEqual(original)
    expect(messages).toEqual(original)
  })

  it('keeps a failed background task non-blocking when the current request still fits', async () => {
    const pending = deferred<string>()
    const { manager, runtime, summarize } = fixture(vi.fn(() => pending.promise))
    const messages = longHistory()
    await manager.prepare(messages, runtime)
    pending.reject(new Error('offline'))
    await pending.promise.catch(() => {})
    await Promise.resolve()
    const request = await manager.prepare(messages, runtime)
    expect(request.messages).toEqual(messages)
    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('invalidates a reset background result, even if the summarizer ignores cancellation', async () => {
    const pending = deferred<string>()
    const { manager, runtime, summarize } = fixture(vi.fn(() => pending.promise))
    await manager.prepare(longHistory(), runtime)
    const signal = summarize.mock.calls[0][1] as AbortSignal
    manager.reset()
    expect(signal.aborted).toBe(true)
    pending.resolve('Stale summary must never return.')
    await pending.promise
    const request = await manager.prepare([user('fresh')], runtime)
    expect(request.messages).toEqual([user('fresh')])
  })

  it('discards a result when its source prefix was replaced', async () => {
    const pending = deferred<string>()
    const { manager, runtime } = fixture(vi.fn(() => pending.promise))
    const messages = longHistory()
    await manager.prepare(messages, runtime)
    messages[0] = user('different history')
    pending.resolve('Summary of obsolete source')
    await pending.promise
    await Promise.resolve()
    expect(JSON.stringify((await manager.prepare(messages, runtime)).messages)).not.toContain(
      'obsolete'
    )
  })

  it('does not resurrect history when reset occurs while foreground waits for background work', async () => {
    const pending = deferred<string>()
    const { manager, runtime, summarize, events } = fixture(vi.fn(() => pending.promise))
    const messages = longHistory()
    await manager.prepare(messages, runtime)
    const operation = manager.compact(messages, runtime)
    const rejection = expect(operation).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(events.some(e => e.phase === 'waiting')).toBe(true))
    manager.reset()
    await rejection
    pending.resolve('obsolete')
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(manager.getContext([user('fresh')])).toEqual([user('fresh')])
  })

  it('rechecks the operation epoch after asynchronous adoption counting', async () => {
    const pending = deferred<string>()
    const { manager, runtime } = fixture(vi.fn(() => pending.promise))
    const messages = longHistory()
    await manager.prepare(messages, runtime)
    pending.resolve('Old summary')
    await pending.promise
    await Promise.resolve()
    const counted = deferred<number>()
    const count = vi.spyOn(runtime.budget, 'count').mockImplementationOnce(() => counted.promise)
    const operation = manager.prepare(messages, runtime)
    const rejection = expect(operation).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(count).toHaveBeenCalled())
    manager.reset()
    counted.resolve(8000)
    await rejection
    expect(manager.getContext([user('fresh')])).toEqual([user('fresh')])
  })

  it('times out a blocked summarizer without altering committed context', async () => {
    vi.useFakeTimers()
    const { manager, runtime } = fixture(vi.fn(() => new Promise<string>(() => {})))
    const messages = longHistory()
    const operation = manager.compact(messages, runtime)
    const rejection = expect(operation).rejects.toThrow('compression failed')
    await vi.advanceTimersByTimeAsync(runtime.budget.timeoutMs + 1)
    await rejection
    expect(manager.getContext(messages)).toEqual(messages)
  })

  it('does not send or silently truncate an oversized latest user message', async () => {
    const { manager, runtime, summarize } = fixture()
    const messages = [user('x'.repeat(12000))]
    await expect(manager.prepare(messages, runtime)).rejects.toThrow('latest input')
    expect(summarize).not.toHaveBeenCalled()
    expect(manager.getContext(messages)).toEqual(messages)
  })

  it('accounts for oversized fixed instructions before attempting compaction', async () => {
    const { manager, runtime, summarize } = fixture()
    runtime.request = messages => ({
      model: 'fixture',
      max_tokens: 512,
      system: 'x'.repeat(12000),
      messages,
    })
    await expect(manager.prepare([user('hi')], runtime)).rejects.toThrow('latest input')
    expect(summarize).not.toHaveBeenCalled()
  })

  it('shortens large tool bodies without splitting pairs or losing the original result', async () => {
    const { manager, runtime, summarize, events } = fixture()
    const output = 'evidence\n'.repeat(3000)
    const messages: Message[] = [
      user('inspect'),
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'read-1', name: 'read_file', input: {} }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: output }] },
    ]
    const request = await manager.prepare(messages, runtime)
    const blocks = request.messages[2].content as Anthropic.ToolResultBlockParam[]
    const result = String(blocks[0].content)
    const path = result.match(/saved to (.+?)\. Read it/)![1]
    artifacts.push(dirname(path))
    expect(await readFile(path, 'utf8')).toBe(output)
    expect((messages[2].content as Anthropic.ToolResultBlockParam[])[0].content).toBe(output)
    expect(blocks[0].tool_use_id).toBe('read-1')
    expect(summarize).not.toHaveBeenCalled()
    expect(events.some(e => e.phase === 'pruned')).toBe(true)
  })

  it('keeps safe sends available after compression fails with fixed overhead near the foreground line', async () => {
    const { manager, runtime } = fixture(
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    runtime.request = messages => ({
      model: 'fixture',
      max_tokens: 512,
      system: 's'.repeat(9200),
      messages,
    })
    const messages = [user('first'), assistant('done'), user('next')]
    const request = await manager.prepare(messages, runtime)
    expect(runtime.budget.estimate(request)).toBeLessThan(runtime.budget.inputLimit)
    expect(request.messages).toEqual(messages)
  })

  it('makes a long single-line result readable in bounded character slices', async () => {
    const { manager, runtime } = fixture()
    const output = '𠮷single-line'.repeat(3000) + 'END-EVIDENCE'
    const messages: Message[] = [
      user('inspect'),
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'long', name: 'read_file', input: {} }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'long', content: output }] },
    ]
    const request = await manager.prepare(messages, runtime)
    const receipt = String(
      (request.messages[2].content as Anthropic.ToolResultBlockParam[])[0].content
    )
    const path = receipt.match(/Long lines: read (.+?\.chunks\.jsonl)/)![1]
    artifacts.push(dirname(path))
    const rows = (await readFile(path, 'utf8')).trim().split('\n')
    const chunks = rows.map(row => JSON.parse(row) as { start_character: number; text: string })
    expect(chunks.map(row => row.text).join('')).toBe(output)
    expect(chunks.at(-1)?.text).toContain('END-EVIDENCE')
    expect(rows.every(row => Buffer.byteLength(row) < 1024)).toBe(true)
    const readback = await import('../tools/read-file.js')
    const last = await readback.readFileTool.execute(
      { path, start_line: rows.length, end_line: rows.length },
      { cwd: dirname(path) }
    )
    expect(last).toContain('END-EVIDENCE')
  })

  it('cancels promptly while provider token counting is pending', async () => {
    const { manager, runtime } = fixture()
    let signal: AbortSignal | undefined
    vi.spyOn(runtime.budget, 'count').mockImplementation((_request, _client, currentSignal) => {
      signal = currentSignal
      return new Promise<number>(() => {})
    })
    const preparing = manager.prepare([user('hello')], runtime)
    const rejection = expect(preparing).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(signal).toBeDefined())
    manager.cancel()
    await rejection
    expect(signal?.aborted).toBe(true)
  })

  it('keeps long multi-turn conversations within the budget after repeated compactions', async () => {
    const { manager, runtime, summarize } = fixture()
    const messages: Message[] = []
    for (let turn = 0; turn < 120; turn++) {
      messages.push(user(`turn-${turn}: ` + 'u'.repeat(180)))
      const request = await manager.prepare(messages, runtime)
      expect(runtime.budget.estimate(request)).toBeLessThanOrEqual(runtime.budget.inputLimit)
      expect(request.messages.at(-1)).toEqual(messages.at(-1))
      messages.push(assistant('a'.repeat(900)))
    }
    expect(messages).toHaveLength(240)
    expect(summarize.mock.calls.length).toBeGreaterThan(5)
  })

  it('treats empty manual context as a no-op', async () => {
    const { manager, runtime, summarize } = fixture()
    expect(await manager.compact([], runtime)).toBe(false)
    expect(summarize).not.toHaveBeenCalled()
  })

  it('rejects empty and non-reducing summaries without replacing history', async () => {
    for (const summary of ['', 'z'.repeat(20000)]) {
      const { manager, runtime } = fixture(vi.fn(async () => summary))
      const messages = longHistory()
      await expect(manager.compact(messages, runtime)).rejects.toThrow('compression failed')
      expect(manager.getContext(messages)).toEqual(messages)
    }
  })
})
