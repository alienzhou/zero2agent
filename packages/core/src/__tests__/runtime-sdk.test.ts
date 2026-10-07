import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '../agent.js'
import { TurnCancelledError } from '../runtime.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function provider(
  handle: (
    body: Record<string, unknown>,
    response: ServerResponse,
    request: IncomingMessage
  ) => void
) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    handle(body, response, request)
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
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return { apiKey: 'test-placeholder', baseURL: `http://127.0.0.1:${address.port}` }
}

function sse(response: ServerResponse, text: string, complete = true) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, data: unknown) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  event('message_start', {
    type: 'message_start',
    message: {
      id: 'test',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-20250514',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  })
  event('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  event('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })
  if (!complete) return
  event('content_block_stop', { type: 'content_block_stop', index: 0 })
  event('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  event('message_stop', { type: 'message_stop' })
  response.end()
}

describe('cancellation through the real Anthropic SDK', () => {
  it('closes an in-flight streaming HTTP response', async () => {
    let closed = false
    let observedText = false
    let requests = 0
    const config = await provider((_body, response) => {
      requests++
      response.on('close', () => {
        closed = true
      })
      sse(response, 'visible fragment', false)
    })
    const agent = new Agent({
      config,
      tools: [],
      events: {
        onEvent: event => {
          if (event.type === 'text-delta') observedText = true
        },
      },
    })
    const pending = agent.run('wait')
    const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
    await vi.waitFor(() => expect(observedText).toBe(true))
    agent.cancelTurn()
    await rejection
    await vi.waitFor(() => expect(closed).toBe(true))
    expect(requests).toBe(1)
    expect(JSON.stringify(agent.getHistory())).not.toContain('visible fragment')
  })

  it('closes provider counting HTTP before any stream request is sent', async () => {
    let countStarted = false
    let closed = false
    const paths: string[] = []
    const config = await provider((_body, response, request) => {
      paths.push(request.url ?? '')
      if (request.url?.includes('count_tokens')) {
        countStarted = true
        response.on('close', () => {
          closed = true
        })
      } else {
        sse(response, 'should not happen')
      }
    })
    const agent = new Agent({ config, tools: [], context: { counting: 'provider' } })
    const pending = agent.run('count')
    const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
    await vi.waitFor(() => expect(countStarted).toBe(true))
    agent.cancelTurn()
    await rejection
    await vi.waitFor(() => expect(closed).toBe(true))
    expect(paths).toHaveLength(1)
    expect(paths[0]).toContain('count_tokens')
  })

  it.each(['manual', 'automatic'] as const)(
    'closes a %s summary HTTP request and preserves the full history',
    async mode => {
      let summaryStarted = false
      let summaryClosed = false
      let streamRequests = 0
      const config = await provider((body, response) => {
        if (body.stream) {
          streamRequests++
          sse(response, 'historical evidence '.repeat(470))
        } else {
          summaryStarted = true
          response.on('close', () => {
            summaryClosed = true
          })
        }
      })
      const agent = new Agent({
        config,
        tools: [],
        context: {
          contextWindow: 12000,
          maxInputTokens: 10000,
          maxOutputTokens: 128,
          summaryTokens: 64,
          safetyTokens: 256,
        },
      })
      await agent.run('first task')
      const history = agent.getHistory()
      const pending = mode === 'manual' ? agent.compact() : agent.run('follow-up')
      const rejection = expect(pending).rejects.toBeInstanceOf(TurnCancelledError)
      await vi.waitFor(() => expect(summaryStarted).toBe(true))
      agent.cancelTurn()
      await rejection
      await vi.waitFor(() => expect(summaryClosed).toBe(true))
      expect(agent.getHistory().slice(0, history.length)).toEqual(history)
      expect(streamRequests).toBe(1)
      expect(JSON.stringify(agent.getContext())).not.toContain('compressed historical context')
      agent.reset()
    }
  )
})
