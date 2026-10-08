import { createServer, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CLI_ENTRY, runCli, makeTempWorkspace } from './helpers/cli.js'
import { sendSSEReply } from './helpers/sse.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
import { LogStore } from '../../packages/tui/dist/run-log.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture(handle: (res: ServerResponse, body: unknown, index: number) => void) {
  const workspace = await makeTempWorkspace()
  cleanup.push(workspace.cleanup)
  const requests: unknown[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    handle(res, requests.at(-1), requests.length)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server port')
  const env = {
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    ANTHROPIC_API_KEY: 'private-fixture-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    PERMISSION_MODE: 'accept-edits',
    ZERO2AGENT_LOG_DIR: path.join(workspace.dir, 'logs'),
    ZERO2AGENT_SESSION_DIR: path.join(workspace.dir, 'sessions'),
    ZERO2AGENT_CHECKPOINT_DIR: path.join(workspace.dir, 'checkpoints'),
    ZERO2AGENT_RETRY_BASE_MS: '1',
  }
  return { cwd: workspace.dir, env, requests }
}
function fail(res: ServerResponse, wait = 1) {
  res.writeHead(500, { 'content-type': 'application/json', 'retry-after-ms': String(wait) })
  res.end('{"type":"error","error":{"type":"api_error","message":"private-error-body"}}')
}
const answer = (res: ServerResponse) => sendSSEReply(res, [{ type: 'text', text: 'RECOVERY_DONE' }])
const common = ['--no-save', '--no-checkpoints']

