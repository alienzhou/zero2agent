import { createServer, type ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Agent } from '@zero2agent/core'
import { Conversations } from '../../packages/tui/dist/conversations.js'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { CLI_ENTRY, makeTempWorkspace, runCli } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
import { sendSSEReply } from './helpers/sse.js'

type Request = {
  system?: string
  messages: Array<{ role: string; content: unknown }>
  tools?: Array<{ name: string }>
}
const cleanups: Array<() => Promise<void>> = []
const skillFile = '.agents/skills/fix-with-tests/SKILL.md'
const skill = (body = 'HOST_SKILL_BODY_V1') =>
  `---\nname: fix-with-tests\ndescription: HOST_SKILL_DESCRIPTION for verified fixes.\n---\n${body}\n`
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
async function saveEvidence(label: string, text: string): Promise<void> {
  const directory = process.env.E05_SKILL_EVIDENCE_DIR
  if (!directory) return
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, `${label}-${randomUUID()}.txt`), text, { flag: 'wx' })
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture(respond?: (res: ServerResponse, index: number) => void | Promise<void>) {
  const workspace = await makeTempWorkspace({
    [skillFile]: skill(),
    '.agents/skills/fix-with-tests/references/report.json': '{"schema":"HOST_REPORT_RESOURCE"}',
    '.agents/skills/unrelated/SKILL.md':
      '---\nname: unrelated\ndescription: A prose-only guide unrelated to amount fixes.\n---\nHOST_UNRELATED_BODY\n',
  })
  cleanups.push(workspace.cleanup)
  const requests: Request[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body) as Request)
    if (respond) await respond(response, requests.length)
    else sendSSEReply(response, [{ type: 'text', text: `SKILL_MODEL_DONE_${requests.length}` }])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  cleanups.push(() => saveEvidence('requests', JSON.stringify(requests, null, 2)))
  const env = {
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    ZERO2AGENT_NO_SAVE: '1',
    ZERO2AGENT_NO_LOG: '1',
    ZERO2AGENT_NO_CHECKPOINTS: '1',
    ANTHROPIC_API_KEY: 'fixture-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    PERMISSION_MODE: 'accept-edits',
  }
  return { ...workspace, requests, env }
}
function expectPaired(request: Request): void {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of request.messages) {
    if (!Array.isArray(message.content)) continue
    for (const value of message.content as Array<Record<string, unknown>>) {
      if (value.type === 'tool_use') {
        expect(calls.has(String(value.id))).toBe(false)
        calls.add(String(value.id))
      } else if (value.type === 'tool_result') {
        expect(calls.has(String(value.tool_use_id))).toBe(true)
        expect(results.has(String(value.tool_use_id))).toBe(false)
        results.add(String(value.tool_use_id))
      }
    }
  }
  expect([...results].sort()).toEqual([...calls].sort())
}

