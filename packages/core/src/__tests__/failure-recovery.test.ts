import { createServer, type ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '../agent.js'
import { RunBudgetError, TurnCancelledError, type RuntimeEvent } from '../runtime.js'
import { retryAfterMs, RequestTimeoutError } from '../request-executor.js'
import type { DiagnosticEvent } from '../diagnostics.js'
import type { Tool } from '../tools/types.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function provider(
  handle: (body: Record<string, unknown>, res: ServerResponse, index: number, url: string) => void
) {
  const requests: Array<Record<string, unknown>> = []
  const urls: string[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
    requests.push(body)
    urls.push(req.url ?? '')
    handle(body, res, requests.length, req.url ?? '')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close(error => (error ? reject(error) : resolve()))
      })
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  return {
    config: { apiKey: 'test-placeholder', baseURL: `http://127.0.0.1:${address.port}` },
    requests,
    urls,
  }
}
function httpError(res: ServerResponse, status: number, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'retry-after-ms': '1', ...headers })
  res.end(
    JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'fixture failure' } })
  )
}
function sse(
  res: ServerResponse,
  blocks: Array<Record<string, unknown>>,
  stop = 'end_turn',
  complete = true
) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, fields: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`)
  event('message_start', {
    message: {
      id: 'fixture',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-20250514',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 2, output_tokens: 0 },
    },
  })
  blocks.forEach((block, index) => {
    event('content_block_start', {
      index,
      content_block:
        block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' },
    })
    event('content_block_delta', {
      index,
      delta:
        block.type === 'tool_use'
          ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
          : { type: 'text_delta', text: block.text },
    })
    event('content_block_stop', { index })
  })
  event('message_delta', {
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  if (complete) event('message_stop', {})
  res.end()
}
const answer = (res: ServerResponse, text = 'completed') => sse(res, [{ type: 'text', text }])
const call = (id: string, input: Record<string, unknown> = {}) => ({
  type: 'tool_use',
  id,
  name: 'probe',
  input,
})
const probe = (execute: Tool['execute']): Tool => ({
  name: 'probe',
  description: '',
  input_schema: { type: 'object', properties: {} },
  permission: { effect: 'read' },
  execute,
})
const limits = { retryBaseMs: 1, requestTimeoutMs: 2000 }
const results = (agent: Agent) =>
  agent
    .getHistory()
    .flatMap(message =>
      Array.isArray(message.content)
        ? message.content.filter(block => block.type === 'tool_result')
        : []
    )

describe('failure recovery through real HTTP and SDK', () => {
  it.each([408, 429, 500, 529])(
    'recovers HTTP %i with visible attempts and no hidden SDK retries',
    async status => {
      const p = await provider((_body, res, index) =>
        index < 3 ? httpError(res, status) : answer(res)
      )
      const records: DiagnosticEvent[] = [],
        events: RuntimeEvent[] = []
      const agent = new Agent({
        config: p.config,
        tools: [],
        limits,
        diagnostics: e => records.push(e),
        events: { onEvent: e => events.push(e) },
      })
      expect(await agent.run('inspect')).toBe('completed')
      expect(p.requests).toHaveLength(3)
      const starts = records.filter(e => e.kind === 'request' && e.event === 'start')
      expect(starts.map(e => e.attempt)).toEqual([1, 2, 3])
      expect(new Set(starts.map(e => e.logicalRequestId)).size).toBe(1)
      expect(new Set(starts.map(e => e.requestId)).size).toBe(3)
      expect(events.filter(e => e.type === 'request-retry')).toHaveLength(2)
      expect(JSON.stringify(records)).not.toContain('fixture failure')
      expect(JSON.stringify(records)).not.toContain('inspect')
    }
  )
  it.each([400, 401, 403, 404, 409, 413, 422])(
    'does not retry HTTP %i even when a header requests it',
    async status => {
      const p = await provider((_body, res) => httpError(res, status, { 'x-should-retry': 'true' }))
      await expect(
        new Agent({ config: p.config, tools: [], limits }).run('inspect')
      ).rejects.toMatchObject({ status })
      expect(p.requests).toHaveLength(1)
    }
  )
  it('honors explicit server refusal to retry', async () => {
    const p = await provider((_body, res) => httpError(res, 500, { 'x-should-retry': 'false' }))
    await expect(
      new Agent({ config: p.config, tools: [], limits }).run('inspect')
    ).rejects.toMatchObject({ status: 500 })
    expect(p.requests).toHaveLength(1)
  })
  it('stops on retry exhaustion and keeps only complete history', async () => {
    const p = await provider((_body, res) => httpError(res, 500))
    const agent = new Agent({ config: p.config, tools: [], limits })
    await expect(agent.run('inspect')).rejects.toMatchObject({ status: 500 })
    expect(p.requests).toHaveLength(3)
    expect(JSON.stringify(agent.getHistory())).not.toContain('fixture failure')
  })
  it('rejects a server delay beyond the allowed wait without sending an early retry', async () => {
    const p = await provider((_body, res) => httpError(res, 429, { 'retry-after-ms': '1000' }))
    await expect(
      new Agent({ config: p.config, tools: [], limits: { ...limits, maxRetryDelayMs: 20 } }).run(
        'inspect'
      )
    ).rejects.toMatchObject({ limitReason: 'retry-delay' })
    expect(p.requests).toHaveLength(1)
  })
  it('cancels a backoff before another HTTP request is sent', async () => {
    const p = await provider((_body, res) => httpError(res, 500, { 'retry-after-ms': '1000' }))
    let agent: Agent
    agent = new Agent({
      config: p.config,
      tools: [],
      limits,
      events: {
        onEvent: e => {
          if (e.type === 'request-retry') agent.cancelTurn()
        },
      },
    })
    await expect(agent.run('inspect')).rejects.toBeInstanceOf(TurnCancelledError)
    expect(p.requests).toHaveLength(1)
  })
  it('bounds an HTTP response that never arrives and closes actual sockets', async () => {
    let closed = 0
    const p = await provider((_body, res) => res.on('close', () => closed++))
    const agent = new Agent({
      config: p.config,
      tools: [],
      limits: { ...limits, requestTimeoutMs: 40, maxRetries: 1 },
    })
    await expect(agent.run('inspect')).rejects.toBeInstanceOf(RequestTimeoutError)
    expect(p.requests).toHaveLength(2)
    await vi.waitFor(() => expect(closed).toBe(2))
  })
  it('never executes a complete-looking tool block before message_stop', async () => {
    const p = await provider((_body, res, index) =>
      index === 1 ? sse(res, [call('abandoned')], 'tool_use', false) : answer(res)
    )
    const execute = vi.fn(async () => 'effect')
    const agent = new Agent({ config: p.config, tools: [probe(execute)], limits })
    expect(await agent.run('inspect')).toBe('completed')
    expect(execute).not.toHaveBeenCalled()
    expect(JSON.stringify(agent.getHistory())).not.toContain('abandoned')
    expect(p.requests).toHaveLength(2)
  })
  it('separates an abandoned text draft from the one committed answer', async () => {
    const p = await provider((_body, res, index) =>
      index === 1
        ? sse(res, [{ type: 'text', text: 'unfinished draft' }], 'end_turn', false)
        : answer(res, 'final answer')
    )
    const events: RuntimeEvent[] = []
    const agent = new Agent({
      config: p.config,
      tools: [],
      limits,
      events: { onEvent: e => events.push(e) },
    })
    expect(await agent.run('inspect')).toBe('final answer')
    expect(JSON.stringify(agent.getHistory())).not.toContain('unfinished draft')
    expect(events.find(e => e.type === 'request-retry')).toMatchObject({ discardedChars: 16 })
  })
  it('does not repeat an already completed tool when the next model request fails', async () => {
    const p = await provider((_body, res, index) =>
      index === 1
        ? sse(res, [call('once')], 'tool_use')
        : index < 4
          ? httpError(res, 500)
          : answer(res)
    )
    const execute = vi.fn(async () => 'written once')
    const agent = new Agent({ config: p.config, tools: [probe(execute)], limits })
    expect(await agent.run('inspect')).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(p.requests.slice(1).map(r => r.messages)).toEqual([
      p.requests[1].messages,
      p.requests[1].messages,
      p.requests[1].messages,
    ])
    expect(results(agent)).toHaveLength(1)
  })
  it('pairs the rest of a batch without executing it after the tool quota is consumed', async () => {
    const p = await provider((_body, res) =>
      sse(res, [call('one'), call('two'), call('three')], 'tool_use')
    )
    const execute = vi.fn(async () => 'written once')
    const agent = new Agent({
      config: p.config,
      tools: [probe(execute)],
      limits: { ...limits, maxToolCalls: 1 },
    })
    await expect(agent.run('inspect')).rejects.toMatchObject({ limitReason: 'tools' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(results(agent)).toHaveLength(3)
    expect(
      results(agent)
        .slice(1)
        .every(r => r.is_error && String(r.content).includes('not executed'))
    ).toBe(true)
  })
  it('stops identical failures but allows a changed input to succeed', async () => {
    const p = await provider((_body, res, index) =>
      index < 4
        ? sse(res, [call(String(index), { value: index === 3 ? 'fixed' : 'bad' })], 'tool_use')
        : answer(res)
    )
    const execute = vi.fn(async (input: Record<string, unknown>) =>
      input.value === 'fixed' ? 'observed success' : 'Error: invalid value'
    )
    const agent = new Agent({ config: p.config, tools: [probe(execute)], limits })
    expect(await agent.run('inspect')).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(3)
    expect(results(agent).map(r => !!r.is_error)).toEqual([true, true, false])
  })
  it('stops after repeated identical failures with their results intact', async () => {
    const p = await provider((_body, res, index) => sse(res, [call(String(index))], 'tool_use'))
    const execute = vi.fn(async () => 'Error: invalid value')
    const agent = new Agent({ config: p.config, tools: [probe(execute)], limits })
    await expect(agent.run('inspect')).rejects.toMatchObject({
      limitReason: 'repeated-tool-failure',
    })
    expect(execute).toHaveBeenCalledTimes(3)
    expect(results(agent)).toHaveLength(3)
  })
  it('does not reopen identical denied approval within the same turn', async () => {
    const p = await provider((_body, res, index) => sse(res, [call(String(index))], 'tool_use'))
    const execute = vi.fn(async () => 'should not execute'),
      approve = vi.fn(async (request: { id: string }) => ({
        requestId: request.id,
        decision: 'deny' as const,
      }))
    const tool = probe(execute)
    tool.permission = { effect: 'write' }
    const agent = new Agent({
      config: p.config,
      tools: [tool],
      limits,
      permissions: { requestApproval: approve },
    })
    await expect(agent.run('inspect')).rejects.toMatchObject({ limitReason: 'repeated-denial' })
    expect(approve).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    expect(results(agent)).toHaveLength(2)
  })
  it('counts provider token requests against the operation quota', async () => {
    const p = await provider((_body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"input_tokens":10}')
    })
    const agent = new Agent({
      config: p.config,
      tools: [],
      context: { counting: 'provider' },
      limits: { ...limits, maxRequests: 2 },
    })
    await expect(agent.run('inspect')).rejects.toBeInstanceOf(RunBudgetError)
    expect(p.urls).toHaveLength(2)
    expect(p.urls.every(url => url.includes('count_tokens'))).toBe(true)
  })
  it('waits for a signal-ignoring tool to settle after a duration limit', async () => {
    const p = await provider((_body, res, index) =>
      index === 1 ? sse(res, [call('write')], 'tool_use') : answer(res)
    )
    let finish!: () => void, toolSignal: AbortSignal | undefined
    const tool = probe(async (_input, ctx) => {
      toolSignal = ctx.signal
      await new Promise<void>(resolve => {
        finish = resolve
      })
      return 'observed write after deadline'
    })
    const agent = new Agent({
      config: p.config,
      tools: [tool],
      limits: { ...limits, maxDurationMs: 200 },
    })
    const work = agent.run('inspect'),
      rejection = expect(work).rejects.toMatchObject({ limitReason: 'duration' })
    await vi.waitFor(() => expect(toolSignal?.aborted).toBe(true))
    await expect(agent.run('next')).rejects.toThrow('already running')
    finish()
    await rejection
    expect(results(agent)[0].content).toBe('observed write after deadline')
    expect(await agent.run('next')).toBe('completed')
  })
})

describe('Retry-After formats', () => {
  const error = (header: string) =>
    new Anthropic.APIError(429, {}, '', new Headers({ 'retry-after': header }))
  it('accepts zero, decimal seconds, HTTP dates and rejects malformed values', () => {
    expect(retryAfterMs(error('0'))).toBe(0)
    expect(retryAfterMs(error('0.5'))).toBe(500)
    expect(
      retryAfterMs(error('Thu, 08 Oct 2026 00:00:02 GMT'), Date.parse('2026-10-08T00:00:00Z'))
    ).toBe(2000)
    expect(retryAfterMs(error('invalid'))).toBeUndefined()
  })
})
