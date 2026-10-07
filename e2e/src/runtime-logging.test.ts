import { createServer, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LogStore } from '../../packages/tui/dist/run-log.js'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { CLI_ENTRY, makeTempWorkspace, runCli } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
import { sendSSEReply } from './helpers/sse.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})
async function fixture(respond?: (response: ServerResponse, body: unknown, count: number) => void) {
  const workspace = await makeTempWorkspace()
  cleanups.push(workspace.cleanup)
  const requests: unknown[] = []
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    requests.push(body)
    if (respond) respond(res, body, requests.length)
    else sendSSEReply(res, [{ type: 'text', text: 'private-model-answer' }])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const logRoot = path.join(workspace.dir, 'logs'),
    sessionRoot = path.join(workspace.dir, 'sessions')
  const env = {
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    ZERO2AGENT_LOG_DIR: logRoot,
    ZERO2AGENT_SESSION_DIR: sessionRoot,
    ANTHROPIC_API_KEY: 'private-provider-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    PERMISSION_MODE: 'accept-edits',
    CONTEXT_WINDOW: '30000',
    MAX_INPUT_TOKENS: '24000',
    MAX_OUTPUT_TOKENS: '2048',
  }
  const logs = await LogStore.open(workspace.dir, { root: logRoot })
  return { cwd: workspace.dir, env, requests, logs, logRoot, sessionRoot }
}
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('State did not appear')
}
describe('E03-S005 logs over production CLI, SDK and real PTY', () => {
  it('correlates actual requests, permission and file effects; viewing is keyless and read-only', async () => {
    const p = await fixture((res, _body, count) =>
      sendSSEReply(
        res,
        count === 1
          ? [
              {
                type: 'tool_use',
                id: 'write-once',
                name: 'write_file',
                input: { path: 'private-name.txt', content: 'private-file-body' },
              },
            ]
          : [{ type: 'text', text: 'private-model-answer' }],
        count === 1 ? 'tool_use' : 'end_turn'
      )
    )
    expect((await runCli({ cwd: p.cwd, env: p.env, args: ['private-user-body'] })).code).toBe(0)
    expect(await fs.readFile(path.join(p.cwd, 'private-name.txt'), 'utf8')).toBe(
      'private-file-body'
    )
    const [item] = await p.logs.list()
    const report = await p.logs.read(item.id)
    expect(report.warnings).toEqual([])
    expect(
      report.records.filter(r => r.kind === 'request' && r.event === 'completed')
    ).toHaveLength(2)
    const tool = report.records.find(r => r.kind === 'tool' && r.event === 'completed')!
    expect(tool).toMatchObject({ toolCallId: 'write-once', toolName: 'write_file' })
    expect(
      report.records.some(
        r => r.requestId === tool.requestId && r.kind === 'request' && r.event === 'start'
      )
    ).toBe(true)
    expect(report.records.some(r => r.kind === 'permission' && r.action === 'allow')).toBe(true)
    const bytes = await fs.readFile(path.join(p.logs.directory, item.id + '.jsonl'), 'utf8')
    for (const secret of [
      'private-provider-key',
      'private-name.txt',
      'private-file-body',
      'private-model-answer',
      'private-user-body',
    ])
      expect(bytes).not.toContain(secret)
    const snapshot = await fs.readFile(path.join(p.cwd, 'private-name.txt'))
    const readEnv = { ...p.env, ANTHROPIC_API_KEY: undefined }
    expect((await runCli({ cwd: p.cwd, env: readEnv, args: ['--logs'] })).output).toContain(item.id)
    const inspected = await runCli({
      cwd: p.cwd,
      env: readEnv,
      args: ['--log', item.id, '--log-operation', tool.operationId!],
    })
    expect(inspected.code).toBe(0)
    expect(inspected.output).toContain('call=write-once')
    expect(p.requests).toHaveLength(2)
    expect(await fs.readFile(path.join(p.logs.directory, item.id + '.jsonl'), 'utf8')).toBe(bytes)
    expect(await fs.readFile(path.join(p.cwd, 'private-name.txt'))).toEqual(snapshot)
  })
  it('uses a new run per process while restored turns keep their saved session identity', async () => {
    const p = await fixture()
    expect((await runCli({ cwd: p.cwd, env: p.env, args: ['first'] })).code).toBe(0)
    const sessions = await SessionStore.open(p.cwd, p.sessionRoot),
      [session] = await sessions.list()
    const [a] = await p.logs.list()
    const bytes = await fs.readFile(path.join(p.logs.directory, a.id + '.jsonl'), 'utf8')
    expect(
      (await runCli({ cwd: p.cwd, env: p.env, args: ['--resume', session.id, 'second'] })).code
    ).toBe(0)
    const all = await p.logs.list()
    expect(all).toHaveLength(2)
    for (const item of all)
      expect(
        (await p.logs.read(item.id)).records.find(
          r => r.kind === 'operation' && r.event === 'start'
        )?.sessionId
      ).toBe(session.id)
    expect(await fs.readFile(path.join(p.logs.directory, a.id + '.jsonl'), 'utf8')).toBe(bytes)
    expect(JSON.stringify(p.requests.at(-1))).toContain('first')
  })
  it('continues when the configured journal cannot be opened and supports fully temporary runs', async () => {
    const p = await fixture()
    const blocked = path.join(p.cwd, 'occupied')
    await fs.writeFile(blocked, 'keep me')
    const result = await runCli({
      cwd: p.cwd,
      env: { ...p.env, ZERO2AGENT_LOG_DIR: blocked },
      args: ['--no-save', 'task'],
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('日志记录不可用')
    const temporary = await runCli({
      cwd: p.cwd,
      env: p.env,
      args: ['--no-save', '--no-log', 'temporary'],
    })
    expect(temporary.code).toBe(0)
    expect(await p.logs.list()).toEqual([])
    await expect(fs.stat(p.logRoot)).rejects.toThrow()
    await expect(fs.stat(p.sessionRoot)).rejects.toThrow()
    expect(await fs.readFile(blocked, 'utf8')).toBe('keep me')
  })
  it('records native terminal exit status without collecting command or command output', async () => {
    const p = await fixture((res, _body, count) =>
      sendSSEReply(
        res,
        count === 1
          ? [
              {
                type: 'tool_use',
                id: 'cmd',
                name: 'terminal',
                input: { command: 'printf private-command-output; exit 7', interactive: false },
              },
            ]
          : [{ type: 'text', text: 'private-model-answer' }],
        count === 1 ? 'tool_use' : 'end_turn'
      )
    )
    expect(
      (
        await runCli({
          cwd: p.cwd,
          env: { ...p.env, PERMISSION_MODE: 'bypass' },
          args: ['test terminal'],
        })
      ).code
    ).toBe(0)
    const [item] = await p.logs.list(),
      report = await p.logs.read(item.id)
    const native = report.records.find(r => r.kind === 'tool' && r.event === 'metadata')!
    expect(native).toMatchObject({ terminalOutcome: 'completed', exitCode: 7, toolCallId: 'cmd' })
    expect(native.requestId).toBe(
      report.records.find(r => r.kind === 'tool' && r.event === 'completed')?.requestId
    )
    expect(JSON.stringify(report)).not.toContain('private-command-output')
  })
  it.skipIf(process.platform === 'win32')(
    'browses logs with exclusive focus and never adds viewer commands to model history',
    async () => {
      const p = await fixture(),
        tty = startHumanTerminal(CLI_ENTRY, [], p.cwd, true, { env: p.env })
      cleanups.push(() => tty.close())
      tty.resize(96, 30)
      await tty.waitFor('等待输入')
      const start = tty.output.length
      tty.write('first\r')
      await tty.waitFor('zero2agent · 已完成', start)
      const from = tty.output.length
      tty.write('/logs\r')
      await tty.waitFor('选择运行日志', from)
      tty.write('\x1b[200~private-modal-paste\x1b[201~')
      const selected = tty.output.length
      tty.write('\r')
      await tty.waitFor('查看运行日志', selected)
      expect(p.requests).toHaveLength(1)
      tty.resize(42, 18)
      const scrolling = tty.output.length
      tty.write('\x1b[4~')
      await tty.waitFor(/行 (?!1–)\d+–\d+ \/ \d+ · 只读快照/, scrolling)
      const home = tty.output.length
      tty.write('\x1b[1~')
      await tty.waitFor(/行 1–/, home)
      const back = tty.output.length
      tty.write('\x1b')
      await tty.waitFor('选择运行日志', back)
      const conversation = tty.output.length
      tty.write('\x1b')
      await tty.waitFor('等待输入', conversation)
      const help = tty.output.length
      tty.write('/help\r')
      await tty.waitFor('/logs', help)
      tty.write('second\r')
      await until(async () => p.requests.length === 2)
      expect(JSON.stringify(p.requests[1])).not.toContain('/log')
      expect(JSON.stringify(p.requests[1])).not.toContain('private-modal-paste')
      await tty.waitFor('已完成', help)
      tty.write('exit\r')
      expect(await tty.waitExit()).toBe(0)
      const [item] = await p.logs.list()
      expect((await p.logs.read(item.id)).warnings).toEqual([])
    }
  )
  it.skipIf(process.platform === 'win32')(
    'retains a verifiable incomplete prefix after an actual SIGKILL',
    async () => {
      const p = await fixture(() => {}),
        tty = startHumanTerminal(CLI_ENTRY, [], p.cwd, true, { env: p.env })
      cleanups.push(() => tty.close())
      await tty.waitFor('等待输入')
      tty.write('wait for provider\r')
      await until(async () => {
        const [item] = await p.logs.list()
        if (!item) return false
        try {
          return (await p.logs.read(item.id)).records.some(
            r => r.kind === 'request' && r.event === 'start'
          )
        } catch {
          return false
        }
      })
      tty.signal('SIGKILL')
      await tty.waitExit()
      const [item] = await p.logs.list()
      const report = await p.logs.read(item.id)
      expect(report.warnings.join(' ')).toContain('请求 1')
      expect(report.warnings.join(' ')).toContain('未见进程退出')
      const raw = await fs.readFile(path.join(p.logs.directory, item.id + '.jsonl'), 'utf8')
      expect(
        (
          await runCli({
            cwd: p.cwd,
            env: { ...p.env, ANTHROPIC_API_KEY: undefined },
            args: ['--log', item.id],
          })
        ).code
      ).toBe(0)
      expect(await fs.readFile(path.join(p.logs.directory, item.id + '.jsonl'), 'utf8')).toBe(raw)
      expect(p.requests).toHaveLength(1)
    }
  )
  it.skipIf(process.platform === 'win32')(
    'keeps a background completion attached to its original request after later turns',
    async () => {
      const p = await fixture((res, _body, count) =>
        sendSSEReply(
          res,
          count === 1
            ? [
                {
                  type: 'tool_use',
                  id: 'background-command',
                  name: 'terminal',
                  input: {
                    command: 'sleep 12; printf done > background-marker.txt',
                    interactive: false,
                  },
                },
              ]
            : [{ type: 'text', text: 'private-model-answer' }],
          count === 1 ? 'tool_use' : 'end_turn'
        )
      )
      const tty = startHumanTerminal(CLI_ENTRY, [], p.cwd, true, {
        env: { ...p.env, PERMISSION_MODE: 'bypass' },
        timeoutMs: 20000,
      })
      cleanups.push(() => tty.close())
      tty.resize(110, 32)
      await tty.waitFor('等待输入')
      const start = tty.output.length
      tty.write('background test\r')
      await tty.waitFor(/运行中 10s/, start)
      tty.write('\x13')
      await tty.waitFor('zero2agent · 已完成', start)
      const next = tty.output.length
      tty.write('next turn\r')
      await tty.waitFor('zero2agent · 已完成', next)
      await until(async () => {
        const [item] = await p.logs.list()
        if (!item) return false
        return (await p.logs.read(item.id)).records.some(
          r => r.terminalOutcome === 'background-completed'
        )
      })
      const [item] = await p.logs.list(),
        report = await p.logs.read(item.id)
      const skipped = report.records.find(r => r.terminalOutcome === 'skipped')!,
        completed = report.records.find(r => r.terminalOutcome === 'background-completed')!
      expect(completed).toMatchObject({
        operationId: skipped.operationId,
        requestId: skipped.requestId,
        toolCallId: skipped.toolCallId,
        pid: skipped.pid,
        exitCode: 0,
      })
      expect(
        report.records.filter(r => r.kind === 'operation' && r.event === 'start')
      ).toHaveLength(2)
      expect(await fs.readFile(path.join(p.cwd, 'background-marker.txt'), 'utf8')).toBe('done')
      tty.write('exit\r')
      expect(await tty.waitExit()).toBe(0)
      expect((await p.logs.read(item.id)).warnings).toEqual([])
    }
  )
  it.skipIf(process.platform === 'win32')(
    'records only native results from the private human terminal',
    async () => {
      const p = await fixture()
      await fs.writeFile(
        path.join(p.cwd, 'human-private.sh'),
        'read -rs -p "PRIVATE_READY" token\nprintf "%s" "$token" > human-private.txt\n'
      )
      const tty = startHumanTerminal(
        CLI_ENTRY,
        ['--terminal', 'bash ./human-private.sh'],
        p.cwd,
        false,
        { env: p.env }
      )
      cleanups.push(() => tty.close())
      await tty.waitFor('Allow human terminal? [y/N]')
      tty.write('y\r')
      await tty.waitFor('PRIVATE_READY')
      tty.write('private-human-token\r')
      expect(await tty.waitExit()).toBe(0)
      expect(await fs.readFile(path.join(p.cwd, 'human-private.txt'), 'utf8')).toBe(
        'private-human-token'
      )
      const [item] = await p.logs.list(),
        report = await p.logs.read(item.id)
      expect(report.warnings).toEqual([])
      expect(report.records.find(r => r.event === 'terminal-completed')).toMatchObject({
        terminalOutcome: 'completed',
        exitCode: 0,
      })
      expect(JSON.stringify(report)).not.toContain('private-human-token')
      expect(JSON.stringify(report)).not.toContain('human-private.sh')
      expect(p.requests).toHaveLength(0)
    }
  )
  it.skipIf(process.platform === 'win32')(
    'keeps a TUI logging failure visible while a real SDK task succeeds',
    async () => {
      const p = await fixture()
      const blocked = path.join(p.cwd, 'blocked-log-root')
      await fs.writeFile(blocked, 'preserved')
      const tty = startHumanTerminal(CLI_ENTRY, [], p.cwd, true, {
        env: { ...p.env, ZERO2AGENT_LOG_DIR: blocked },
      })
      cleanups.push(() => tty.close())
      await tty.waitFor('日志不可用')
      const from = tty.output.length
      tty.write('continue task\r')
      await tty.waitFor('zero2agent · 日志不可用 · 已完成', from)
      expect(p.requests).toHaveLength(1)
      expect(tty.output.slice(from)).toContain('private-model-answer')
      tty.write('exit\r')
      expect(await tty.waitExit()).toBe(0)
      expect(await fs.readFile(blocked, 'utf8')).toBe('preserved')
    }
  )
})
