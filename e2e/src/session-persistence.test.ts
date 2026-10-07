import { createServer, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { CLI_ENTRY, makeTempWorkspace, runCli } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
import { sendSSEReply, type SSEBlock } from './helpers/sse.js'

type Request = { stream?: boolean; messages: Array<{ role: string; content: string | SSEBlock[] }> }
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean()
})
async function fixture(respond?: (res: ServerResponse, request: Request, count: number) => void) {
  const workspace = await makeTempWorkspace()
  cleanups.push(workspace.cleanup)
  const root = path.join(workspace.dir, 'private-sessions')
  const store = await SessionStore.open(workspace.dir, root)
  const requests: Request[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body) as Request
    requests.push(request)
    if (respond) respond(res, request, requests.length)
    else sendSSEReply(res, [{ type: 'text', text: 'actual saved answer' }])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const env = {
    ZERO2AGENT_SESSION_DIR: root,
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    ANTHROPIC_API_KEY: 'session-test-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    PERMISSION_MODE: 'accept-edits',
    CONTEXT_WINDOW: '30000',
    MAX_INPUT_TOKENS: '24000',
    MAX_OUTPUT_TOKENS: '2048',
  }
  return { cwd: workspace.dir, store, requests, env, root }
}
async function seed(store: SessionStore, title: string, summary = '') {
  return store.save(store.fresh(), {
    messages: [
      { role: 'user', content: title },
      { role: 'assistant', content: 'old answer' },
    ],
    context: { through: summary ? 2 : 0, summary },
  })
}

