import { createServer } from 'node:http'
import { makeTempWorkspace, CLI_ENTRY } from './cli.js'
import { startHumanTerminal } from './human-terminal.js'

export type LiveBlock = { type: string; [key: string]: unknown }
export type LiveRequest = {
  model: string
  max_tokens: number
  stream?: boolean
  system?: string
  tools?: unknown[]
  messages: Array<{ role: string; content: string | LiveBlock[] }>
}

export interface LivePtySession {
  session: ReturnType<typeof startHumanTerminal>
  env: Record<string, string>
  requests: LiveRequest[]
  responses: Array<{ path: string; status: number; blockTypes?: string[]; stopReason?: string }>
  cwd: string
  input(value: string, from?: number): Promise<number>
  close(): Promise<void>
}

/** Records request bodies, never credentials; every response comes from the real provider. */
export async function startLivePty(files: Record<string, string> = {}): Promise<LivePtySession> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing live API configuration')
  const workspace = await makeTempWorkspace(files)
  const upstream = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
  const requests: LiveRequest[] = []
  const responses: LivePtySession['responses'] = []
  const server = createServer(async (req, res) => {
    const controller = new AbortController()
    res.once('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    try {
      let body = ''
      for await (const chunk of req) body += chunk
      const request = JSON.parse(body) as LiveRequest
      requests.push(request)
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (['host', 'connection', 'content-length', 'accept-encoding'].includes(name)) continue
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const response = await fetch(upstream.replace(/\/$/, '') + req.url, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      })
      const observation: LivePtySession['responses'][number] = {
        path: req.url ?? '',
        status: response.status,
      }
      responses.push(observation)
      if (!response.ok) {
        // Provider diagnostics may echo credentials. Preserve the status, not the body.
        res.writeHead(response.status, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'api_error',
              message: `Live upstream returned HTTP ${response.status}`,
            },
          })
        )
        return
      }
      res.writeHead(response.status, {
        'content-type': response.headers.get('content-type') ?? 'application/json',
      })
      if (!request.stream) {
        const body = await response.text()
        const parsed = JSON.parse(body) as { content?: LiveBlock[]; stop_reason?: string }
        observation.blockTypes = parsed.content?.map(block => block.type)
        observation.stopReason = parsed.stop_reason
        res.write(body)
      } else if (response.body) for await (const chunk of response.body) res.write(chunk)
      res.end()
    } catch {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: 'Live upstream connection failed' },
        })
      )
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing live proxy port')
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    MODEL_NAME: process.env.MODEL_NAME ?? 'claude-sonnet-4-20250514',
    CONTEXT_WINDOW: process.env.CONTEXT_WINDOW ?? '30000',
    MAX_INPUT_TOKENS: process.env.MAX_INPUT_TOKENS ?? '24000',
    MAX_OUTPUT_TOKENS: process.env.MAX_OUTPUT_TOKENS ?? '2048',
    CONTEXT_COUNTING: 'conservative',
  }
  const session = startHumanTerminal(CLI_ENTRY, [], workspace.dir, true, { env, timeoutMs: 90_000 })
  return {
    session,
    env,
    requests,
    responses,
    cwd: workspace.dir,
    async input(value: string, from = 0): Promise<number> {
      await session.waitFor('你: ', from)
      const next = session.output.length
      session.write(value + '\r')
      // Readline can redraw "你: " while echoing a long line. Start after its Enter echo.
      await session.waitFor(/\n/, next)
      return session.output.indexOf('\n', next) + 1
    },
    async close(): Promise<void> {
      try {
        session.signal('SIGTERM')
        await session.waitExit()
      } finally {
        await session.close()
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
        await workspace.cleanup()
      }
    },
  }
}

export function liveToolCalls(requests: LiveRequest[]): LiveBlock[] {
  return requests.flatMap(request =>
    request.messages.flatMap(message =>
      Array.isArray(message.content)
        ? message.content.filter(block => block.type === 'tool_use')
        : []
    )
  )
}
