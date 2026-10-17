import { createServer, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Agent, Hooks, mcpToolName } from '@zero2agent/core'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { makeTempWorkspace, runCli, CLI_ENTRY, REPO_ROOT } from './helpers/cli.js'
import { sendSSEReply } from './helpers/sse.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const f of cleanups.splice(0).reverse()) await f()
})
const write = {
  type: 'tool_use',
  id: 'w',
  name: 'write_file',
  input: { path: 'first.txt', content: 'once' },
}
async function setup(
  stage = 'beforeTool',
  mode = 'pass',
  respond?: (res: ServerResponse, n: number) => void
) {
  const w = await makeTempWorkspace()
  cleanups.push(w.cleanup)
  const audit = path.join(w.dir, 'audit'),
    file = path.join(w.dir, 'hooks.json')
  const config = {
    version: 1,
    hooks: [
      {
        id: 'gate',
        stage,
        command: process.execPath,
        args: [path.join(REPO_ROOT, 'researches/hooks/check.mjs'), mode],
        sources: [path.join(REPO_ROOT, 'researches/hooks/check.mjs')],
        env: { HOOK_AUDIT: audit },
      },
    ],
  }
  await fs.writeFile(file, JSON.stringify(config))
  const views = await new Hooks(w.dir, { file }).inspect()
  const trust = views.map(v => `${v.id}:${v.identity}`)
  const requests: unknown[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const b of req) body += b
    requests.push(JSON.parse(body))
    if (respond) respond(res, requests.length)
    else
      sendSSEReply(
        res,
        requests.length === 1 ? [write] : [{ type: 'text', text: 'HOOK_HOST_DONE' }],
        requests.length === 1 ? 'tool_use' : 'end_turn'
      )
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw Error('No address')
  const baseURL = `http://127.0.0.1:${addr.port}`
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
  })
  const env = {
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    ZERO2AGENT_NO_SAVE: '1',
    ZERO2AGENT_NO_LOG: '1',
    ZERO2AGENT_NO_CHECKPOINTS: '1',
    ZERO2AGENT_NO_SKILLS: '1',
    ZERO2AGENT_NO_INSTRUCTIONS: '1',
    ANTHROPIC_API_KEY: 'fixture',
    ANTHROPIC_BASE_URL: baseURL,
    PERMISSION_MODE: 'accept-edits',
  }
  const args = ['--hooks-config', file, ...trust.flatMap(t => ['--hook-trust', t])]
  const events = async () =>
    (await fs.readFile(audit, 'utf8'))
      .trim()
      .split('\n')
      .map(l => JSON.parse(l))
  return { ...w, file, audit, config, trust, args, env, requests, events, baseURL }
}
async function save(name: string, value: string) {
  if (process.env.E05_HOOK_EVIDENCE_DIR) {
    await fs.mkdir(process.env.E05_HOOK_EVIDENCE_DIR, { recursive: true })
    await fs.writeFile(path.join(process.env.E05_HOOK_EVIDENCE_DIR, name), value)
  }
}
describe('E05-S004 production CLI and PTY', () => {
  it('inspects versions without credentials or process startup', async () => {
    const p = await setup()
    const r = await runCli({
      cwd: p.dir,
      args: ['--hooks-config', p.file, '--hooks'],
      env: { ...p.env, ANTHROPIC_API_KEY: undefined },
    })
    expect(r.code, r.output).toBe(0)
    expect(r.output).toContain('"trusted": false')
    expect(p.requests).toHaveLength(0)
    await expect(fs.stat(p.audit)).rejects.toThrow()
  })
  it.each(['single', 'pipe', 'plain'])('runs the actual %s host', async mode => {
    const p = await setup()
    const r = await runCli({
      cwd: p.dir,
      args: [
        ...p.args,
        ...(mode === 'single' ? ['write once'] : mode === 'plain' ? ['--plain'] : []),
      ],
      stdin: mode === 'single' ? undefined : 'write once\n',
      env: p.env,
    })
    expect(r.code, r.output).toBe(0)
    expect(r.output).toContain('Hook beforeTool/gate: passed')
    expect(await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8')).toBe('once')
    expect(p.requests).toHaveLength(2)
    await save('host-' + mode + '.txt', r.output)
  })
  it('rejects stale trust before model/process effects', async () => {
    const p = await setup()
    await fs.writeFile(p.file, JSON.stringify({ ...p.config, watch: ['different'] }))
    const r = await runCli({ cwd: p.dir, args: [...p.args, 'write'], env: p.env })
    expect(r.code).toBe(1)
    expect(r.output).toContain('stale')
    expect(p.requests).toHaveLength(0)
    await expect(fs.stat(p.audit)).rejects.toThrow()
  })
  it('stops after a post-check failure while retaining the actual receipt/file', async () => {
    const p = await setup('afterTool', 'block')
    const r = await runCli({ cwd: p.dir, args: [...p.args, 'write once'], env: p.env })
    expect(r.code).toBe(1)
    expect(r.output).toContain('already executed')
    expect(p.requests).toHaveLength(1)
    expect(await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8')).toBe('once')
    await save('host-post-block.txt', r.output)
  })
  it.each(['exit', 'SIGINT'] as const)('restores PTY after Hook execution and %s', async stop => {
    const p = await setup()
    const t = startHumanTerminal(CLI_ENTRY, p.args, p.dir, true, { env: p.env })
    cleanups.push(() => t.close())
    await t.waitFor('对话')
    t.write('write once\r')
    await t.waitFor('HOOK_HOST_DONE')
    if (stop === 'exit') t.write('exit\r')
    else t.signal('SIGINT')
    await t.waitExit()
    const pid = (await p.events())[0].pid
    expect(() => process.kill(pid, 0)).toThrow()
    await save('pty-' + stop + '.raw', t.output)
  })
  it('cancels an active hanging check in a real PTY and cleans its native PID', async () => {
    const p = await setup('afterTool', 'hang-after')
    const t = startHumanTerminal(CLI_ENTRY, p.args, p.dir, true, { env: p.env })
    cleanups.push(() => t.close())
    await t.waitFor('对话')
    t.write('write once\r')
    await t.waitFor('Hook afterTool/gate: started')
    let records = []
    for (let i = 0; i < 100; i++) {
      try {
        records = await p.events()
        if (records.length) break
      } catch {}
      await new Promise(r => setTimeout(r, 10))
    }
    t.signal('SIGTERM')
    expect(await t.waitExit()).toBe(143)
    for (const e of records) expect(() => process.kill(e.pid, 0)).toThrow()
    expect(await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8')).toBe('once')
    expect(p.requests).toHaveLength(1)
    await save('pty-active-SIGTERM.raw', t.output)
  })
})
describe.skipIf(process.platform === 'win32')('real SIGKILL around Hook boundaries', () => {
  it.each(['hook-start', 'tool-settled', 'running', 'hook-settled', 'combined'])(
    'preserves %s without replay and supports explicit new validation',
    async stop => {
      const stage = stop === 'hook-start' ? 'beforeTool' : 'afterTool'
      const p = await setup(stage, ['running', 'combined'].includes(stop) ? 'hang-after' : 'pass')
      if (stop === 'combined') {
        await fs.writeFile(
          path.join(p.dir, 'AGENTS.md'),
          'ROOT_COMBINED_RULE: Follow the explicit task and preserve settled effects.\n'
        )
        await fs.mkdir(path.join(p.dir, '.agents/skills/fix-with-tests'), { recursive: true })
        await fs.writeFile(
          path.join(p.dir, '.agents/skills/fix-with-tests/SKILL.md'),
          '---\nname: fix-with-tests\ndescription: Verify the explicit fixed task.\n---\nCOMBINED_GUIDE: Never repeat a settled write.\n'
        )
      }
      const child = spawn(
        process.execPath,
        [
          path.join(REPO_ROOT, 'e2e/src/fixtures/hooks-child.mjs'),
          p.dir,
          p.baseURL,
          stop,
          ...(stop === 'combined' ? ['combined'] : []),
        ],
        { env: { PATH: process.env.PATH ?? '' }, stdio: 'pipe' }
      )
      let output = ''
      child.stdout.on('data', b => (output += b))
      child.stderr.on('data', b => (output += b))
      cleanups.push(async () => {
        try {
          child.kill('SIGKILL')
        } catch {}
      })
      const exit = new Promise<string | null>(resolve =>
        child.once('close', (_code, signal) => resolve(signal))
      )
      if (['running', 'combined'].includes(stop)) {
        for (let i = 0; i < 300; i++) {
          try {
            if ((await p.events()).some(e => e.event === 'start')) break
          } catch {}
          await new Promise(r => setTimeout(r, 10))
        }
        expect((await p.events()).some(e => e.event === 'start')).toBe(true)
        child.kill('SIGKILL')
      }
      expect(await exit).toBe('SIGKILL')
      const store = await SessionStore.open(p.dir, path.join(p.dir, 'sessions'))
      const [item] = await store.list()
      const saved = await store.load(item.id)
      expect(saved.version).toBe(5)
      expect(saved.state.recovery?.hooks?.checks[0].state).toBe(
        stop === 'hook-settled' ? 'passed' : stop === 'tool-settled' ? 'not-started' : 'unknown'
      )
      expect(saved.state.recovery?.tools[0].state).toBe(
        stop === 'hook-start' ? 'not-started' : 'settled'
      )
      if (stop === 'hook-start')
        await expect(fs.stat(path.join(p.dir, 'effects'))).rejects.toThrow()
      else expect(await fs.readFile(path.join(p.dir, 'effects'), 'utf8')).toBe('write\n')
      const before = await fs.readFile(p.audit, 'utf8').catch(() => '')
      const a = new Agent({
        cwd: p.dir,
        config: { apiKey: 'fixture', baseURL: p.baseURL },
        hooks: { file: p.file, trust: p.trust },
        skills: stop === 'combined' ? { selected: ['fix-with-tests'] } : false,
        projectInstructions: stop === 'combined' ? { root: p.dir } : false,
        ...(stop === 'combined' && {
          mcp: {
            servers: [
              {
                id: 'issues',
                enabled: true,
                command: process.execPath,
                args: [
                  path.join(REPO_ROOT, 'researches/mcp/issue-server.mjs'),
                  'normal',
                  path.join(p.dir, 'mcp-audit'),
                ],
              },
            ],
          },
        }),
      })
      a.restore(saved.state)
      expect(await fs.readFile(p.audit, 'utf8').catch(() => '')).toBe(before)
      if (['running', 'combined'].includes(stop)) {
        const pid = (await p.events())[0].pid
        let alive = true
        for (let i = 0; i < 100; i++) {
          try {
            process.kill(pid, 0)
          } catch {
            alive = false
            break
          }
          await new Promise(r => setTimeout(r, 10))
        }
        expect(alive).toBe(false)
      }
      for (const version of [1, 2, 3, 4]) {
        await fs.writeFile(
          path.join(store.directory, saved.id, `${saved.revision}.json`),
          JSON.stringify({ ...saved, version })
        )
        await expect(store.load(saved.id)).rejects.toThrow('version 5')
      }
      if (stop === 'combined') {
        await fs.writeFile(
          path.join(p.dir, 'allow-check'),
          'User reviewed the once-written file and authorizes a new check.'
        )
        await a.recheckHooks(
          'Inspected the existing effect; run a new check without repeating the old write.'
        )
        expect(a.snapshot().recovery?.hooks?.checks.map(c => c.state)).toEqual([
          'unknown',
          'passed',
        ])
        await a.continueInterrupted('Finish using the existing checked file; do not write again.')
        expect(a.needsRecovery).toBe(false)
        expect(p.requests).toHaveLength(2)
        expect(await fs.readFile(path.join(p.dir, 'effects'), 'utf8')).toBe('write\n')
        expect(await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8')).toBe('once')
        const records = (await fs.readFile(path.join(p.dir, 'mcp-audit'), 'utf8'))
          .trim()
          .split('\n')
          .map(l => JSON.parse(l))
        for (const e of records.filter(e => e.event === 'start'))
          expect(() => process.kill(e.pid, 0)).toThrow()
      }
      if (stop === 'combined') {
        const text = JSON.stringify(p.requests)
        expect(text).toContain('ROOT_COMBINED_RULE')
        expect(text).toContain('COMBINED_GUIDE')
        expect(text).toContain(mcpToolName('issues', 'get_issue'))
        expect(await fs.readFile(path.join(p.dir, 'mcp-audit'), 'utf8')).toContain(
          'notifications/initialized'
        )
      }
      await save(
        'SIGKILL-' + stop + '.json',
        JSON.stringify({ output, saved, before, requests: p.requests }, null, 2)
      )
    }
  )
})

describe('four-extension MCP unknown-outcome recovery', () => {
  it('keeps one external effect and never replays it after restore/explicit continuation', async () => {
    const p = await setup('beforeTool', 'pass', (res, n) =>
      sendSSEReply(
        res,
        n === 1
          ? [
              {
                type: 'tool_use',
                id: 'external',
                name: mcpToolName('issues', 'record_action'),
                input: {},
              },
            ]
          : [{ type: 'text', text: 'Effect inspected; no replay.' }],
        n === 1 ? 'tool_use' : 'end_turn'
      )
    )
    await fs.writeFile(
      path.join(p.dir, 'AGENTS.md'),
      'ROOT_COMBINED_RULE: Preserve effects and current authorization.\n'
    )
    await fs.mkdir(path.join(p.dir, '.agents/skills/fix-with-tests'), { recursive: true })
    await fs.writeFile(
      path.join(p.dir, '.agents/skills/fix-with-tests/SKILL.md'),
      '---\nname: fix-with-tests\ndescription: Verify explicit tasks.\n---\nCOMBINED_GUIDE: Never replay effects.\n'
    )
    const options = {
      cwd: p.dir,
      hooks: { file: p.file, trust: p.trust },
      skills: { selected: ['fix-with-tests'] },
      projectInstructions: { root: p.dir },
      config: { apiKey: 'fixture', baseURL: p.baseURL },
      permissions: { mode: 'bypass' as const },
      mcp: {
        servers: [
          {
            id: 'issues',
            enabled: true,
            command: process.execPath,
            args: [
              path.join(REPO_ROOT, 'researches/mcp/issue-server.mjs'),
              'effect-disconnect',
              path.join(p.dir, 'mcp-audit'),
            ],
          },
        ],
      },
    }
    const a = new Agent(options)
    await expect(a.run('Record one action only')).rejects.toThrow('unknown')
    const snapshot = a.snapshot()
    const raw = () => fs.readFile(path.join(p.dir, 'mcp-audit'), 'utf8')
    expect((await raw()).match(/"event":"effect"/g)).toHaveLength(1)
    const b = new Agent(options)
    b.restore(snapshot)
    expect(p.requests).toHaveLength(1)
    expect((await raw()).match(/"event":"effect"/g)).toHaveLength(1)
    await b.continueInterrupted('I inspected the one external effect. Do not repeat it. Finish.')
    expect((await raw()).match(/"event":"effect"/g)).toHaveLength(1)
    const text = JSON.stringify(p.requests)
    expect(text).toContain('ROOT_COMBINED_RULE')
    expect(text).toContain('COMBINED_GUIDE')
    expect(snapshot.recovery?.hooks?.checks[0].state).toBe('passed')
    expect(snapshot.recovery?.tools[0].state).toBe('unknown')
    await save(
      'combined-mcp-unknown.json',
      JSON.stringify({ snapshot, requests: p.requests, audit: await raw() }, null, 2)
    )
  })
})

it('rechecks a recovered session with fresh explicit trust, no model credential and no old tool replay', async () => {
  const p = await setup('afterTool', 'block')
  const a = new Agent({
    cwd: p.dir,
    skills: false,
    projectInstructions: false,
    hooks: { file: p.file, trust: p.trust },
    permissions: { mode: 'accept-edits' },
    config: { apiKey: 'fixture', baseURL: p.baseURL },
  })
  await expect(a.run('write once')).rejects.toThrow('already executed')
  const root = path.join(p.dir, 'sessions')
  const store = await SessionStore.open(p.dir, root)
  const saved = await store.save(store.fresh(), a.snapshot())
  p.config.hooks[0].args[1] = 'pass'
  await fs.writeFile(p.file, JSON.stringify(p.config))
  const views = await new Hooks(p.dir, { file: p.file }).inspect()
  const args = [
    '--hooks-config',
    p.file,
    ...views.flatMap(v => ['--hook-trust', `${v.id}:${v.identity}`]),
  ]
  const env = {
    ...p.env,
    ZERO2AGENT_NO_SAVE: '0',
    ZERO2AGENT_SESSION_DIR: root,
    ANTHROPIC_API_KEY: undefined,
  }
  const result = await runCli({
    cwd: p.dir,
    args: [
      ...args,
      '--resume',
      saved.id,
      '--recheck-hooks',
      'I reviewed the existing file and replacement checker. Run a new check.',
    ],
    env,
  })
  expect(result.code, result.output).toBe(0)
  expect(result.output).toContain('Hook afterTool/gate: passed')
  expect(p.requests).toHaveLength(1)
  const state = (await store.load(saved.id)).state
  expect(state.recovery?.hooks?.checks.map(c => c.state)).toEqual(['blocked', 'passed'])
  expect(state.recovery?.hooks?.checks[1].resolves).toBe(state.recovery?.hooks?.checks[0].checkId)
  expect(await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8')).toBe('once')
  const finish = await runCli({
    cwd: p.dir,
    args: [
      ...args,
      '--resume',
      saved.id,
      '--resume-task',
      'Finish using the existing checked file; no old writes.',
    ],
    env: { ...env, ANTHROPIC_API_KEY: 'fixture' },
  })
  expect(finish.code, finish.output).toBe(0)
  expect(p.requests).toHaveLength(2)
  expect((await store.load(saved.id)).state.recovery).toBeUndefined()
  expect(await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8')).toBe('once')
  await save('host-explicit-recheck.txt', result.output + '\n' + finish.output)
})
