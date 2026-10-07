import { createServer, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Agent } from '../agent.js'
import { DiagnosticEmitter, type DiagnosticEvent } from '../diagnostics.js'
import { createAnthropicClient } from '../llm/index.js'
import { ContextBudget } from '../context-budget.js'
import { createContextSummarizer } from '../context-summary.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
async function provider(
  handle: (body: Record<string, unknown>, response: ServerResponse, url: string) => void
) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    handle(JSON.parse(Buffer.concat(chunks).toString()), response, request.url ?? '')
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
    apiKey: 'private-api-key',
    baseURL: `http://127.0.0.1:${address.port}`,
    model: 'claude-sonnet-4-20250514',
  }
}
function sse(res: ServerResponse, tool = false, finish = true) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, data: unknown) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  event('message_start', {
    type: 'message_start',
    message: {
      id: 'fixture',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-20250514',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 19, output_tokens: 0 },
    },
  })
  event('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: tool
      ? { type: 'tool_use', id: 'same-id', name: 'probe', input: {} }
      : { type: 'text', text: '' },
  })
  event('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: tool
      ? { type: 'input_json_delta', partial_json: '{"hidden":"private-tool-input"}' }
      : { type: 'text_delta', text: 'private-model-body' },
  })
  if (!finish) return
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: 7 },
  })
  event('message_stop', { type: 'message_stop' })
  res.end()
}
const probe = {
  name: 'probe',
  description: 'read fixture',
  input_schema: { type: 'object' as const, properties: { hidden: { type: 'string' } } },
  execute: async () => 'private-tool-output',
  permission: { effect: 'read' as const },
}

