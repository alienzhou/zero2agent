import { createServer, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Agent, mcpToolName } from '@zero2agent/core'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { CLI_ENTRY, REPO_ROOT, makeTempWorkspace, runCli } from './helpers/cli.js'
import { sendSSEReply } from './helpers/sse.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
async function setup(mode = 'normal', respond?: (res: ServerResponse, index: number) => void) {
  const w = await makeTempWorkspace()
  cleanup.push(w.cleanup)
  const audit = path.join(w.dir, 'audit')
  const file = path.join(w.dir, 'mcp.json')
  const config = {
    servers: [
      {
        id: 'issues',
        command: process.execPath,
        args: [path.join(REPO_ROOT, 'researches/mcp/issue-server.mjs'), mode, audit],
      },
    ],
    callTimeoutMs: 100,
    startupTimeoutMs: 2000,
  }
  await fs.writeFile(file, JSON.stringify(config))
  const requests: Array<{ messages: unknown[]; tools: Array<{ name: string }> }> = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    requests.push(JSON.parse(body))
    if (respond) respond(res, requests.length)
    else sendSSEReply(res, [{ type: 'text', text: 'MCP_HOST_DONE' }])
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No address')
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
  })
  const env = {
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    ZERO2AGENT_NO_SAVE: '1',
    ZERO2AGENT_NO_LOG: '1',
    ZERO2AGENT_NO_CHECKPOINTS: '1',
    ANTHROPIC_API_KEY: 'fixture',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    PERMISSION_MODE: 'bypass',
  }
  const args = ['--mcp-config', file, '--mcp-enable', 'issues']
  const events = async () =>
    (await fs.readFile(audit, 'utf8'))
      .trim()
      .split('\n')
      .map(l => JSON.parse(l))
  return { ...w, audit, file, config, requests, env, args, events }
}
const action = (id: string, name = 'get_issue') => ({
  type: 'tool_use',
  id,
  name: mcpToolName('issues', name),
  input: {},
})
async function saveEvidence(label: string, value: string) {
  const dir = process.env.E05_MCP_EVIDENCE_DIR
  if (dir) {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, label), value)
  }
}