describe('E05-S002 actual CLI and host surfaces', () => {
  it('inspects catalogue source identity without a key, body or model request', async () => {
    const p = await fixture()
    const result = await runCli({
      cwd: p.dir,
      args: ['--skills'],
      env: { ...p.env, ANTHROPIC_API_KEY: undefined },
    })
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('fix-with-tests')
    expect(result.output).toContain('HOST_SKILL_DESCRIPTION')
    expect(result.output).toContain(skillFile)
    expect(result.output).toContain('SKILL.md')
    expect(result.output).not.toContain('HOST_SKILL_BODY_V1')
    expect(result.output).not.toContain('HOST_UNRELATED_BODY')
    expect(p.requests).toHaveLength(0)
  })

  it.each(['deny', 'ask'])(
    'noninteractive discovery respects read %s without leaking metadata or body',
    async action => {
      const p = await fixture()
      const result = await runCli({
        cwd: p.dir,
        args: ['--skills'],
        env: { ...p.env, PERMISSION_RULES: JSON.stringify([{ tool: 'read_file', action }]) },
      })
      expect(result.code, result.output).toBe(1)
      expect(result.output).toMatch(/denied|拒绝/i)
      expect(result.output).not.toContain('HOST_SKILL_DESCRIPTION')
      expect(result.output).not.toContain('HOST_SKILL_BODY_V1')
      expect(p.requests).toHaveLength(0)
    }
  )

  it('rejects ambiguous flags or missing arguments before model work', async () => {
    const p = await fixture()
    for (const args of [
      ['--skills', 'task'],
      ['--skill'],
      ['--skill-root'],
      ['--skills', '--logs'],
    ]) {
      const result = await runCli({ cwd: p.dir, args, env: p.env })
      expect(result.code, result.output).toBe(1)
    }
    expect(p.requests).toHaveLength(0)
  })

  it('explicitly selects a skill for a single task and a plain piped task', async () => {
    const p = await fixture()
    const direct = await runCli({
      cwd: p.dir,
      args: ['--skill', 'fix-with-tests', 'repair amount'],
      env: p.env,
    })
    expect(direct.code, direct.output).toBe(0)
    const piped = await runCli({
      cwd: p.dir,
      args: ['--plain', '--skill', 'fix-with-tests'],
      stdin: 'piped repair\n',
      env: p.env,
    })
    expect(piped.code, piped.output).toBe(0)
    expect(p.requests).toHaveLength(2)
    for (const request of p.requests) {
      expect(JSON.stringify(request)).toContain('HOST_SKILL_BODY_V1')
      expect(JSON.stringify(request)).not.toContain('HOST_UNRELATED_BODY')
      expectPaired(request)
    }
    expect(JSON.stringify(p.requests[1])).toContain('piped repair')
  })

  it('uses an explicitly configured external root under current read permissions', async () => {
    const p = await fixture()
    const external = await makeTempWorkspace({
      'external-guide/SKILL.md':
        '---\nname: external-guide\ndescription: External source fixture.\n---\nHOST_EXTERNAL_BODY\n',
    })
    cleanups.push(external.cleanup)
    const allowed = await runCli({
      cwd: p.dir,
      args: ['--skill-root', external.dir, '--skill', 'external-guide', 'use external guide'],
      env: {
        ...p.env,
        PERMISSION_RULES: JSON.stringify([
          { tool: 'list_directory', action: 'allow' },
          { tool: 'read_file', action: 'allow' },
        ]),
      },
    })
    expect(allowed.code, allowed.output).toBe(0)
    expect(JSON.stringify(p.requests[0])).toContain('HOST_EXTERNAL_BODY')
    const denied = await runCli({
      cwd: p.dir,
      args: ['--skill-root', external.dir, '--skill', 'external-guide', 'denied external guide'],
      env: { ...p.env, PERMISSION_MODE: 'read-only' },
    })
    expect(denied.code, denied.output).toBe(1)
    expect(p.requests).toHaveLength(1)
  })

  it.each([
    { restore: '--resume', prior: 'legacy' },
    { restore: '--resume', prior: 'selected' },
    { restore: '--continue', prior: 'legacy' },
    { restore: '--continue', prior: 'selected' },
  ])(
    'honors current --skill with $restore and a $prior saved conversation',
    async ({ restore, prior }) => {
      const p = await fixture()
      const storage = path.join(p.dir, 'test-sessions')
      const store = await SessionStore.open(p.dir, storage)
      const previous = new Agent({
        cwd: p.dir,
        permissions: { mode: 'accept-edits' },
        ...(prior === 'selected' ? { skills: { selected: ['unrelated'] } } : {}),
      })
      if (prior === 'selected') await previous.refreshSkills()
      const state = previous.snapshot()
      state.messages = [
        { role: 'user', content: 'previous task' },
        { role: 'assistant', content: 'previous answer' },
      ]
      const saved = await store.save(store.fresh(), state)
      expect(saved.version).toBe(prior === 'selected' ? 3 : 1)
      expect(p.requests).toHaveLength(0)
      const result = await runCli({
        cwd: p.dir,
        args: [
          restore,
          ...(restore === '--resume' ? [saved.id] : []),
          '--skill',
          'fix-with-tests',
          'current repair task',
        ],
        env: { ...p.env, ZERO2AGENT_NO_SAVE: '0', ZERO2AGENT_SESSION_DIR: storage },
      })
      expect(result.code, result.output).toBe(0)
      expect(p.requests).toHaveLength(1)
      expect(JSON.stringify(p.requests[0].messages[0])).toContain('HOST_SKILL_BODY_V1')
      expect(JSON.stringify(p.requests[0])).toContain('previous task')
      expect(JSON.stringify(p.requests[0])).toContain('current repair task')
      expectPaired(p.requests[0])
      const published = await store.load(saved.id)
      expect(published.state.skills?.selected.some(entry => entry.source.endsWith(skillFile))).toBe(
        true
      )
    }
  )

  it('turns loading off for single-shot and piped compatibility paths', async () => {
    const p = await fixture()
    const direct = await runCli({ cwd: p.dir, args: ['--no-skills', 'task'], env: p.env })
    expect(direct.code, direct.output).toBe(0)
    const piped = await runCli({
      cwd: p.dir,
      args: ['--plain', '--no-skills'],
      stdin: 'piped task\n',
      env: p.env,
    })
    expect(piped.code, piped.output).toBe(0)
    expect(p.requests).toHaveLength(2)
    expect(JSON.stringify(p.requests)).not.toContain('HOST_SKILL_DESCRIPTION')
    expect(JSON.stringify(p.requests)).not.toContain('HOST_SKILL_BODY_V1')
  })

  it('pairs a mixed loading batch as unexecuted before any write, then loads and executes once', async () => {
    const observations: boolean[] = []
    const p = await fixture(async (res, index) => {
      observations.push(
        await fs.stat(path.join(p.dir, 'out.txt')).then(
          () => true,
          () => false
        )
      )
      if (index === 1)
        sendSSEReply(
          res,
          [
            {
              type: 'tool_use',
              id: 'mixed-load',
              name: 'load_skill',
              input: { skill: 'fix-with-tests' },
            },
            {
              type: 'tool_use',
              id: 'mixed-write',
              name: 'write_file',
              input: { path: 'out.txt', content: 'once' },
            },
          ],
          'tool_use'
        )
      else if (index === 2)
        sendSSEReply(
          res,
          [
            {
              type: 'tool_use',
              id: 'load-alone',
              name: 'load_skill',
              input: { skill: 'fix-with-tests' },
            },
          ],
          'tool_use'
        )
      else if (index === 3)
        sendSSEReply(
          res,
          [
            {
              type: 'tool_use',
              id: 'actual-write',
              name: 'write_file',
              input: { path: 'out.txt', content: 'once' },
            },
          ],
          'tool_use'
        )
      else sendSSEReply(res, [{ type: 'text', text: 'finished' }])
    })
    const result = await runCli({
      cwd: p.dir,
      args: ['--max-requests', '4', 'use the skill and write output'],
      env: p.env,
    })
    expect(result.code, result.output).toBe(0)
    expect(p.requests).toHaveLength(4)
    expect(JSON.stringify(p.requests[0])).not.toContain('HOST_SKILL_BODY_V1')
    expect(JSON.stringify(p.requests[2])).toContain('HOST_SKILL_BODY_V1')
    expect(observations).toEqual([false, false, false, true])
    expect(await fs.readFile(path.join(p.dir, 'out.txt'), 'utf8')).toBe('once')
    for (const request of p.requests) expectPaired(request)
    const mixedResults = p.requests[1].messages
      .flatMap(message =>
        Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : []
      )
      .filter(block => block.type === 'tool_result')
    expect(mixedResults).toHaveLength(2)
    expect(mixedResults.every(block => block.is_error === true)).toBe(true)
  })

  it('shares no-model inspect/load/unload/refresh controls without rewriting conversation history', async () => {
    const p = await fixture()
    const agent = new Agent({
      cwd: p.dir,
      config: { apiKey: 'fixture-key', baseURL: p.env.ANTHROPIC_BASE_URL },
    })
    const conversations = new Conversations(agent)
    const before = agent.getHistory()
    expect(await conversations.skills('refresh')).toContain(skillFile)
    expect(await conversations.skills('load fix-with-tests')).toContain(hash(skill()))
    expect(JSON.stringify(agent.getSkills())).toContain('fix-with-tests')
    await fs.writeFile(path.join(p.dir, skillFile), skill('HOST_SKILL_BODY_V2'))
    expect(await conversations.skills()).toContain(hash(skill()))
    expect(await conversations.skills('refresh')).toContain(hash(skill('HOST_SKILL_BODY_V2')))
    await conversations.skills('unload fix-with-tests')
    await conversations.skills('off')
    expect(JSON.stringify(agent.getSkills())).toContain('false')
    await conversations.skills('on')
    expect(agent.getHistory()).toEqual(before)
    expect(p.requests).toHaveLength(0)
    await expect(conversations.skills('unknown')).rejects.toThrow(/用法|usage/i)
  })

  it('keeps a plain pipe responsive across load, task, disable and another task', async () => {
    const p = await fixture()
    const child = spawn(process.execPath, [CLI_ENTRY, '--plain'], {
      cwd: p.dir,
      env: { ...process.env, ...p.env },
    })
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk
    })
    child.stderr.on('data', chunk => {
      output += chunk
    })
    const exited = new Promise<number | null>(resolve => child.on('close', resolve))
    cleanups.push(async () => {
      if (child.exitCode === null) child.kill('SIGKILL')
      await exited
      await saveEvidence('plain-raw', output)
    })
    await expect.poll(() => output.includes('你: ')).toBe(true)
    let from = output.length
    child.stdin.write('/skills load fix-with-tests\n')
    await expect.poll(() => output.slice(from).includes('你: ')).toBe(true)
    expect(p.requests).toHaveLength(0)
    child.stdin.write('normal task\n')
    await expect.poll(() => output.includes('SKILL_MODEL_DONE_1')).toBe(true)
    expect(JSON.stringify(p.requests[0])).toContain('HOST_SKILL_BODY_V1')
    from = output.length
    child.stdin.write('/skills off\n')
    await expect.poll(() => output.slice(from).includes('你: ')).toBe(true)
    child.stdin.write('disabled task\n')
    await expect.poll(() => output.includes('SKILL_MODEL_DONE_2')).toBe(true)
    // The old active body was an overlay, not an ordinary conversation tool result.
    expect(JSON.stringify(p.requests[1])).not.toContain('HOST_SKILL_BODY_V1')
    child.stdin.write('exit\n')
    expect(await exited).toBe(0)
  })

  it.skipIf(process.platform === 'win32')(
    'loads, refreshes and unloads matching current versions in a real TUI',
    async () => {
      const p = await fixture()
      const session = startHumanTerminal(CLI_ENTRY, [], p.dir, true, { env: p.env })
      cleanups.push(async () => {
        await session.close()
        await saveEvidence('tui-raw', session.output)
      })
      session.resize(140, 42)
      await session.waitFor('你: ')
      session.write('/skills refresh\r')
      await session.waitFor(skillFile)
      expect(p.requests).toHaveLength(0)
      let from = session.output.length
      session.write('/skills load fix-with-tests\r')
      await session.waitFor(hash(skill()), from)
      from = session.output.length
      session.write('normal task\r')
      await session.waitFor('SKILL_MODEL_DONE_1', from)
      expect(JSON.stringify(p.requests[0])).toContain('HOST_SKILL_BODY_V1')
      await fs.writeFile(path.join(p.dir, skillFile), skill('HOST_SKILL_BODY_V2'))
      from = session.output.length
      session.write('/skills refresh\r')
      await session.waitFor(hash(skill('HOST_SKILL_BODY_V2')), from)
      expect(p.requests).toHaveLength(1)
      from = session.output.length
      session.write('/skills unload fix-with-tests\r')
      await session.waitFor(hash(skill('HOST_SKILL_BODY_V2')), from)
      from = session.output.length
      session.write('after unloading\r')
      await session.waitFor('SKILL_MODEL_DONE_2', from)
      expect(JSON.stringify(p.requests[1])).not.toContain('HOST_SKILL_BODY_V2')
      session.write('exit\r')
      expect(await session.waitExit()).toBe(0)
      expect(session.output).toContain('\x1b[?1049l')
      expect(session.output).toContain('\x1b[?2004l')
      expect(session.output).toContain('\x1b[?25h')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'cancels skill-read approval and preserves the next TUI command and terminal cleanup',
    async () => {
      const p = await fixture()
      const session = startHumanTerminal(CLI_ENTRY, [], p.dir, true, {
        env: { ...p.env, PERMISSION_RULES: JSON.stringify([{ tool: 'read_file', action: 'ask' }]) },
      })
      cleanups.push(async () => {
        await session.close()
        await saveEvidence('tui-raw', session.output)
      })
      await session.waitFor('你: ')
      session.write('/skills refresh\r')
      await session.waitFor('Approval · read_file')
      let from = session.output.length
      session.write('\x03')
      await session.waitFor('你: ', from)
      expect(p.requests).toHaveLength(0)
      from = session.output.length
      session.write('/skills off\r')
      await session.waitFor('你: ', from)
      from = session.output.length
      session.write('after skill cancellation\r')
      await session.waitFor('SKILL_MODEL_DONE_1', from)
      expect(p.requests).toHaveLength(1)
      expect(JSON.stringify(p.requests[0])).not.toContain('HOST_SKILL_BODY_V1')
      session.signal('SIGTERM')
      await session.waitExit()
      expect(session.output).toContain('\x1b[?1049l')
      expect(session.output).toContain('\x1b[?2004l')
      expect(session.output).toContain('\x1b[?25h')
    }
  )
})
