import { createServer, type ServerResponse } from 'node:http'
import { Agent, type RuntimeEvent } from '@zero2agent/core'
import { expect, it } from 'vitest'
import { initialState, reduceRuntime } from '../../packages/tui/dist/runtime-state.js'
import { sendSSEReply } from './helpers/sse.js'

it('marks every abandoned model fragment when a background-summary retry splits the display', async () => {
  let mainRequests = 0
  let summaryRequests = 0
  let partial: ServerResponse | undefined
  let sawFirstDraft!: () => void
  const firstDraft = new Promise<void>(resolve => {
    sawFirstDraft = resolve
  })
  const event = (res: ServerResponse, type: string, fields: object = {}) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`)
  const delta = (res: ServerResponse, text: string) =>
    event(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
  const server = createServer(async (req, res) => {
    let data = ''
    for await (const chunk of req) data += chunk
    const body = JSON.parse(data) as { stream?: boolean }
    if (body.stream) {
      if (++mainRequests !== 2) {
        sendSSEReply(res, [
          { type: 'text', text: mainRequests === 1 ? 'a'.repeat(10000) : 'FINAL' },
        ])
        return
      }
      partial = res
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      event(res, 'message_start', {
        message: {
          id: 'draft',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-20250514',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      })
      event(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      delta(res, 'DRAFT ONE')
    } else if (++summaryRequests === 1) {
      // Synchronize on observed SDK text, not a timeout or assumed request order.
      await firstDraft
      res
        .writeHead(500, { 'content-type': 'application/json', 'retry-after-ms': '1' })
        .end('{"type":"error","error":{"type":"api_error","message":"fixture failure"}}')
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'summary',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'The previous historical response was observed.' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 2 },
        })
      )
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  let state = initialState()
  const events: RuntimeEvent[] = []
  const agent = new Agent({
    config: { apiKey: 'review-placeholder', baseURL: `http://127.0.0.1:${address.port}` },
    tools: [],
    context: { contextWindow: 16000, maxOutputTokens: 512, summaryTokens: 256, safetyTokens: 512 },
    limits: { retryBaseMs: 1, requestTimeoutMs: 2000, maxDurationMs: 5000 },
    events: {
      onEvent: e => {
        events.push(e)
        state = reduceRuntime(state, e)
        if (e.type === 'text-delta' && e.text === 'DRAFT ONE') sawFirstDraft()
        if (e.type === 'request-retry' && e.purpose === 'summary' && partial) {
          delta(partial, 'DRAFT TWO')
          event(partial, 'content_block_stop', { index: 0 })
          event(partial, 'message_delta', {
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 2 },
          })
          partial.end() // Deliberately omit message_stop: these two fragments must be abandoned.
          partial = undefined
        }
      },
    },
  })
  try {
    await agent.run('first')
    expect(await agent.run('continue')).toBe('FINAL')
    expect(mainRequests).toBe(3)
    expect(events.some(e => e.type === 'request-retry' && e.purpose === 'summary')).toBe(true)
    const draftEntries = state.entries.filter(e => e.kind !== 'tool' && e.text.includes('DRAFT'))
    expect(draftEntries).toHaveLength(2)
    for (const entry of draftEntries)
      expect(entry).toMatchObject({
        kind: 'notice',
        text: expect.stringContaining('[未完成草稿 · 未写入会话]'),
      })
    expect(state.entries.at(-1)).toMatchObject({ kind: 'text', text: 'FINAL' })
    expect(JSON.stringify(agent.getHistory())).not.toContain('DRAFT')
  } finally {
    agent.cancelCompaction()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
