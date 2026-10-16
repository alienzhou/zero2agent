import { createServer, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { hostname } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Agent,
  ResultStore,
  allTools,
  validateSessionSnapshot,
  type ExecutionBoundary,
  type SessionSnapshot,
} from '@zero2agent/core'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { Conversations } from '../../packages/tui/dist/conversations.js'
import { makeTempWorkspace, runCli, CLI_ENTRY } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
import { sendSSEReply } from './helpers/sse.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})
const child = fileURLToPath(new URL('./fixtures/safe-resume-child.mjs', import.meta.url))
const writes = ['first', 'second'].map(id => ({
  type: 'tool_use',
  id,
  name: 'write_file',
  input: { path: `${id}.txt`, content: id },
}))
async function fixture(reply?: (res: ServerResponse, count: number) => void) {
  const ws = await makeTempWorkspace()
  cleanups.push(ws.cleanup)
  const requests: Array<{ messages: unknown[] }> = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    if (reply) reply(res, requests.length)
    else if (requests.length === 1) sendSSEReply(res, writes, 'tool_use')
    else sendSSEReply(res, [{ type: 'text', text: 'finished after inspecting existing evidence' }])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const baseURL = `http://127.0.0.1:${address.port}`
  const store = await SessionStore.open(ws.dir, path.join(ws.dir, 'sessions'))
  const launch = (stop: string, mode = 'crash', extraEnv: Record<string, string> = {}) =>
    new Promise<{ code: number | null; signal: string | null; output: string }>(
      (resolve, reject) => {
        const proc = spawn(process.execPath, [child, ws.dir, baseURL, stop, mode], {
          env: { ...process.env, ...extraEnv },
        })
        let output = ''
        proc.stdout.on('data', b => {
          output += b
        })
        proc.stderr.on('data', b => {
          output += b
        })
        const timer = setTimeout(() => proc.kill('SIGKILL'), 15000)
        proc.on('error', reject)
        proc.on('close', (code, signal) => {
          clearTimeout(timer)
          resolve({ code, signal, output })
        })
      }
    )
  return { ...ws, store, launch, requests, baseURL }
}

