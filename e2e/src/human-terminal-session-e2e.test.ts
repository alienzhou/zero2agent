import { createServer, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CLI_ENTRY, makeTempWorkspace } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'

type Block = { type: string; [key: string]: unknown }
type Message = { role: string; content: string | Block[] }
type Request = {
  model: string
  messages: Message[]
  stream?: boolean
  tools?: unknown[]
  max_tokens: number
  system?: string
}
type Session = ReturnType<typeof startHumanTerminal>
const MODEL = 'pty-session-e2e-provider'
const SECRET = 'fake-private-key-4937'
const PRIVATE_OUTPUT = 'private-display-marker-8251'
const SUMMARY =
  'Handoff: terminal completed; receipt metadata retained; private content unavailable.'
const CONFIRM = 'Allow human terminal? [y/N]'

/** An external HTTP provider drives the production SDK, CLI, tools and native PTYs. */
function reply(res: ServerResponse, request: Request, blocks: Block[]): void {
  const stopReason = blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn'
  const message = {
    id: 'msg_pty_session_e2e',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: blocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  if (!request.stream) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(message))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, value: object): void => {
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  }
  event('message_start', { message: { ...message, content: [], stop_reason: null } })
  blocks.forEach((block, index) => {
    const tool = block.type === 'tool_use'
    event('content_block_start', {
      index,
      content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' },
    })
    event('content_block_delta', {
      index,
      delta: tool
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text },
    })
    event('content_block_stop', { index })
  })
  event('message_delta', {
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  event('message_stop', {})
  res.end()
}

function text(value: string): Block[] {
  return [{ type: 'text', text: value }]
}
function terminal(command: string, interactive = true): Block[] {
  return [{ type: 'tool_use', id: 'terminal_1', name: 'terminal', input: { command, interactive } }]
}
function results(request: Request): Block[] {
  return request.messages.flatMap(message =>
    Array.isArray(message.content) ? message.content.filter(b => b.type === 'tool_result') : []
  )
}
function assertPrivate(requests: Request[]): void {
  const encoded = JSON.stringify(requests)
  expect(encoded).not.toContain(SECRET)
  expect(encoded).not.toContain(PRIVATE_OUTPUT)
}
function assertPairs(request: Request): void {
  const calls = new Set<string>()
  for (const message of request.messages) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block.type === 'tool_use') calls.add(String(block.id))
      if (block.type === 'tool_result') {
        expect(calls.delete(String(block.tool_use_id))).toBe(true)
      }
    }
  }
  expect(calls.size).toBe(0)
}