describe('E03-S004: production CLI session persistence', () => {
  it('saves from process A and sends restored raw history from process B under the same ID', async () => {
    const p = await fixture()
    expect(
      (await runCli({ cwd: p.cwd, env: p.env, args: ['remember 中文 and file evidence'] })).code
    ).toBe(0)
    const [item] = await p.store.list()
    expect(item.revision).toBe(2)
    const second = await runCli({ cwd: p.cwd, env: p.env, args: ['--resume', item.id, 'continue'] })
    expect(second.code, second.output).toBe(0)
    expect(p.requests).toHaveLength(2)
    expect(p.requests[1].messages[0].content).toBe('remember 中文 and file evidence')
    expect(JSON.stringify(p.requests[1].messages)).toContain('actual saved answer')
    expect(p.requests[1].messages.at(-1)?.content).toBe('continue')
    expect(await p.store.list()).toHaveLength(1)
    expect((await p.store.load(item.id)).revision).toBe(4)
  })
  it('lists without credentials, safely displays controls, and keeps --no-save entirely in memory', async () => {
    const p = await fixture()
    const saved = await seed(p.store, 'title\x1b]52;c;payload\x07')
    const result = await runCli({
      cwd: p.cwd,
      env: { ...p.env, ANTHROPIC_API_KEY: undefined },
      args: ['--list-sessions'],
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(saved.id)
    expect(result.stdout).not.toContain('\x1b]52;')
    expect(result.stdout).toContain('\\u001b')
    expect((await runCli({ cwd: p.cwd, env: p.env, args: ['--no-save', 'ephemeral'] })).code).toBe(
      0
    )
    expect(await p.store.list()).toHaveLength(1)
    expect((await p.store.load(saved.id)).revision).toBe(1)
  })
  it('uses current permissions after resume and never persists host credentials', async () => {
    const p = await fixture((res, _request, count) => {
      if (count === 1 || count === 3)
        sendSSEReply(
          res,
          [
            {
              type: 'tool_use',
              id: `write-${count}`,
              name: 'write_file',
              input: { path: count === 1 ? 'approved.txt' : 'not-approved.txt', content: 'effect' },
            },
          ],
          'tool_use'
        )
      else sendSSEReply(res, [{ type: 'text', text: 'permission result observed' }])
    })
    expect((await runCli({ cwd: p.cwd, env: p.env, args: ['first approved edit'] })).code).toBe(0)
    const [item] = await p.store.list()
    const resumed = await runCli({
      cwd: p.cwd,
      env: { ...p.env, PERMISSION_MODE: 'default' },
      args: ['--resume', item.id, 'new edit requires approval'],
    })
    expect(resumed.code, resumed.output).toBe(0)
    expect(await fs.readFile(path.join(p.cwd, 'approved.txt'), 'utf8')).toBe('effect')
    await expect(fs.stat(path.join(p.cwd, 'not-approved.txt'))).rejects.toThrow()
    expect(JSON.stringify(p.requests.at(-1))).toContain('denied')
    const stored = JSON.stringify(await p.store.load(item.id))
    expect(stored).not.toContain('session-test-key')
    expect(stored).not.toContain('ANTHROPIC_API_KEY')
    expect(stored).not.toContain('accept-edits')
  })

  it('restores a persisted summary into the actual request and rejects corrupt/foreign versions before HTTP', async () => {
    const p = await fixture()
    const saved = await seed(p.store, 'original task', 'summary of adopted evidence')
    const result = await runCli({ cwd: p.cwd, env: p.env, args: ['--continue', 'follow up'] })
    expect(result.code, result.output).toBe(0)
    expect(JSON.stringify(p.requests[0].messages)).toContain('summary of adopted evidence')
    expect(JSON.stringify(p.requests[0].messages)).not.toContain('old answer')
    const latest = await p.store.load(saved.id)
    await fs.writeFile(
      path.join(p.store.directory, saved.id, `${latest.revision}.json`),
      JSON.stringify({ ...latest, version: 999 })
    )
    const failed = await runCli({
      cwd: p.cwd,
      env: p.env,
      args: ['--resume', saved.id, 'must not send'],
    })
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('Unsupported session')
    expect(p.requests).toHaveLength(1)
  })
})

describe.skipIf(process.platform === 'win32')(
  'E03-S004: session selection and crash recovery over PTY',
  () => {
    it('opens the selector, keeps focus and draft on Escape, restores historical tools without replay, then continues', async () => {
      const p = await fixture()
      const saved = await p.store.save(p.store.fresh(), {
        messages: [
          { role: 'user', content: 'old task' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'old-call',
                name: 'write_file',
                input: { path: 'do-not-replay.txt', content: 'old content' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'old-call', content: 'old write result' },
            ],
          },
          { role: 'assistant', content: 'old answer' },
        ],
        context: { through: 0, summary: '' },
      })
      const session = startHumanTerminal(CLI_ENTRY, [], p.cwd, true, { env: p.env })
      cleanups.push(() => session.close())
      await session.waitFor('你: ')
      let from = session.output.length
      session.write('/sessions\r')
      await session.waitFor('选择会话', from)
      session.write('private-modal-input\x1b[200~not-a-chat\x1b[201~')
      session.write('\x1b')
      await session.waitFor('你: ', from)
      from = session.output.length
      session.write('/sessions\r')
      await session.waitFor('选择会话', from)
      from = session.output.length
      session.write('\r')
      await session.waitFor('已恢复会话', from)
      expect(p.requests).toHaveLength(0)
      await expect(fs.stat(path.join(p.cwd, 'do-not-replay.txt'))).rejects.toThrow()
      session.write('\x0f')
      await session.waitFor('old write result', from)
      from = session.output.length
      session.write('continue\r')
      await session.waitFor('actual saved answer', from)
      await session.waitFor('已保存 r3', from)
      expect(JSON.stringify(p.requests[0])).toContain('old write result')
      expect(JSON.stringify(p.requests[0])).not.toContain('private-modal-input')
      expect(JSON.stringify(p.requests[0])).not.toContain('not-a-chat')
      expect((await p.store.load(saved.id)).state.messages.at(-1)).toMatchObject({
        role: 'assistant',
      })
      session.write('exit\r')
      expect(await session.waitExit()).toBe(0)
      expect(session.output).toContain('\x1b[?1049l')
    })
    it('refuses a still-running pending session, recovers after SIGKILL, and preserves effects without replay', async () => {
      const p = await fixture((res, _request, count) => {
        if (count === 1) sendSSEReply(res, [{ type: 'text', text: 'settled first answer' }])
        else if (count === 2)
          sendSSEReply(
            res,
            [
              {
                type: 'tool_use',
                id: 'crash-write',
                name: 'write_file',
                input: { path: 'effect.txt', content: 'already happened' },
              },
            ],
            'tool_use'
          )
        else if (count === 3) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.flushHeaders()
        } else sendSSEReply(res, [{ type: 'text', text: 'recovered actual answer' }])
      })
      const session = startHumanTerminal(CLI_ENTRY, [], p.cwd, true, { env: p.env })
      cleanups.push(() => session.close())
      await session.waitFor('你: ')
      session.write('first task\r')
      await session.waitFor('已保存 r2')
      const [item] = await p.store.list()
      const from = session.output.length
      session.write('make effect then wait\r')
      await session.waitFor('effect.txt', from)
      // Wait for the actual follow-up request, proving the tool completed.
      for (let i = 0; p.requests.length < 3 && i < 100; i++)
        await new Promise(resolve => setTimeout(resolve, 20))
      expect(p.requests).toHaveLength(3)
      expect(await fs.readFile(path.join(p.cwd, 'effect.txt'), 'utf8')).toBe('already happened')
      const denied = await runCli({
        cwd: p.cwd,
        env: p.env,
        args: ['--resume', item.id, 'unsafe concurrent'],
      })
      expect(denied.code).toBe(1)
      expect(denied.stderr).toContain('仍在运行')
      expect(p.requests).toHaveLength(3)
      session.signal('SIGKILL')
      await session.waitExit()
      const resumed = await runCli({
        cwd: p.cwd,
        env: p.env,
        args: ['--resume', item.id, 'inspect after crash'],
      })
      expect(resumed.code, resumed.output).toBe(0)
      expect(p.requests).toHaveLength(4)
      const restored = JSON.stringify(p.requests[3].messages)
      expect(restored).toContain('settled first answer')
      expect(restored).toContain('previous process stopped')
      expect(restored).not.toContain('crash-write')
      expect(restored).not.toContain('make effect then wait')
      expect(await fs.readFile(path.join(p.cwd, 'effect.txt'), 'utf8')).toBe('already happened')
    })
  }
)