describe.skipIf(process.platform === 'win32')('E04-S004 real process interruption', () => {
  it.each([
    ['response', ['not-started', 'not-started'], 0],
    ['tool-start', ['unknown', 'not-started'], 0],
    ['effect', ['unknown', 'not-started'], 1],
    ['tool-settled', ['settled', 'not-started'], 1],
  ] as const)('preserves %s boundary without replay', async (stop, states, effects) => {
    const p = await fixture()
    const crashed = await p.launch(stop)
    expect(crashed.signal, crashed.output).toBe('SIGKILL')
    const [item] = await p.store.list()
    const before = await p.store.load(item.id)
    expect(before.state.recovery?.tools.map(t => t.state)).toEqual(states)
    expect(before.state.messages[0].content).toContain('Create first.txt')
    validateSessionSnapshot(before.state)
    const inspected = await p.launch('', 'inspect')
    expect(inspected.code, inspected.output).toBe(0)
    expect(inspected.output).toContain('RecoveryRequiredError')
    expect(p.requests).toHaveLength(1)
    expect((await p.store.load(item.id)).state.messages).toEqual(before.state.messages)
    const continued = await p.launch('', 'continue')
    expect(continued.code, continued.output).toBe(0)
    expect(p.requests).toHaveLength(2)
    const text = await fs.readFile(path.join(p.dir, 'effects.txt'), 'utf8').catch(() => '')
    expect(text.trim().split('\n').filter(Boolean)).toHaveLength(effects)
    if (effects) expect(await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8')).toBe('first')
    await expect(fs.stat(path.join(p.dir, 'second.txt'))).rejects.toThrow()
    const saved = await p.store.load(item.id)
    expect(saved.state.recovery).toBeUndefined()
    expect(saved.pending).toBeUndefined()
    expect(JSON.stringify(p.requests[1].messages)).toContain('Create first.txt')
    if (stop === 'tool-settled')
      expect(JSON.stringify(p.requests[1].messages)).toContain(
        'Created first.txt (5 bytes written)'
      )
  })

  it('finishes the remaining file while preserving a newer human edit', async () => {
    const p = await fixture((res, count) => {
      if (count === 1) sendSSEReply(res, writes, 'tool_use')
      else if (count === 2) sendSSEReply(res, [{ ...writes[1], id: 'new-second' }], 'tool_use')
      else
        sendSSEReply(res, [{ type: 'text', text: 'both files inspected; remaining file written' }])
    })
    expect((await p.launch('tool-settled')).signal).toBe('SIGKILL')
    await fs.writeFile(path.join(p.dir, 'first.txt'), 'new human edit')
    const continued = await p.launch('', 'continue')
    expect(continued.code, continued.output).toBe(0)
    expect(await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8')).toBe('new human edit')
    expect(await fs.readFile(path.join(p.dir, 'second.txt'), 'utf8')).toBe('second')
    expect(await fs.readFile(path.join(p.dir, 'effects.txt'), 'utf8')).toBe(
      'first.txt\nsecond.txt\n'
    )
  })

  it('continues through production CLI only after the explicit new-budget action', async () => {
    const p = await fixture()
    expect((await p.launch('tool-settled')).signal).toBe('SIGKILL')
    const [item] = await p.store.list()
    const env = {
      ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      ZERO2AGENT_SESSION_DIR: path.join(p.dir, 'sessions'),
      ZERO2AGENT_RESULT_DIR: path.join(p.dir, 'results'),
      ANTHROPIC_API_KEY: 'fixture',
      ANTHROPIC_BASE_URL: p.baseURL,
      PERMISSION_MODE: 'accept-edits',
    }
    const blocked = await runCli({ cwd: p.dir, env, args: ['--resume', item.id, 'ordinary task'] })
    expect(blocked.code, blocked.output).toBe(1)
    expect(blocked.output).toContain('requires review')
    expect(p.requests).toHaveLength(1)
    const continued = await runCli({
      cwd: p.dir,
      env,
      args: ['--resume', item.id, '--resume-task', 'inspected; finish safely'],
    })
    expect(continued.code, continued.output).toBe(0)
    expect(continued.output).toContain('新一轮预算')
    expect(p.requests).toHaveLength(2)
    expect(await fs.readFile(path.join(p.dir, 'effects.txt'), 'utf8')).toBe('first.txt\n')
  })

  it('shows recovery and continues in the real PTY without running on inspection', async () => {
    const p = await fixture()
    expect((await p.launch('tool-settled')).signal).toBe('SIGKILL')
    const [item] = await p.store.list()
    const terminal = startHumanTerminal(CLI_ENTRY, ['--resume', item.id], p.dir, true, {
      env: {
        ZERO2AGENT_SESSION_DIR: path.join(p.dir, 'sessions'),
        ZERO2AGENT_RESULT_DIR: path.join(p.dir, 'results'),
        ANTHROPIC_BASE_URL: p.baseURL,
        PERMISSION_MODE: 'accept-edits',
      },
    })
    cleanups.push(() => terminal.close())
    await terminal.waitFor('中断任务待恢复')
    await terminal.waitFor('你: ')
    const from = terminal.output.length
    terminal.write('/recovery\r')
    await terminal.waitFor('中断任务待恢复', from)
    expect(p.requests).toHaveLength(1)
    terminal.write('/recovery continue inspected; finish safely\r')
    await terminal.waitFor('finished after inspecting')
    await terminal.waitFor('已保存')
    terminal.write('exit\r')
    expect(await terminal.waitExit()).toBe(0)
    expect(terminal.output).toContain('\x1b[?1049l')
    expect(p.requests).toHaveLength(2)
  })

  it('retains exhausted budget evidence and requires explicit new work', async () => {
    const p = await fixture()
    const crashed = await p.launch('turn-stopped', 'crash', { SAFE_RESUME_REQUESTS: '1' })
    expect(crashed.signal, crashed.output).toBe('SIGKILL')
    const [item] = await p.store.list()
    const old = await p.store.load(item.id)
    expect(old.state.recovery?.budget).toMatchObject({ requests: 1, stopReason: 'requests' })
    expect(old.state.recovery?.reason).toBe('stopped')
    expect((await p.launch('', 'inspect')).output).toContain('停止原因 requests')
    expect(p.requests).toHaveLength(1)
    expect((await p.launch('', 'continue')).code).toBe(0)
    expect(p.requests).toHaveLength(2)
    expect(await fs.readFile(path.join(p.dir, 'effects.txt'), 'utf8')).toBe(
      'first.txt\nsecond.txt\n'
    )
  })

  it('preserves contract and refuses false completion after a crash', async () => {
    const p = await fixture()
    const contract = {
      version: 1,
      artifacts: [
        { path: 'second.txt', format: 'json', schema: { kind: 'value', type: 'string' } },
      ],
    }
    const crashed = await p.launch('tool-settled', 'crash', {
      SAFE_RESUME_CONTRACT: JSON.stringify(contract),
    })
    expect(crashed.signal, crashed.output).toBe('SIGKILL')
    const resumed = await p.launch('', 'continue')
    expect(resumed.code, resumed.output).toBe(1)
    expect(resumed.output).toContain('ArtifactCompletionError')
    const [item] = await p.store.list()
    expect((await p.store.load(item.id)).state.recovery?.artifactContract).toEqual(contract)
    expect(p.requests).toHaveLength(3) // One original + one answer + bounded repair.
    expect((await p.launch('', 'continue')).code).toBe(1)
    expect(p.requests).toHaveLength(4) // Checking again cannot buy a second repair.
  })

  it('retains unresolved read guards across processes', async () => {
    let reference = ''
    const p = await fixture((res, count) => {
      if (count === 1)
        sendSSEReply(
          res,
          [
            {
              type: 'tool_use',
              id: 'bad-read',
              name: 'read_tool_result',
              input: { reference, tail: true, offset: 0 },
            },
          ],
          'tool_use'
        )
      else sendSSEReply(res, [{ type: 'text', text: 'done without evidence' }])
    })
    const results = new ResultStore({ directory: path.join(p.dir, 'results') })
    results.setWorkspace(p.dir)
    reference = (
      await results.save('evidence body', {
        toolName: 'read_file',
        toolCallId: 'seed',
        paths: [p.dir],
      })
    ).reference
    await fs.writeFile(path.join(p.dir, 'result-seed.json'), JSON.stringify(results.snapshot()))
    expect((await p.launch('tool-settled')).signal).toBe('SIGKILL')
    const continued = await p.launch('', 'continue')
    expect(continued.code, continued.output).toBe(1)
    expect(continued.output).toContain('EvidenceReadIncompleteError')
    const [item] = await p.store.list()
    const snapshot = (await p.store.load(item.id)).state
    expect(snapshot.recovery?.read).toMatchObject({ requested: true, pending: [reference] })
    const again = await p.launch('', 'continue')
    expect(again.code).toBe(1)
    expect(p.requests).toHaveLength(4) // The consumed correction stage was not reset.
  })

  it('uses current permissions for new calls after recovery', async () => {
    const p = await fixture((res, count) => {
      if (count <= 2) sendSSEReply(res, [writes[count - 1]], 'tool_use')
      else sendSSEReply(res, [{ type: 'text', text: 'new permission denied' }])
    })
    expect((await p.launch('tool-settled')).signal).toBe('SIGKILL')
    const continued = await p.launch('', 'deny')
    expect(continued.code, continued.output).toBe(0)
    expect(JSON.stringify(p.requests.at(-1))).toContain('Permission denied')
    await expect(fs.stat(path.join(p.dir, 'second.txt'))).rejects.toThrow()
  })
})

describe('execution persistence failures', () => {
  it.each(['response', 'tool-start', 'tool-settled'] as ExecutionBoundary[])(
    'stops on %s storage failure with paired history',
    async boundary => {
      const p = await fixture()
      const snapshots: SessionSnapshot[] = []
      const agent = new Agent({
        cwd: p.dir,
        config: { apiKey: 'fixture', baseURL: p.baseURL },
        permissions: { mode: 'accept-edits' },
        tools: allTools,
        executionPersistence: async (snapshot, at) => {
          validateSessionSnapshot(snapshot)
          if (at === boundary) throw new Error('disk unavailable')
          snapshots.push(snapshot)
        },
      })
      await expect(agent.run('write files')).rejects.toThrow('could not be saved')
      expect(p.requests).toHaveLength(1)
      const final = agent.snapshot()
      validateSessionSnapshot(final)
      expect(final.recovery).toBeDefined()
      await expect(agent.run('bypass')).rejects.toThrow('requires review')
      await expect(fs.stat(path.join(p.dir, 'second.txt'))).rejects.toThrow()
      const first = await fs.readFile(path.join(p.dir, 'first.txt'), 'utf8').catch(() => '')
      expect(first).toBe(boundary === 'tool-settled' ? 'first' : '')
      expect(snapshots.length).toBeGreaterThan(0)
    }
  )

  it('rejects corrupt controls before replacing the current session and preserves CAS conflicts', async () => {
    const p = await fixture()
    expect((await p.launch('tool-settled')).signal).toBe('SIGKILL')
    const [item] = await p.store.list()
    const saved = await p.store.load(item.id)
    const agent = new Agent()
    const before = agent.snapshot()
    const corruptions = [
      { ...saved.state.recovery!, version: 2 },
      { ...saved.state.recovery!, artifactAttempts: -1 },
      {
        ...saved.state.recovery!,
        read: { pending: ['invalid'], requested: false, overflow: false },
      },
      {
        ...saved.state.recovery!,
        tools: [{ ...saved.state.recovery!.tools[0], messageIndex: 99999 }],
      },
    ]
    for (const recovery of corruptions) {
      expect(() => agent.restore({ ...saved.state, recovery })).toThrow()
      expect(agent.snapshot()).toEqual(before)
    }
    await p.store.save(saved, saved.state)
    await expect(p.store.save(saved, saved.state)).rejects.toThrow('conflict')
    expect((await p.store.load(item.id)).state.recovery).toEqual(saved.state.recovery)
    await fs.writeFile(
      path.join(p.store.directory, item.id, `${saved.revision + 1}.json`),
      '{broken'
    )
    await expect(p.store.load(item.id)).rejects.toThrow()
    expect(p.requests).toHaveLength(1)
  })

  it('bounds storage without deleting the pending evidence', async () => {
    const p = await fixture()
    const store = await SessionStore.open(p.dir, path.join(p.dir, 'bounded'), {
      bytes: 1024 * 1024,
      revisions: 1,
    })
    const first = await store.save(
      store.fresh(),
      { messages: [], context: { through: 0, summary: '' } },
      { kind: 'turn', pid: process.pid, host: hostname() }
    )
    await expect(store.save(first, first.state)).rejects.toThrow('capacity')
    expect((await store.load(first.id)).pending).toEqual(first.pending)
    const c = new Conversations(new Agent(), store)
    await expect(c.resume(first.id)).rejects.toThrow('仍在运行')
  })
})
