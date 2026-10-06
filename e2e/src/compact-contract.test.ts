import { spawn } from 'node:child_process'
import { createServer, type ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { ContextBudget, type ContextRequest } from '../../packages/core/dist/context-budget.js'
import { CLI_ENTRY, makeTempWorkspace } from './helpers/cli.js'

type Request = ContextRequest & { stream?: boolean }
type Step = string | ((requests: Request[], stdout: string) => Promise<string>)
const MODEL = 'compact-contract-model'
const SUMMARY = 'HANDOFF: project constraints and verified progress retained.'
const options = { contextWindow: 30_000, maxInputTokens: 24_000, maxOutputTokens: 4096 }

/** Main requests use real SDK SSE; compaction must use a tool-free JSON request. */
function reply(res: ServerResponse, request: Request, text: string): void {
  const message = {
    id: 'msg_compact_contract',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  if (!request.stream) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(message))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, value: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  event('message_start', { message: { ...message, content: [], stop_reason: null } })
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
  event('content_block_stop', { index: 0 })
  event('message_delta', {
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  event('message_stop', {})
  res.end()
}

async function exercise(
  steps: Step[],
  respond: (res: ServerResponse, request: Request, requests: Request[]) => void,
  onOutput?: (stdout: string, requests: Request[]) => void
) {
  const workspace = await makeTempWorkspace()
  const requests: Request[] = []
  const paths: string[] = []
  const server = createServer(async (req, res) => {
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const request = JSON.parse(body) as Request
      paths.push(req.url ?? '')
      requests.push(request)
      respond(res, request, requests)
    } catch {
      res.writeHead(500).end('Invalid contract request')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local provider port')
  const child = spawn(process.execPath, [CLI_ENTRY], {
    cwd: workspace.dir,
    // Deliberately do not inherit provider credentials, model configuration or local env files.
    env: {
      PATH: process.env.PATH,
      ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      // These older contracts exercise session/compaction with explicit edit authorization.
      PERMISSION_MODE: 'accept-edits',
      ANTHROPIC_API_KEY: 'local-contract-placeholder',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      MODEL_NAME: MODEL,
      CONTEXT_WINDOW: String(options.contextWindow),
      MAX_INPUT_TOKENS: String(options.maxInputTokens),
      MAX_OUTPUT_TOKENS: String(options.maxOutputTokens),
      CONTEXT_COUNTING: 'conservative',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
    onOutput?.(stdout, requests)
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('close', resolve)
    child.once('error', reject)
  })
  try {
    for (const [index, step] of steps.entries()) {
      await vi.waitFor(
        () => {
          expect(child.exitCode, stderr).toBeNull()
          expect(stdout.split('你: ').length - 1).toBeGreaterThan(index)
        },
        { timeout: 10_000 }
      )
      const line = typeof step === 'string' ? step : await step(requests, stdout)
      child.stdin.write(`${line}\n`)
    }
    await vi.waitFor(() => expect(child.exitCode, stderr).toBe(0), { timeout: 10_000 })
    await closed
    return { requests, paths, stdout, stderr }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await closed
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await workspace.cleanup()
  }
}

function assertBudgets(requests: Request[]): void {
  const budget = new ContextBudget(MODEL, options)
  for (const { stream: _stream, ...payload } of requests) {
    // Match the pre-transport envelope: UTF-8 bytes plus per-message/schema overhead,
    // including system instructions, tools, output reservation and JSON escaping.
    const expected =
      Buffer.byteLength(JSON.stringify(payload), 'utf8') +
      256 +
      payload.messages.length * 32 +
      (payload.tools?.length ?? 0) * 64
    expect(budget.estimate(payload)).toBe(expected)
    expect(expected).toBeLessThanOrEqual(budget.inputLimit)
    expect(payload.max_tokens).toBeGreaterThan(0)
    if (payload.max_tokens !== options.maxOutputTokens) expect(payload.tools).toBeUndefined()
  }
}

const mainRequests = (requests: Request[]) => requests.filter(request => request.stream)
const summaryRequests = (requests: Request[]) => requests.filter(request => !request.stream)
const mainText = 'observed progress; '.repeat(100)

describe('CLI compaction contract (local HTTP provider, no credentials)', () => {
  it('handles exact /compact locally and continues using a summary and the latest input', async () => {
    const result = await exercise(
      [
        'first question',
        'latest correction: keep the public API',
        '/compact',
        'continue from here',
        'exit',
      ],
      (res, request) => reply(res, request, request.stream ? mainText : SUMMARY)
    )
    const mains = mainRequests(result.requests)
    const summaries = summaryRequests(result.requests)
    expect(mains).toHaveLength(3)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].tools).toBeUndefined()
    expect(summaries[0].stream).not.toBe(true)
    expect(JSON.stringify(summaries[0].messages)).toContain(
      'latest correction: keep the public API'
    )
    expect(
      mains.flatMap(request => request.messages).some(message => message.content === '/compact')
    ).toBe(false)
    expect(JSON.stringify(mains[2].messages)).toContain(SUMMARY)
    expect(JSON.stringify(mains[2].messages)).not.toContain(mainText)
    expect(mains[2].messages.at(-1)).toEqual({ role: 'user', content: 'continue from here' })
    expect(result.stdout).toContain('正在压缩上下文')
    expect(result.stdout).toContain('完整会话记录保留')
    expect(result.stderr).toBe('')
    expect(result.paths.every(path => path === '/v1/messages')).toBe(true)
    assertBudgets(result.requests)
  })

  it('does not interpret /compact extra or /compactish as local commands', async () => {
    const result = await exercise(['/compact extra', '/compactish', 'exit'], (res, request) =>
      reply(res, request, 'ordinary answer')
    )
    expect(summaryRequests(result.requests)).toHaveLength(0)
    expect(mainRequests(result.requests).map(request => request.messages.at(-1)?.content)).toEqual([
      '/compact extra',
      '/compactish',
    ])
    assertBudgets(result.requests)
  })

  it('keeps the next turn usable and history intact after manual compression fails', async () => {
    const result = await exercise(['first', '/compact', 'recover', 'exit'], (res, request) => {
      if (request.stream) reply(res, request, mainText)
      else
        res.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'summary-contract-failure' },
          })
        )
    })
    expect(summaryRequests(result.requests)).toHaveLength(1)
    const mains = mainRequests(result.requests)
    expect(mains).toHaveLength(2)
    expect(mains[1].messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: mainText }] },
      { role: 'user', content: 'recover' },
    ])
    expect(result.stderr).toContain('Context compression failed')
    expect(result.stdout).toContain('原始记录已保留')
    assertBudgets(result.requests)
  })

  it('clears the adopted summary on /new', async () => {
    const result = await exercise(
      ['old task', '/compact', '/new', 'fresh task', 'exit'],
      (res, request) => reply(res, request, request.stream ? mainText : SUMMARY)
    )
    expect(summaryRequests(result.requests)).toHaveLength(1)
    expect(mainRequests(result.requests).at(-1)?.messages).toEqual([
      { role: 'user', content: 'fresh task' },
    ])
    expect(result.stdout).toContain('已开始新对话')
    assertBudgets(result.requests)
  })

  it('keeps main and summary requests bounded over forty growing turns', async () => {
    const inputs = Array.from({ length: 40 }, (_, index) => `round-${index}: preserve constraints`)
    const result = await exercise([...inputs, 'exit'], (res, request) =>
      reply(res, request, request.stream ? '多字节 observations; '.repeat(220) : SUMMARY)
    )
    const mains = mainRequests(result.requests)
    const summaries = summaryRequests(result.requests)
    expect(mains, result.stderr).toHaveLength(inputs.length)
    expect(summaries.length).toBeGreaterThan(2)
    expect(summaries.length).toBeLessThanOrEqual(inputs.length * 3)
    for (const [index, request] of mains.entries()) {
      expect(request.messages.at(-1)).toEqual({ role: 'user', content: inputs[index] })
    }
    expect(JSON.stringify(mains.at(-1)?.messages)).toContain(SUMMARY)
    expect(result.stdout).toContain('上下文压缩完成')
    expect(result.stderr).toBe('')
    assertBudgets(result.requests)
  })

  it('promotes pending background compression to a foreground wait before sending the next turn', async () => {
    let pending: { res: ServerResponse; request: Request } | undefined
    let mainsAtRelease: number | undefined
    let promptsAtRelease: number | undefined
    const rounds = Array.from({ length: 4 }, (_, index) => `old-round-${index}`)
    const result = await exercise(
      [...rounds, 'exit'],
      (res, request) => {
        if (request.stream) reply(res, request, 'old observation; '.repeat(280))
        else if (mainsAtRelease === undefined) pending = { res, request }
        else reply(res, request, SUMMARY)
      },
      (stdout, requests) => {
        // Release the provider only when the CLI announces the foreground gate.
        // A fourth main request or prompt must not exist while this summary is pending.
        if (pending && stdout.includes('正在等待后台压缩')) {
          mainsAtRelease = mainRequests(requests).length
          promptsAtRelease = stdout.split('你: ').length - 1
          const { res, request } = pending
          pending = undefined
          reply(res, request, SUMMARY)
        }
      }
    )
    expect(mainsAtRelease).toBe(3)
    expect(promptsAtRelease).toBe(4)
    const mains = mainRequests(result.requests)
    expect(mains).toHaveLength(4)
    expect(JSON.stringify(mains[3].messages)).toContain(SUMMARY)
    expect(mains[3].messages.at(-1)).toEqual({ role: 'user', content: rounds[3] })
    expect(result.stdout).toContain('正在后台压缩历史')
    expect(result.stdout).toContain('上下文压缩完成')
    expect(result.stderr).toBe('')
    assertBudgets(result.requests)
  })

  it('cancels pending background compaction on /new without contaminating the new session', async () => {
    let pending: ServerResponse | undefined
    let aborted = false
    const rounds = Array.from({ length: 3 }, (_, index) => `old-round-${index}`)
    const result = await exercise(
      [
        ...rounds,
        async (requests, stdout) => {
          await vi.waitFor(() => expect(summaryRequests(requests)).toHaveLength(1))
          expect(pending).toBeDefined()
          const { stream: _stream, ...payload } = mainRequests(requests).at(-1)!
          const budget = new ContextBudget(MODEL, options)
          expect(budget.estimate(payload)).toBeGreaterThanOrEqual(budget.backgroundLimit)
          expect(budget.estimate(payload)).toBeLessThan(budget.foregroundLimit)
          expect(stdout).not.toContain('正在等待后台压缩')
          return '/new'
        },
        async () => {
          await vi.waitFor(() => expect(aborted).toBe(true))
          return 'brand new task'
        },
        'exit',
      ],
      (res, request) => {
        if (request.stream) reply(res, request, 'old observation; '.repeat(280))
        else {
          pending = res
          res.once('close', () => {
            aborted = !res.writableEnded
          })
          // Keep the HTTP request pending until /new aborts its controller, with no sleeps.
        }
      }
    )
    expect(mainRequests(result.requests).at(-1)?.messages).toEqual([
      { role: 'user', content: 'brand new task' },
    ])
    expect(summaryRequests(result.requests)).toHaveLength(1)
    expect(result.stderr).toBe('')
    assertBudgets(result.requests)
  })
})
