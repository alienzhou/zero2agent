import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { CheckpointStore } from '../../packages/tui/dist/checkpoint-store.js'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { LogStore } from '../../packages/tui/dist/run-log.js'
import { runCli, CLI_ENTRY } from './helpers/cli.js'
import { sendSSEReply } from './helpers/sse.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-checkpoint-runtime-'))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  const cwd = path.join(root, 'work')
  await fs.mkdir(cwd)
  await fs.writeFile(path.join(cwd, 'a.txt'), 'before\n')
  const requests: Array<{ messages: unknown[] }> = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    const last = body.messages.at(-1)
    const toolResult =
      Array.isArray(last?.content) &&
      last.content.some((c: { type: string }) => c.type === 'tool_result')
    if (toolResult) sendSSEReply(res, [{ type: 'text', text: 'operation settled' }])
    else
      sendSSEReply(
        res,
        [
          {
            type: 'tool_use',
            id: 'write-1',
            name: 'write_file',
            input: { path: 'a.txt', content: 'after\n' },
          },
        ],
        'tool_use'
      )
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('port')
  const env = {
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    ZERO2AGENT_CHECKPOINT_DIR: path.join(root, 'checkpoints'),
    ZERO2AGENT_SESSION_DIR: path.join(root, 'sessions'),
    ZERO2AGENT_LOG_DIR: path.join(root, 'logs'),
    ANTHROPIC_API_KEY: 'fixture-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    PERMISSION_MODE: 'accept-edits',
    CONTEXT_WINDOW: '30000',
    MAX_INPUT_TOKENS: '24000',
    MAX_OUTPUT_TOKENS: '2048',
  }
  return {
    root,
    cwd,
    env,
    requests,
    store: await CheckpointStore.open(cwd, { directory: env.ZERO2AGENT_CHECKPOINT_DIR }),
    read: () => fs.readFile(path.join(cwd, 'a.txt'), 'utf8'),
  }
}
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 10_000
  while (Date.now() < end) {
    if (await check()) return
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error('File state did not settle')
}
describe('checkpoint production CLI and real PTY', () => {
  it('captures actual SDK-directed effects and supports keyless list/diff/preview/confirm/redo with no provider calls', async () => {
    const p = await fixture()
    const run = await runCli({ cwd: p.cwd, env: p.env, args: ['change a.txt'] })
    expect(run.code).toBe(0)
    expect(await p.read()).toBe('after\n')
    const [record] = await p.store.list()
    expect(record.toolCallId).toBe('write-1')
    expect(record.sessionId).toMatch(/-/)
    expect(record.operationId).toMatch(/-/)
    const env = { ...p.env, ANTHROPIC_API_KEY: undefined }
    expect((await runCli({ cwd: p.cwd, env, args: ['--checkpoints'] })).output).toContain(record.id)
    expect((await runCli({ cwd: p.cwd, env, args: ['--checkpoint', record.id] })).output).toContain(
      '-before'
    )
    const preview = await runCli({ cwd: p.cwd, env, args: ['--undo', record.id] })
    expect(preview.code).toBe(0)
    expect(await p.read()).toBe('after\n')
    const token = preview.output.match(/确认令牌: ([0-9a-f]{64})/)![1]
    const result = await runCli({
      cwd: p.cwd,
      env,
      args: ['--undo', record.id, '--confirm', token],
    })
    expect(result.code).toBe(0)
    expect(await p.read()).toBe('before\n')
    const [inverse] = await p.store.list(),
      plan = await p.store.preview(inverse.id)
    expect(
      (await runCli({ cwd: p.cwd, env, args: ['--undo', inverse.id, '--confirm', plan.token] }))
        .code
    ).toBe(0)
    expect(await p.read()).toBe('after\n')
    expect(p.requests).toHaveLength(2)
    const logs = await LogStore.open(p.cwd, { root: p.env.ZERO2AGENT_LOG_DIR })
    const report = await logs.read((await logs.list())[0].id)
    expect(
      report.records.some(r => r.toolCallId === 'write-1' && r.operationId === record.operationId)
    ).toBe(true)
  })
  it('denial creates no checkpoint, explicit no-checkpoints remains independent of sessions and logs', async () => {
    const p = await fixture()
    expect(
      (
        await runCli({
          cwd: p.cwd,
          env: { ...p.env, PERMISSION_MODE: 'read-only' },
          args: ['change'],
        })
      ).code
    ).toBe(0)
    expect(await p.read()).toBe('before\n')
    expect(await p.store.list()).toEqual([])
    expect(
      (await runCli({ cwd: p.cwd, env: p.env, args: ['--no-checkpoints', 'change'] })).code
    ).toBe(0)
    expect(await p.read()).toBe('after\n')
    expect(await p.store.list()).toEqual([])
    const sessions = await SessionStore.open(p.cwd, p.env.ZERO2AGENT_SESSION_DIR)
    expect((await sessions.list()).length).toBeGreaterThan(0)
  })
  it('rejects conflicting flags and stale keyless confirmation without modifying files', async () => {
    const p = await fixture()
    await runCli({ cwd: p.cwd, env: p.env, args: ['change'] })
    const [record] = await p.store.list()
    const plan = await p.store.preview(record.id)
    await fs.writeFile(path.join(p.cwd, 'a.txt'), 'user-edited')
    const result = await runCli({
      cwd: p.cwd,
      env: p.env,
      args: ['--undo', record.id, '--confirm', plan.token],
    })
    expect(result.code).toBe(1)
    expect(await p.read()).toBe('user-edited')
    for (const args of [
      ['--checkpoints', 'task'],
      ['--checkpoints', '--continue'],
      ['--confirm', plan.token],
      ['--checkpoint', '../x'],
      ['--undo', record.id, '--logs'],
    ])
      expect((await runCli({ cwd: p.cwd, env: p.env, args })).code).toBe(1)
    expect(p.requests).toHaveLength(2)
  })
  it('real TUI isolates selector, diff and confirmation input, defaults to cancel, preserves draft and records filesystem fact', async () => {
    const p = await fixture(),
      pty = startHumanTerminal(CLI_ENTRY, [], p.cwd, false, { env: p.env, timeoutMs: 15000 })
    cleanups.push(() => pty.close())
    await pty.waitFor('等待输入')
    pty.write('change a.txt\r')
    await pty.waitFor('operation settled')
    await pty.waitFor('已完成')
    await until(async () => (await p.store.list()).length === 1)
    // Wait for host session flush before submitting the next command.
    await until(async () => {
      const store = await SessionStore.open(p.cwd, p.env.ZERO2AGENT_SESSION_DIR)
      const items = await store.list()
      return !!items[0] && !items[0].pending
    })
    let mark = pty.output.length
    pty.write('/checkpoints\r')
    await pty.waitFor('选择文件 Checkpoint', mark)
    pty.write('\x1b[200~secret paste\x1b[201~')
    expect(p.requests).toHaveLength(2)
    mark = pty.output.length
    pty.write('\r')
    await pty.waitFor('文件差异', mark)
    await pty.waitFor('-before', mark)
    mark = pty.output.length
    pty.write('r')
    await pty.waitFor('确认文件回退', mark)
    pty.write('\x1b[200~y\x1b[201~')
    expect(await p.read()).toBe('after\n')
    mark = pty.output.length
    pty.write('\r')
    await pty.waitFor('选择文件 Checkpoint', mark)
    expect(await p.read()).toBe('after\n')
    mark = pty.output.length
    pty.write('\r')
    await pty.waitFor('文件差异', mark)
    mark = pty.output.length
    pty.write('r')
    await pty.waitFor('确认文件回退', mark)
    mark = pty.output.length
    pty.write('y')
    await pty.waitFor('已回退', mark)
    await until(async () => (await p.read()) === 'before\n')
    const sessions = await SessionStore.open(p.cwd, p.env.ZERO2AGENT_SESSION_DIR)
    await until(async () => {
      const [item] = await sessions.list()
      return JSON.stringify((await sessions.load(item.id)).state).includes(
        'The user restored files'
      )
    })
    expect(p.requests).toHaveLength(2)
    // Composer draft survives opening/closing a file viewer via the host's async command boundary.
    mark = pty.output.length
    pty.write('/checkpoint-stats\r')
    await pty.waitFor('Checkpoint 占用', mark)
    pty.resize(42, 15)
    mark = pty.output.length
    pty.write('\x1b')
    await pty.waitFor('你:', mark)
    pty.write('exit\r')
    expect(await pty.waitExit()).toBe(0)
    expect(pty.output).toContain('\x1b[?1049l')
    if (process.env.E03_S006_EVIDENCE_DIR) {
      await fs.mkdir(process.env.E03_S006_EVIDENCE_DIR, { recursive: true })
      await fs.writeFile(
        path.join(process.env.E03_S006_EVIDENCE_DIR, 'checkpoint-pty.ansi'),
        pty.output
      )
    }
  })
})