describe('E05-S003 native CLI/PTY/session integration', () => {
  it('inspects disabled config without processes or credentials; explicitly enabled inspection initializes and cleans up', async () => {
    const p = await setup()
    const disabled = await runCli({
      cwd: p.dir,
      args: ['--mcp-config', p.file, '--mcp'],
      env: { ...p.env, ANTHROPIC_API_KEY: undefined },
    })
    expect(disabled.code, disabled.output).toBe(0)
    expect(disabled.output).toContain('disabled')
    await expect(fs.readFile(p.audit)).rejects.toThrow()
    const enabled = await runCli({
      cwd: p.dir,
      args: [...p.args, '--mcp'],
      env: { ...p.env, ANTHROPIC_API_KEY: undefined },
    })
    expect(enabled.code, enabled.output).toBe(0)
    expect(enabled.output).toContain(mcpToolName('issues', 'get_issue'))
    expect(p.requests).toHaveLength(0)
    const pid = (await p.events())[0].pid
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it.each([
    { args: ['--mcp-enable', 'x', '--mcp'] },
    { args: ['--mcp-config'] },
    { args: ['--mcp-enable'] },
  ])('rejects invalid CLI %j without work', async ({ args }) => {
    const p = await setup()
    const result = await runCli({ cwd: p.dir, args, env: p.env })
    expect(result.code).toBe(1)
    expect(p.requests).toHaveLength(0)
    await expect(fs.readFile(p.audit)).rejects.toThrow()
  })
  it('rejects configuration that self-grants startup trust', async () => {
    const p = await setup()
    await fs.writeFile(
      p.file,
      JSON.stringify({ servers: [{ ...p.config.servers[0], enabled: true }] })
    )
    const result = await runCli({ cwd: p.dir, args: [...p.args, '--mcp'], env: p.env })
    expect(result.code).toBe(1)
    expect(result.output).toContain('cannot grant startup trust')
    await expect(fs.readFile(p.audit)).rejects.toThrow()
  })
  it.each(['single', 'pipe', 'plain'])(
    'uses the actual %s host and current tool table',
    async mode => {
      const p = await setup('normal', (res, index) =>
        sendSSEReply(
          res,
          index === 1 ? [action('issue')] : [{ type: 'text', text: 'MCP_HOST_DONE' }],
          index === 1 ? 'tool_use' : 'end_turn'
        )
      )
      const result = await runCli({
        cwd: p.dir,
        args: [
          ...p.args,
          ...(mode === 'single' ? ['read issue'] : mode === 'plain' ? ['--plain'] : []),
        ],
        stdin: mode === 'single' ? undefined : 'read issue\n',
        env: p.env,
      })
      expect(result.code, result.output).toBe(0)
      expect(result.output).toContain('MCP_HOST_DONE')
      expect(p.requests).toHaveLength(2)
      expect(JSON.stringify(p.requests[1].messages)).toContain('ISSUE-42')
      expect(p.requests[0].tools.some(t => t.name === mcpToolName('issues', 'get_issue'))).toBe(
        true
      )
      const pid = (await p.events())[0].pid
      expect(() => process.kill(pid, 0)).toThrow()
      await saveEvidence(`host-${mode}.txt`, result.output)
    }
  )
  it('denies hostile readOnlyHint under accept-edits without creating a counter effect', async () => {
    const p = await setup('normal', (res, index) =>
      sendSSEReply(
        res,
        index === 1
          ? [action('action', 'record_action')]
          : [{ type: 'text', text: 'denied and stopped' }],
        index === 1 ? 'tool_use' : 'end_turn'
      )
    )
    const result = await runCli({
      cwd: p.dir,
      args: [...p.args, 'record'],
      env: { ...p.env, PERMISSION_MODE: 'accept-edits' },
    })
    expect(result.code, result.output).toBe(0)
    expect(JSON.stringify(p.requests[1].messages)).toContain('Permission denied')
    expect((await p.events()).filter(e => e.event === 'effect')).toHaveLength(0)
  })
  it('effect-then-disconnect stops CLI with one model request and no second side effect', async () => {
    const p = await setup('effect-disconnect', res =>
      sendSSEReply(
        res,
        [action('one', 'record_action'), action('two', 'record_action')],
        'tool_use'
      )
    )
    const result = await runCli({ cwd: p.dir, args: [...p.args, 'record once'], env: p.env })
    expect(result.code, result.output).toBe(1)
    expect(result.output).toContain('unknown')
    expect(p.requests).toHaveLength(1)
    expect((await p.events()).filter(e => e.event === 'effect')).toHaveLength(1)
    await saveEvidence('host-unknown.txt', result.output)
  })
  it.each(['exit', 'SIGINT'] as const)('restores an actual PTY after MCP and %s', async stop => {
    const p = await setup('normal', (res, index) =>
      sendSSEReply(
        res,
        index === 1 ? [action('issue')] : [{ type: 'text', text: 'MCP_HOST_DONE' }],
        index === 1 ? 'tool_use' : 'end_turn'
      )
    )
    const terminal = startHumanTerminal(CLI_ENTRY, p.args, p.dir, true, { env: p.env })
    cleanup.push(() => terminal.close())
    await terminal.waitFor('对话')
    terminal.write('read issue\r')
    await terminal.waitFor('MCP_HOST_DONE')
    const pid = (await p.events())[0].pid
    expect(() => process.kill(pid, 0)).toThrow()
    if (stop === 'exit') terminal.write('exit\r')
    else terminal.signal('SIGINT')
    await terminal.waitExit()
    await saveEvidence(`pty-${stop}.raw`, terminal.output)
  })
  it('owns MCP approval input in a real PTY and refuses without an effect', async () => {
    const p = await setup('normal', (res, index) =>
      sendSSEReply(
        res,
        index === 1
          ? [action('approval', 'record_action')]
          : [{ type: 'text', text: 'MCP_APPROVAL_REFUSED' }],
        index === 1 ? 'tool_use' : 'end_turn'
      )
    )
    const terminal = startHumanTerminal(CLI_ENTRY, p.args, p.dir, true, {
      env: { ...p.env, PERMISSION_MODE: 'default' },
    })
    cleanup.push(() => terminal.close())
    await terminal.waitFor('对话')
    terminal.write('record action\r')
    await terminal.waitFor('允许这次操作')
    terminal.write('n')
    await terminal.waitFor('MCP_APPROVAL_REFUSED')
    expect((await p.events()).filter(e => e.event === 'effect')).toHaveLength(0)
    terminal.write('exit\r')
    await terminal.waitExit()
    await saveEvidence('pty-approval.raw', terminal.output)
  })
  it('cleans the effect-hang MCP process after an active TUI SIGTERM', async () => {
    const p = await setup('effect-hang', res =>
      sendSSEReply(
        res,
        [action('effect', 'record_action'), action('never', 'record_action')],
        'tool_use'
      )
    )
    await fs.writeFile(p.file, JSON.stringify({ ...p.config, callTimeoutMs: 2000 }))
    const terminal = startHumanTerminal(CLI_ENTRY, p.args, p.dir, true, { env: p.env })
    cleanup.push(() => terminal.close())
    await terminal.waitFor('对话')
    terminal.write('record once\r')
    let events: Array<{ event: string; pid: number }> = []
    for (let i = 0; i < 200; i++) {
      try {
        events = await p.events()
        if (events.some(e => e.event === 'effect')) break
      } catch {}
      await new Promise(r => setTimeout(r, 5))
    }
    expect(events.filter(e => e.event === 'effect')).toHaveLength(1)
    terminal.signal('SIGTERM')
    expect(await terminal.waitExit()).toBe(143)
    expect(() => process.kill(events[0].pid, 0)).toThrow()
    expect((await p.events()).filter(e => e.event === 'effect')).toHaveLength(1)
    expect(p.requests).toHaveLength(1)
    await saveEvidence('pty-active-SIGTERM.raw', terminal.output)
  })
  it('publishes v4 source provenance and rejects down-version files; v1 legacy remains v1', async () => {
    const p = await setup('normal', (res, index) =>
      sendSSEReply(
        res,
        index === 1 ? [action('logs', 'get_logs')] : [{ type: 'text', text: 'done' }],
        index === 1 ? 'tool_use' : 'end_turn'
      )
    )
    const a = new Agent({
      cwd: p.dir,
      skills: false,
      projectInstructions: false,
      permissions: { mode: 'bypass' },
      mcp: { ...p.config, servers: p.config.servers.map(s => ({ ...s, enabled: true })) },
      config: { apiKey: 'fixture', baseURL: p.env.ANTHROPIC_BASE_URL },
    })
    await a.run('logs')
    const store = await SessionStore.open(p.dir, path.join(p.dir, 'sessions'))
    const saved = await store.save(store.fresh(), a.snapshot())
    expect(saved.version).toBe(4)
    expect((await store.load(saved.id)).state).toEqual(saved.state)
    const filename = path.join(store.directory, saved.id, '1.json')
    for (const version of [1, 2, 3]) {
      await fs.writeFile(filename, JSON.stringify({ ...saved, version }))
      await expect(store.load(saved.id)).rejects.toThrow('version 4')
    }
    const legacy = await store.save(store.fresh(), {
      messages: [],
      context: { through: 0, summary: '' },
    })
    expect(legacy.version).toBe(1)
  })
})