describe.skipIf(process.platform === 'win32')('E02-S004 + E03-S001: real CLI/SDK/PTY E2E', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  async function provider(
    respond: (res: ServerResponse, request: Request, requests: Request[]) => void,
    files: Record<string, string> = {}
  ) {
    const workspace = await makeTempWorkspace(files)
    cleanups.push(workspace.cleanup)
    const requests: Request[] = []
    const errors: unknown[] = []
    const server = createServer(async (req, res) => {
      try {
        let body = ''
        for await (const chunk of req) body += chunk
        expect(req.url).toBe('/v1/messages')
        const request = JSON.parse(body) as Request
        requests.push(request)
        respond(res, request, requests)
      } catch (error) {
        errors.push(error)
        if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'E2E assertion failed' },
          })
        )
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing E2E provider port')
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      expect(errors).toEqual([])
    })
    const env = {
      ANTHROPIC_API_KEY: 'local-e2e-placeholder',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      MODEL_NAME: MODEL,
      CONTEXT_WINDOW: '30000',
      MAX_INPUT_TOKENS: '24000',
      MAX_OUTPUT_TOKENS: '4096',
      CONTEXT_COUNTING: 'conservative',
      ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      // This earlier contract covers human handoff and sessions, with explicit host grants.
      PERMISSION_MODE: 'accept-edits',
      PERMISSION_RULES: JSON.stringify([{ tool: 'terminal', action: 'allow' }]),
    }
    return { cwd: workspace.dir, requests, env }
  }

  function start(cwd: string, env: Record<string, string>): Session {
    const session = startHumanTerminal(CLI_ENTRY, [], cwd, true, { env })
    cleanups.push(async () => {
      try {
        session.signal('SIGTERM')
        await session.waitExit()
      } finally {
        await session.close()
      }
    })
    return session
  }

  async function line(session: Session, value: string, from = 0): Promise<number> {
    await session.waitFor('你: ', from)
    const next = session.output.length
    session.write(value + '\r')
    return next
  }
  async function approve(session: Session, from: number): Promise<void> {
    await session.waitFor(CONFIRM, from)
    session.write('y\r')
    await session.waitFor('Human terminal active', from)
  }
  async function finish(session: Session, from: number): Promise<void> {
    await line(session, 'exit', from)
    expect(await session.waitExit()).toBe(0)
  }

  const privateScript = `read -rs -p 'PRIVATE_READY' token\nprintf '%s' "$token" > human-effect.txt\nprintf '\\n${PRIVATE_OUTPUT}\\n'\n`

  it('keeps model-driven and direct handoffs private across another turn, /compact and /new', async () => {
    const p = await provider(
      (res, request, requests) => {
        if (!request.stream) {
          expect(request.tools).toBeUndefined()
          reply(res, request, text(SUMMARY))
        } else if (requests.length === 1) reply(res, request, terminal('bash ./private.sh'))
        else
          reply(
            res,
            request,
            text('Verified receipt only; no access to private terminal content. '.repeat(30))
          )
      },
      { 'private.sh': privateScript, 'direct.sh': privateScript }
    )
    const session = start(p.cwd, p.env)
    let from = await line(session, 'Start the human-controlled task.')
    await session.waitFor(CONFIRM, from)
    expect(p.requests).toHaveLength(1)
    await expect(fs.access(path.join(p.cwd, 'human-effect.txt'))).rejects.toThrow()
    session.write('yes\r')
    await session.waitFor('PRIVATE_READY', from)
    session.write(SECRET + '\r')
    await session.waitFor('你: ', from)
    expect(session.output).toContain(PRIVATE_OUTPUT)
    expect(session.output).not.toContain(SECRET)
    expect(await fs.readFile(path.join(p.cwd, 'human-effect.txt'), 'utf8')).toBe(SECRET)
    expect(p.requests).toHaveLength(2)
    expect(results(p.requests[1])[0].content).toContain('human-controlled completed')
    expect(results(p.requests[1])[0].content).toContain('Exit code: 0')

    from = await line(session, '/terminal bash ./direct.sh', from)
    await approve(session, from)
    await session.waitFor('PRIVATE_READY', from)
    session.write(SECRET + '\r')
    await session.waitFor('你: ', from)
    expect(p.requests).toHaveLength(2)

    from = await line(session, 'Continue using the earlier receipt.', from)
    await session.waitFor('你: ', from)
    expect(p.requests).toHaveLength(3)
    expect(results(p.requests[2])).toHaveLength(1)
    assertPairs(p.requests[2])
    expect(JSON.stringify(p.requests)).not.toContain('direct.sh')
    from = await line(session, '/compact', from)
    await session.waitFor('已压缩工作上下文', from)
    from = await line(session, 'Continue after compression.', from)
    await session.waitFor('你: ', from)
    expect(JSON.stringify(p.requests.at(-1)?.messages)).toContain(SUMMARY)
    expect(p.requests.at(-1)?.messages.at(-1)?.content).toBe('Continue after compression.')
    expect(p.requests.some(r => r.messages.some(m => m.content === '/compact'))).toBe(false)
    assertPrivate(p.requests)
    const count = p.requests.length
    from = await line(session, '/new', from)
    await session.waitFor('已开始新对话', from)
    expect(p.requests).toHaveLength(count)
    from = await line(session, 'A fresh independent task.', from)
    await session.waitFor('你: ', from)
    expect(p.requests.at(-1)?.messages).toEqual([
      { role: 'user', content: 'A fresh independent task.' },
    ])
    expect(await fs.readFile(path.join(p.cwd, 'human-effect.txt'), 'utf8')).toBe(SECRET)
    await finish(session, from)
    expect(await fs.readdir(p.cwd)).toEqual(
      expect.arrayContaining(['private.sh', 'direct.sh', 'human-effect.txt'])
    )
  })

  it('does not execute a declined model request and continues the same session', async () => {
    const p = await provider((res, request, requests) =>
      reply(
        res,
        request,
        requests.length === 1 ? terminal('touch forbidden') : text('Declined request acknowledged.')
      )
    )
    const session = start(p.cwd, p.env)
    let from = await line(session, 'Request a human terminal.')
    await session.waitFor(CONFIRM, from)
    session.write('n\r')
    await session.waitFor('你: ', from)
    expect(session.output).not.toContain('Human terminal active')
    expect(p.requests).toHaveLength(2)
    expect(results(p.requests[1])[0].content).toContain('human-controlled declined')
    await expect(fs.access(path.join(p.cwd, 'forbidden'))).rejects.toThrow()
    from = await line(session, 'Continue without retrying it.', from)
    await session.waitFor('你: ', from)
    expect(p.requests).toHaveLength(3)
    assertPairs(p.requests[2])
    await finish(session, from)
  })

  it('cancels a real child tree, reports cancellation to the provider and restores the REPL', async () => {
    const p = await provider(
      (res, request, requests) =>
        reply(
          res,
          request,
          requests.length === 1 ? terminal('bash ./cancel.sh') : text('Cancellation acknowledged.')
        ),
      {
        'cancel.sh':
          'trap \'exit 0\' TERM\nsleep 300 &\nprintf \'%s %s\' "$$" "$!" > owned-pids.txt\necho CANCEL_READY\nwhile :; do read -r value; done\n',
      }
    )
    const session = start(p.cwd, p.env)
    let from = await line(session, 'Request the long-running human task.')
    await approve(session, from)
    await session.waitFor('CANCEL_READY', from)
    const pids = (await fs.readFile(path.join(p.cwd, 'owned-pids.txt'), 'utf8'))
      .split(' ')
      .map(Number)
    expect(pids).toHaveLength(2)
    expect(pids.every(pid => Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid)).toBe(
      true
    )
    cleanups.push(async () => {
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* Already reaped. */
        }
      }
    })
    session.write('\x1d')
    await session.waitFor('你: ', from)
    expect(results(p.requests[1])[0].content).toContain('human-controlled cancelled')
    await expect
      .poll(() =>
        pids.every(pid => {
          try {
            process.kill(pid, 0)
            return false
          } catch {
            return true
          }
        })
      )
      .toBe(true)
    from = await line(session, 'Continue after cancellation.', from)
    await session.waitFor('你: ', from)
    assertPairs(p.requests.at(-1)!)
    await finish(session, from)
  })

  it('returns a missing-TTY receipt over real HTTP without falling back to shell execution', async () => {
    const p = await provider((res, request, requests) =>
      reply(
        res,
        request,
        requests.length === 1 ? terminal('touch forbidden') : text('TTY is unavailable.')
      )
    )
    const child = spawn(process.execPath, [CLI_ENTRY, 'Request a human terminal.'], {
      cwd: p.cwd,
      env: { PATH: '/usr/bin:/bin', ...p.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once('close', resolve)
      child.once('error', reject)
    })
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      output += chunk.toString()
    })
    cleanups.push(async () => {
      if (child.exitCode === null) child.kill('SIGKILL')
      await exit
    })
    expect(await exit).toBe(0)
    expect(p.requests).toHaveLength(2)
    expect(results(p.requests[1])[0].content).toContain('requires an interactive CLI/TTY')
    expect(output).not.toContain(CONFIRM)
    await expect(fs.access(path.join(p.cwd, 'forbidden'))).rejects.toThrow()
  })

  it('adopts a pending background summary while a real human handoff is active without leaking its content', async () => {
    let pending: { res: ServerResponse; request: Request } | undefined
    let mains = 0
    const p = await provider(
      (res, request) => {
        if (!request.stream) {
          pending = { res, request }
          return
        }
        mains++
        if (mains === 3) reply(res, request, terminal('bash ./private.sh'))
        else reply(res, request, text('old observation; '.repeat(280)))
      },
      { 'private.sh': privateScript }
    )
    const session = start(p.cwd, p.env)
    let from = 0
    for (const input of ['Older task one.', 'Older task two.']) {
      from = await line(session, input, from)
      await session.waitFor('你: ', from)
    }
    from = await line(session, 'Third task needs human takeover.', from)
    await approve(session, from)
    await session.waitFor('PRIVATE_READY', from)
    await expect.poll(() => Boolean(pending)).toBe(true)
    expect(session.output).toContain('正在后台压缩历史')
    expect(mains).toBe(3)
    reply(pending!.res, pending!.request, text('Handoff: older observations preserved.'))
    session.write(SECRET + '\r')
    await session.waitFor('你: ', from)
    const continuation = p.requests.filter(r => r.stream).at(-1)!
    expect(JSON.stringify(continuation.messages)).toContain(
      'Handoff: older observations preserved.'
    )
    expect(results(continuation)[0].content).toContain('human-controlled completed')
    assertPairs(continuation)
    assertPrivate(p.requests)
    await finish(session, from)
  })
})