describe('E04-S001 over production CLI and PTY', () => {
  it('labels an abandoned draft before displaying the next complete answer', async () => {
    const p = await fixture((res, _body, index) =>
      index === 1
        ? sendSSEReply(res, [{ type: 'text', text: 'ABANDONED_DRAFT' }], 'end_turn', false)
        : answer(res)
    )
    const result = await runCli({
      cwd: p.cwd,
      env: p.env,
      args: [...common, '--no-log', 'inspect'],
    })
    expect(result.code).toBe(0)
    expect(result.output.indexOf('ABANDONED_DRAFT')).toBeLessThan(
      result.output.indexOf('未完成草稿已结束')
    )
    expect(result.output.indexOf('未完成草稿已结束')).toBeLessThan(
      result.output.indexOf('RECOVERY_DONE')
    )
    expect(p.requests).toHaveLength(2)
  })
  it('supports disabling transport retries', async () => {
    const p = await fixture(res => fail(res))
    const result = await runCli({
      cwd: p.cwd,
      env: p.env,
      args: [...common, '--no-log', '--max-retries', '0', 'inspect'],
    })
    expect(result.code).toBe(1)
    expect(p.requests).toHaveLength(1)
  })
  it.each(['single', 'plain', 'pipe'] as const)('shows finite recovery in %s mode', async mode => {
    const p = await fixture((res, _body, index) => (index === 1 ? fail(res) : answer(res)))
    const result = await runCli({
      cwd: p.cwd,
      env: p.env,
      args: [
        ...common,
        '--no-log',
        ...(mode === 'single' ? ['private-user-body'] : mode === 'plain' ? ['--plain'] : []),
      ],
      ...(mode !== 'single' ? { stdin: 'private-user-body\nexit\n' } : {}),
    })
    expect(result.code).toBe(0)
    expect(result.output).toContain('第 2 次尝试')
    expect(result.output).toContain('RECOVERY_DONE')
    expect(p.requests).toHaveLength(2)
  })
  it('lets an explicit flag override an environment limit', async () => {
    const p = await fixture((res, _body, index) => (index === 1 ? fail(res) : answer(res)))
    const result = await runCli({
      cwd: p.cwd,
      env: { ...p.env, ZERO2AGENT_MAX_REQUESTS: '1' },
      args: [...common, '--no-log', '--max-requests', '2', 'inspect'],
    })
    expect(result.code).toBe(0)
    expect(p.requests).toHaveLength(2)
  })
  it.each([
    ['--max-requests', '0'],
    ['--max-retries', '-1'],
    ['--request-timeout-ms', 'NaN'],
  ])('rejects invalid %s before any model request', async (flag, value) => {
    const p = await fixture(res => answer(res))
    const result = await runCli({ cwd: p.cwd, env: p.env, args: [flag, value, 'inspect'] })
    expect(result.code).toBe(1)
    expect(p.requests).toHaveLength(0)
  })
  it('keeps a file effect and records distinct attempts without leaking bodies', async () => {
    const p = await fixture((res, _body, index) => {
      if (index === 1)
        sendSSEReply(
          res,
          [
            {
              type: 'tool_use',
              id: 'write-once',
              name: 'write_file',
              input: { path: 'effect.txt', content: 'written once' },
            },
          ],
          'tool_use'
        )
      else if (index < 4) fail(res)
      else answer(res)
    })
    const result = await runCli({ cwd: p.cwd, env: p.env, args: [...common, 'private-user-body'] })
    expect(result.code).toBe(0)
    expect(await fs.readFile(path.join(p.cwd, 'effect.txt'), 'utf8')).toBe('written once')
    const logs = await LogStore.open(p.cwd, { root: p.env.ZERO2AGENT_LOG_DIR })
    const [item] = await logs.list(),
      report = await logs.read(item.id)
    expect(report.warnings).toEqual([])
    const attempts = report.records.filter(r => r.kind === 'request' && r.event === 'start')
    expect(attempts.map(r => r.attempt)).toEqual([1, 1, 2, 3])
    expect(new Set(attempts.map(r => r.logicalRequestId)).size).toBe(2)
    expect(report.records.filter(r => r.kind === 'tool' && r.event === 'running')).toHaveLength(1)
    expect(report.records.filter(r => r.kind === 'request' && r.event === 'retry')).toHaveLength(2)
    const bytes = await fs.readFile(path.join(logs.directory, item.id + '.jsonl'), 'utf8')
    for (const secret of [
      'private-fixture-key',
      'private-error-body',
      'private-user-body',
      'written once',
      'effect.txt',
    ])
      expect(bytes).not.toContain(secret)
    const viewed = await runCli({
      cwd: p.cwd,
      env: { ...p.env, ANTHROPIC_API_KEY: undefined },
      args: ['--log', item.id],
    })
    expect(viewed.output).toContain('attempt=3')
    expect(p.requests).toHaveLength(4)
  })
  it('stops repeated failing native terminal exits using actual exit metadata', async () => {
    const p = await fixture((res, _body, index) =>
      sendSSEReply(
        res,
        [
          {
            type: 'tool_use',
            id: `shell-${index}`,
            name: 'terminal',
            input: { command: 'printf "run\\n" >> calls.txt; exit 7' },
          },
        ],
        'tool_use'
      )
    )
    const result = await runCli({
      cwd: p.cwd,
      env: { ...p.env, PERMISSION_MODE: 'bypass' },
      args: [...common, '--no-log', '--max-repeated-failures', '2', 'inspect'],
    })
    expect(result.code).toBe(1)
    expect(result.output).toContain('repeated-tool-failure')
    expect(p.requests).toHaveLength(2)
    expect(await fs.readFile(path.join(p.cwd, 'calls.txt'), 'utf8')).toBe('run\nrun\n')
  })
  it.skipIf(process.platform === 'win32')(
    'cancels a real TUI backoff and accepts a later turn',
    async () => {
      const p = await fixture((res, _body, index) => (index === 1 ? fail(res, 20000) : answer(res)))
      const session = startHumanTerminal(CLI_ENTRY, [...common, '--no-log'], p.cwd, true, {
        env: p.env,
      })
      cleanup.push(() => session.close())
      await session.waitFor('你: ')
      let from = session.output.length
      session.write('inspect\r')
      await session.waitFor('20000ms', from)
      from = session.output.length
      session.write('\x03')
      await session.waitFor('已取消', from)
      expect(p.requests).toHaveLength(1)
      await expect
        .poll(() => session.output.slice(session.output.lastIndexOf('\x1b[H')).includes('你: '))
        .toBe(true)
      from = session.output.length
      session.write('continue\r')
      await session.waitFor('RECOVERY_DONE', from)
      await expect
        .poll(() => session.output.slice(session.output.lastIndexOf('\x1b[H')).includes('你: '))
        .toBe(true)
      session.write('exit\r')
      expect(await session.waitExit()).toBe(0)
      expect(p.requests).toHaveLength(2)
      for (const restored of ['\x1b[?1049l', '\x1b[?2004l', '\x1b[?25h'])
        expect(session.output).toContain(restored)
    }
  )
})