describe('runtime diagnostics through the actual SDK', () => {
  it('correlates repeated tool IDs to requests without recording any bodies', async () => {
    let count = 0
    const config = await provider((_body, response) => sse(response, count++ < 2))
    const records: DiagnosticEvent[] = []
    const agent = new Agent({
      config,
      tools: [probe],
      permissions: { mode: 'bypass' },
      diagnostics: event => records.push(event),
    })
    const sessionId = '00000000-0000-4000-8000-000000000001'
    expect(await agent.run('private-user-body', { sessionId })).toBe('private-model-body')
    const requests = records.filter(e => e.kind === 'request')
    expect(requests.filter(e => e.event === 'start')).toHaveLength(3)
    expect(requests.filter(e => e.event === 'completed')).toHaveLength(3)
    for (const start of requests.filter(e => e.event === 'start')) {
      const end = requests.find(e => e.requestId === start.requestId && e.event === 'completed')!
      expect(end).toMatchObject({ inputTokens: 19, outputTokens: 7, purpose: 'model' })
      expect(end.durationMs).toBeGreaterThanOrEqual(0)
    }
    const toolEnds = records.filter(e => e.kind === 'tool' && e.event === 'completed')
    expect(toolEnds).toHaveLength(2)
    expect(toolEnds.map(e => e.toolCallId)).toEqual(['same-id', 'same-id'])
    expect(new Set(toolEnds.map(e => e.requestId)).size).toBe(2)
    expect(records.filter(e => e.kind === 'permission' && e.event === 'resolved')).toHaveLength(2)
    expect(records.every(e => e.sessionId === sessionId)).toBe(true)
    expect(records.map(e => e.seq)).toEqual(records.map((_, i) => i + 1))
    for (const secret of [
      'private-api-key',
      'private-tool-input',
      'private-tool-output',
      'private-user-body',
      'private-model-body',
    ])
      expect(JSON.stringify(records)).not.toContain(secret)
    expect(agent.getHistory().some(e => JSON.stringify(e).includes('private-tool-output'))).toBe(
      true
    )
  })
  it('records provider failure as a classification and status, never raw error text', async () => {
    const config = await provider((_body, response) => {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'private-api-key private-error-body' },
        })
      )
    })
    const records: DiagnosticEvent[] = []
    const agent = new Agent({ config, diagnostics: e => records.push(e) })
    await expect(agent.run('private-user-body')).rejects.toThrow()
    expect(records.find(e => e.kind === 'request' && e.event === 'error')).toMatchObject({
      errorKind: 'auth',
      httpStatus: 401,
    })
    expect(records.at(-1)).toMatchObject({ kind: 'operation', event: 'error' })
    expect(JSON.stringify(records)).not.toContain('private-error-body')
  })
  it('closes the cancelled request and continues under a new operation identity', async () => {
    let count = 0
    const config = await provider((_body, response) => sse(response, false, count++ > 0))
    const records: DiagnosticEvent[] = []
    let agent: Agent
    agent = new Agent({
      config,
      diagnostics: e => records.push(e),
      events: {
        onText: () => {
          if (count === 1) agent.cancelTurn()
        },
      },
    })
    await expect(agent.run('cancel')).rejects.toThrow('cancelled')
    expect(records.find(e => e.kind === 'request' && e.event === 'cancelled')).toMatchObject({
      textChars: 18,
      errorKind: 'cancelled',
    })
    expect(await agent.run('continue')).toBe('private-model-body')
    expect(new Set(records.map(e => e.operationId)).size).toBe(2)
  })
  it('ignores synchronous and asynchronous diagnostic observer failures', async () => {
    const config = await provider((_body, response) => sse(response))
    const a = new Agent({
      config,
      diagnostics: () => {
        throw new Error('sink failed')
      },
    })
    const b = new Agent({
      config,
      diagnostics: async () => {
        throw new Error('async sink failed')
      },
    })
    expect(await a.run('test')).toBe('private-model-body')
    expect(await b.run('test')).toBe('private-model-body')
  })
  it('traces provider token counting and summary requests under their own purpose', async () => {
    const config = await provider((_body, response, url) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify(
          url.endsWith('count_tokens')
            ? { input_tokens: 30 }
            : {
                id: 'summary',
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-4-20250514',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text: 'short handoff' }],
                usage: { input_tokens: 30, output_tokens: 4 },
              }
        )
      )
    })
    const client = createAnthropicClient(config)
    const budget = new ContextBudget('claude-sonnet-4-20250514', {
      contextWindow: 100000,
      maxInputTokens: 80000,
      counting: 'provider',
    })
    const records: DiagnosticEvent[] = []
    const diagnostics = new DiagnosticEmitter(e => records.push(e), {
      sessionId: 'original-session',
    })
    diagnostics.start('compact')
    expect(
      await createContextSummarizer(
        client,
        'claude-sonnet-4-20250514',
        budget,
        diagnostics
      )([{ role: 'user', content: 'private-history '.repeat(200) }], new AbortController().signal)
    ).toBe('short handoff')
    expect(records.some(e => e.purpose === 'count' && e.event === 'completed')).toBe(true)
    expect(records.some(e => e.purpose === 'summary' && e.event === 'completed')).toBe(true)
    expect(JSON.stringify(records)).not.toContain('private-history')
    diagnostics.end('completed', 'compact')
    diagnostics.emit('compaction', 'completed', { trigger: 'auto' })
    expect(records.at(-1)).toMatchObject({
      sessionId: 'original-session',
      operationId: diagnostics.operationId,
    })
  })
  it('traces manual Agent compaction without adding diagnostic facts to history', async () => {
    const config = await provider((_body, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'summary',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'short handoff' }],
          usage: { input_tokens: 20, output_tokens: 3 },
        })
      )
    })
    const records: DiagnosticEvent[] = []
    const agent = new Agent({
      config,
      diagnostics: e => records.push(e),
      context: { contextWindow: 100000, maxInputTokens: 80000 },
    })
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 ? ('assistant' as const) : ('user' as const),
      content: 'historical-private-body '.repeat(100),
    }))
    agent.restore({ messages, context: { through: 0, summary: '' } })
    expect(await agent.compact({ sessionId: 'compact-session' })).toBe(true)
    expect(records[0]).toMatchObject({ kind: 'operation', event: 'start', operation: 'compact' })
    expect(records.some(e => e.purpose === 'summary' && e.event === 'completed')).toBe(true)
    expect(records.some(e => e.kind === 'compaction' && e.trigger === 'manual')).toBe(true)
    expect(records.at(-1)).toMatchObject({ kind: 'operation', event: 'completed' })
    expect(agent.getHistory()).toEqual(messages)
    expect(JSON.stringify(records)).not.toContain('historical-private-body')
  })
  it('preserves the identity of a real background summary that ends after subsequent turns', async () => {
    let summaryResponse: ServerResponse | undefined
    let summaryStarted!: () => void
    const started = new Promise<void>(resolve => {
      summaryStarted = resolve
    })
    const config = await provider((body, response) => {
      if (body.stream) sse(response)
      else {
        summaryResponse = response
        summaryStarted()
      }
    })
    const records: DiagnosticEvent[] = []
    const agent = new Agent({
      config,
      diagnostics: e => records.push(e),
      tools: [],
      context: {
        contextWindow: 100000,
        maxInputTokens: 40000,
        summaryTokens: 2048,
        maxOutputTokens: 4096,
        targetRatio: 0.2,
        backgroundRatio: 0.3,
        foregroundRatio: 0.9,
      },
    })
    agent.restore({
      messages: Array.from({ length: 6 }, (_, i) => ({
        role: i % 2 ? ('assistant' as const) : ('user' as const),
        content: 'history-private '.repeat(180),
      })),
      context: { through: 0, summary: '' },
    })
    await agent.run('first', { sessionId: 'original-session' })
    await started
    const summaryStart = records.find(e => e.purpose === 'summary' && e.event === 'start')!
    expect(
      records.some(
        e =>
          e.operationId === summaryStart.operationId &&
          e.kind === 'operation' &&
          e.event === 'completed'
      )
    ).toBe(true)
    await agent.run('second', { sessionId: 'later-session' })
    summaryResponse!.writeHead(200, { 'content-type': 'application/json' })
    summaryResponse!.end(
      JSON.stringify({
        id: 'summary',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'short handoff' }],
        usage: { input_tokens: 20, output_tokens: 3 },
      })
    )
    await expect
      .poll(() =>
        records.some(e => e.requestId === summaryStart.requestId && e.event === 'completed')
      )
      .toBe(true)
    expect(
      records.find(e => e.requestId === summaryStart.requestId && e.event === 'completed')
    ).toMatchObject({ sessionId: 'original-session', operationId: summaryStart.operationId })
    agent.cancelCompaction()
  })
})
