import { createServer, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CLI_ENTRY, makeTempWorkspace } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'

type Block = { type: string; [key: string]: unknown }
type Request = { stream?: boolean; messages: Array<{ role: string; content: string | Block[] }> }
type Session = ReturnType<typeof startHumanTerminal>

function reply(res: ServerResponse, request: Request, content: Block[]): void {
  const stop = content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn'
  const message = {
    id: 'runtime-tui-e2e',
    type: 'message',
    role: 'assistant',
    model: 'runtime-tui',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  if (!request.stream) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(message))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = (type: string, data: object): void => {
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  }
  emit('message_start', { message: { ...message, content: [], stop_reason: null } })
  content.forEach((block, index) => {
    const tool = block.type === 'tool_use'
    emit('content_block_start', {
      index,
      content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' },
    })
    emit('content_block_delta', {
      index,
      delta: tool
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text },
    })
    emit('content_block_stop', { index })
  })
  emit('message_delta', {
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 1 },
  })
  emit('message_stop', {})
  res.end()
}
const text = (value: string): Block[] => [{ type: 'text', text: value }]
const call = (id: string, name: string, input: object): Block[] => [
  { type: 'tool_use', id, name, input },
]

describe.skipIf(process.platform === 'win32')(
  'E03-S003: default TUI over real SDK, HTTP and PTY',
  () => {
    const cleanups: Array<() => Promise<void>> = []
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
    })

    async function start(
      respond: (res: ServerResponse, request: Request, index: number) => void,
      env: Record<string, string> = {}
    ) {
      const workspace = await makeTempWorkspace()
      cleanups.push(workspace.cleanup)
      const requests: Request[] = []
      const server = createServer(async (req, res) => {
        let body = ''
        for await (const chunk of req) body += chunk
        const request = JSON.parse(body) as Request
        requests.push(request)
        respond(res, request, requests.length)
      })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No server port')
      cleanups.push(async () => {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
      })
      const session = startHumanTerminal(CLI_ENTRY, [], workspace.dir, true, {
        env: {
          ANTHROPIC_API_KEY: 'runtime-test-key',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
          CONTEXT_WINDOW: '30000',
          MAX_INPUT_TOKENS: '24000',
          MAX_OUTPUT_TOKENS: '2048',
          ...env,
        },
      })
      cleanups.push(() => session.close())
      await session.waitFor('你: ')
      return { session, requests, cwd: workspace.dir }
    }

    async function send(session: Session, message: string): Promise<number> {
      const from = session.output.length
      session.write(message + '\r')
      return from
    }

    async function quit(session: Session): Promise<void> {
      session.write('exit\r')
      expect(await session.waitExit()).toBe(0)
      expect(session.output).toContain('\x1b[?1049l')
      expect(session.output).toContain('\x1b[?2004l')
      expect(session.output).toContain('\x1b[?25h')
    }

    it('edits graphemes, preserves multiline paste, supports history/completion and safely renders model controls', async () => {
      const p = await start((res, request) =>
        reply(res, request, text('回答 中文 👨‍👩‍👧‍👦\x1b]52;c;unsafe\x07'))
      )
      expect(p.session.output).toContain('\x1b[?1049h')
      const from = p.session.output.length
      p.session.write('\x1b[200~第一行\n第二行🙂\x1b[201~')
      await p.session.waitFor('第二行🙂', from)
      expect(p.requests).toHaveLength(0)
      const submittedFrom = p.session.output.length
      p.session.write('\x7f!\r')
      await p.session.waitFor('回答 中文', submittedFrom)
      await p.session.waitFor('你: ', submittedFrom)
      expect(p.requests[0].messages.at(-1)?.content).toBe('第一行\n第二行!')
      expect(p.session.output).not.toContain('\x1b]52;')
      expect(p.session.output).toContain('\\u001b]52;c;unsafe\\u0007')
      const historyFrom = p.session.output.length
      p.session.write('\x1b[A\x05\x15/new\r')
      await p.session.waitFor('已开始新对话', historyFrom)
      const newFrom = p.session.output.length
      p.session.write('/ne\t\r')
      await p.session.waitFor('已开始新对话', newFrom)
      await p.session.waitFor('你: ', newFrom)
      p.session.resize(22, 10)
      await p.session.waitFor('zero2agent', p.session.output.length - 400)
      await quit(p.session)
    })

    it('keeps an editable draft while cancelling a pending provider request and starts the next turn', async () => {
      let pending: ServerResponse | undefined
      const p = await start((res, request, index) => {
        if (index === 1) pending = res
        else reply(res, request, text('second-turn-complete'))
      })
      const from = await send(p.session, 'first slow request')
      await expect.poll(() => Boolean(pending)).toBe(true)
      p.session.write('保留草稿🙂')
      await p.session.waitFor('草稿: 保留草稿🙂', from)
      p.session.write('\x03')
      await p.session.waitFor('本轮已取消', from)
      await p.session.waitFor('你: 保留草稿🙂', from)
      p.session.write('\r')
      await p.session.waitFor('second-turn-complete', from)
      expect(p.requests.at(-1)?.messages.at(-1)?.content).toBe('保留草稿🙂')
      await quit(p.session)
    })

    it('provides scrollable full approval, denies by default, and restores the saved draft', async () => {
      const content =
        Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n') + '\nFINAL-PARAMETER'
      const p = await start((res, request, index) =>
        reply(
          res,
          request,
          index === 1
            ? call('write-one', 'write_file', { path: 'denied.txt', content })
            : text('denial-recorded')
        )
      )
      const from = await send(p.session, 'write a long file')
      await p.session.waitFor('允许这次操作', from)
      expect(p.session.output).toContain('工作目录:')
      expect(p.session.output).toContain('原因:')
      p.session.write('\x1b[F')
      await p.session.waitFor('FINAL-PARAMETER', from)
      p.session.write('\r')
      await p.session.waitFor('denial-recorded', from)
      await p.session.waitFor('你: ', from)
      await expect(fs.access(path.join(p.cwd, 'denied.txt'))).rejects.toThrow()
      expect(JSON.stringify(p.requests)).toContain('User denied this call')
      await quit(p.session)
    })

    it('cancels a real foreground command, suppresses remaining tools and can continue', async () => {
      const p = await start(
        (res, request, index) =>
          reply(
            res,
            request,
            index === 1
              ? [
                  ...call('shell-one', 'terminal', { command: 'echo $$ > owned.pid; sleep 300' }),
                  ...call('write-later', 'write_file', { path: 'must-not-exist', content: 'bad' }),
                ]
              : text('continued-after-cancel')
          ),
        { PERMISSION_MODE: 'bypass' }
      )
      const from = await send(p.session, 'run a slow shell')
      await expect
        .poll(async () => fs.readFile(path.join(p.cwd, 'owned.pid'), 'utf8').catch(() => ''))
        .not.toBe('')
      p.session.write('\x03')
      await p.session.waitFor('本轮已取消', from)
      await p.session.waitFor('你: ', from)
      await expect(fs.access(path.join(p.cwd, 'must-not-exist'))).rejects.toThrow()
      const pid = Number(await fs.readFile(path.join(p.cwd, 'owned.pid'), 'utf8'))
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0)
            return true
          } catch {
            return false
          }
        })
        .toBe(false)
      await send(p.session, 'continue')
      await p.session.waitFor('continued-after-cancel', from)
      await quit(p.session)
    })

    it('releases the screen and input for an exclusive human PTY, then restores the TUI', async () => {
      const p = await start((res, request) => reply(res, request, text('unused')))
      const from = await send(
        p.session,
        '/terminal read -r -p PRIVATE_READY value; printf "PRIVATE_OUTPUT:%s\\n" "$value"'
      )
      await p.session.waitFor('Allow human terminal? [y/N]', from)
      p.session.write('y\r')
      await p.session.waitFor('PRIVATE_READY', from)
      const privateFrom = p.session.output.length
      p.session.write('private-key\r')
      await p.session.waitFor('你: ', privateFrom)
      const handoff = p.session.output.slice(from)
      expect(handoff).toContain('\x1b[?1049l')
      expect(handoff).toContain('PRIVATE_OUTPUT:private-key')
      expect(handoff).toContain('\x1b[?1049h')
      expect(p.requests).toHaveLength(0)
      await quit(p.session)
    })

    it('approves only an explicit decision, preserves draft input and expands tool details', async () => {
      let first: { res: ServerResponse; request: Request } | undefined
      const p = await start((res, request, index) => {
        if (index === 1) first = { res, request }
        else reply(res, request, text('approved-operation-finished'))
      })
      const from = await send(p.session, 'please write')
      await expect.poll(() => Boolean(first)).toBe(true)
      p.session.write('next-draft')
      await p.session.waitFor('草稿: next-draft', from)
      reply(
        first!.res,
        first!.request,
        call('write-allowed', 'write_file', {
          path: 'allowed.txt',
          content: 'FIRST-LINE\n'.repeat(30) + 'TOOL-DETAIL-END',
        })
      )
      await p.session.waitFor('允许这次操作', from)
      p.session.write('\x1b[200~y\r\x1b[201~')
      await new Promise(resolve => setTimeout(resolve, 100))
      await expect(fs.access(path.join(p.cwd, 'allowed.txt'))).rejects.toThrow()
      p.session.write('y')
      await p.session.waitFor('approved-operation-finished', from)
      await p.session.waitFor('你: next-draft', from)
      expect(await fs.readFile(path.join(p.cwd, 'allowed.txt'), 'utf8')).toContain(
        'TOOL-DETAIL-END'
      )
      const detailsFrom = p.session.output.length
      p.session.write('\x0f')
      await p.session.waitFor('FIRST-LINE', detailsFrom)
      p.session.write('\x1b[1;5F')
      await p.session.waitFor('TOOL-DETAIL-END', detailsFrom)
      p.session.write('\x15')
      await quit(p.session)
    })

    it('cancels an approval without side effects and ignores its late answer', async () => {
      const p = await start((res, request, index) =>
        reply(
          res,
          request,
          index === 1
            ? call('cancel-approval', 'write_file', { path: 'never.txt', content: 'forbidden' })
            : text('next-answer')
        )
      )
      const from = await send(p.session, 'request approval')
      await p.session.waitFor('允许这次操作', from)
      p.session.write('\x03')
      await p.session.waitFor('本轮已取消', from)
      await p.session.waitFor('你: ', from)
      await expect(fs.access(path.join(p.cwd, 'never.txt'))).rejects.toThrow()
      expect(p.requests).toHaveLength(1)
      await send(p.session, 'continue')
      await p.session.waitFor('next-answer', from)
      await quit(p.session)
    })

    it('shows explicit compaction progress and returns to the composer', async () => {
      let summary: { res: ServerResponse; request: Request } | undefined
      const p = await start((res, request) => {
        if (!request.stream) summary = { res, request }
        else reply(res, request, text('a useful observation with sufficient history. '.repeat(80)))
      })
      let from = await send(p.session, 'first question')
      await p.session.waitFor('你: ', from)
      from = await send(p.session, '/compact')
      await expect.poll(() => Boolean(summary)).toBe(true)
      await p.session.waitFor('正在压缩上下文', from)
      reply(summary!.res, summary!.request, text('Summary: important observations retained.'))
      await p.session.waitFor('已压缩工作上下文', from)
      await p.session.waitFor('你: ', from)
      await quit(p.session)
    })

    it('clears an idle draft before exiting and supports explicit multiline editing', async () => {
      const p = await start((res, request) => reply(res, request, text('edited-answer')))
      let from = p.session.output.length
      p.session.write('discard-me')
      await p.session.waitFor('你: discard-me', from)
      p.session.write('\x03')
      await p.session.waitFor('草稿已清空', from)
      from = p.session.output.length
      p.session.write('first\nsecond\x1b[A\x01X\x1b[B\x05Y\r')
      await p.session.waitFor('edited-answer', from)
      expect(p.requests[0].messages.at(-1)?.content).toBe('Xfirst\nsecondY')
      await quit(p.session)
    })

    it('ends an interrupted paste at human-PTY ownership handoff and restores the draft', async () => {
      let first: { res: ServerResponse; request: Request } | undefined
      const p = await start(
        (res, request, index) => {
          if (index === 1) first = { res, request }
          else reply(res, request, text(index === 2 ? 'handoff-returned' : 'draft-sent'))
        },
        { PERMISSION_MODE: 'bypass' }
      )
      const from = await send(p.session, 'ask for private terminal')
      await expect.poll(() => Boolean(first)).toBe(true)
      p.session.write('\x1b[200~draft-start')
      await p.session.waitFor('草稿: draft-start', from)
      reply(
        first!.res,
        first!.request,
        call('handoff', 'terminal', { command: 'echo SHOULD_NOT_RUN', interactive: true })
      )
      await p.session.waitFor('Allow human terminal? [y/N]', from)
      p.session.write('\x1b[201~')
      await p.session.waitFor('handoff-returned', from)
      await p.session.waitFor('你: draft-start', from)
      p.session.write('after\r')
      await p.session.waitFor('draft-sent', from)
      expect(p.requests.at(-1)?.messages.at(-1)?.content).toBe('draft-startafter')
      await quit(p.session)
    })

    it('restores screen modes on SIGTERM while the provider is pending', async () => {
      const p = await start(() => {})
      await send(p.session, 'pending')
      await expect.poll(() => p.requests.length).toBe(1)
      p.session.signal('SIGTERM')
      expect(await p.session.waitExit()).toBe(143)
      expect(p.session.output).toContain('\x1b[?1049l')
      expect(p.session.output).toContain('\x1b[?2004l')
    })
  }
)
