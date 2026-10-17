import { createServer, type ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Agent } from '@zero2agent/core'
import { Conversations } from '../../packages/tui/dist/conversations.js'
import { CLI_ENTRY, makeTempWorkspace, runCli } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
import { sendSSEReply } from './helpers/sse.js'

type Request = { system?: string; messages: Array<{ role: string; content: unknown }> }
const cleanups: Array<() => Promise<void>> = []
// Optional acceptance artifacts: preserve terminal control bytes and request bodies, never headers.
async function saveEvidence(label: string, body: string): Promise<void> {
  const directory = process.env.E05_INSTRUCTION_EVIDENCE_DIR
  if (!directory) return
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, `${label}-${randomUUID()}.txt`), body, { flag: 'wx' })
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture(respond?: (res: ServerResponse, index: number) => void | Promise<void>) {
  const workspace = await makeTempWorkspace({
    'AGENTS.md': 'ROOT_CONVENTION',
    'packages/api/AGENTS.md': 'API_CONVENTION',
    'packages/web/AGENTS.md': 'WEB_CONVENTION',
  })
  cleanups.push(workspace.cleanup)
  const requests: Request[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body))
    if (respond) await respond(res, requests.length)
    else sendSSEReply(res, [{ type: 'text', text: `MODEL_DONE_${requests.length}` }])
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
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
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

describe('E05-S001 actual CLI and host surfaces', () => {
  it('preloads an explicit CLI task scope in the first request and inspects without a model', async () => {
    const p = await fixture()
    const result = await runCli({
      cwd: p.dir,
      args: ['--instructions-scope', 'packages/api', 'task'],
      env: p.env,
    })
    expect(result.code, result.output).toBe(0)
    expect(p.requests).toHaveLength(1)
    expect(JSON.stringify(p.requests[0])).toContain('API_CONVENTION')
    expect(JSON.stringify(p.requests[0])).not.toContain('WEB_CONVENTION')
    const inspected = await runCli({
      cwd: p.dir,
      args: ['--instructions-scope', 'packages/api', '--instructions'],
      env: { ...p.env, ANTHROPIC_API_KEY: undefined },
    })
    expect(inspected.code, inspected.output).toBe(0)
    expect(inspected.output).toContain(hash('API_CONVENTION'))
    expect(p.requests).toHaveLength(1)
    for (const args of [
      ['--instructions-scope'],
      ['--no-instructions', '--instructions-scope', 'packages/api', 'task'],
    ]) {
      expect((await runCli({ cwd: p.dir, args, env: p.env })).code).toBe(1)
    }
    expect(p.requests).toHaveLength(1)
  })

  it('inspects source, scope and full content version without an API key or model call', async () => {
    const p = await fixture()
    const result = await runCli({
      cwd: path.join(p.dir, 'packages/api'),
      args: ['--instructions-root', p.dir, '--instructions'],
      env: { ...p.env, ANTHROPIC_API_KEY: undefined },
    })
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain(hash('ROOT_CONVENTION'))
    expect(result.output).toContain(hash('API_CONVENTION'))
    expect(result.output).not.toContain(hash('WEB_CONVENTION'))
    expect(result.output).not.toContain('API_CONVENTION')
    expect(p.requests).toHaveLength(0)
  })

  it.each(['deny', 'ask'])(
    'noninteractive inspection respects explicit %s and returns no body',
    async action => {
      const p = await fixture()
      const result = await runCli({
        cwd: p.dir,
        args: ['--instructions'],
        env: { ...p.env, PERMISSION_RULES: JSON.stringify([{ tool: 'read_file', action }]) },
      })
      expect(result.code, result.output).toBe(1)
      expect(result.output).toContain('denied')
      expect(result.output).not.toContain('ROOT_CONVENTION')
      expect(p.requests).toHaveLength(0)
    }
  )

  it('rejects ambiguous action flags before starting model work', async () => {
    const p = await fixture()
    for (const args of [
      ['--instructions', 'task'],
      ['--instructions-root'],
      ['--instructions', '--logs'],
    ]) {
      const result = await runCli({ cwd: p.dir, args, env: p.env })
      expect(result.code).toBe(1)
    }
    expect(p.requests).toHaveLength(0)
  })

  it('runs a real HTTP/SSE replan before the first nested write', async () => {
    const observations: boolean[] = []
    const p = await fixture(async (res, index) => {
      observations.push(
        await fs.stat(path.join(p.dir, 'packages/api/out.txt')).then(
          () => true,
          () => false
        )
      )
      if (index <= 2)
        sendSSEReply(
          res,
          [
            {
              type: 'tool_use',
              id: `write-${index}`,
              name: 'write_file',
              input: { path: 'packages/api/out.txt', content: 'once' },
            },
          ],
          'tool_use'
        )
      else sendSSEReply(res, [{ type: 'text', text: 'finished' }])
    })
    const result = await runCli({
      cwd: p.dir,
      args: ['--max-requests', '4', 'write api output'],
      env: p.env,
    })
    expect(result.code, result.output).toBe(0)
    expect(p.requests).toHaveLength(3)
    expect(JSON.stringify(p.requests[0])).not.toContain('API_CONVENTION')
    expect(JSON.stringify(p.requests[1])).toContain('API_CONVENTION')
    expect(JSON.stringify(p.requests[1])).toContain('entire batch was not executed')
    expect(await fs.readFile(path.join(p.dir, 'packages/api/out.txt'), 'utf8')).toBe('once')
    expect(observations).toEqual([false, false, true])
  })

  it('supports turning loading off for single-shot and piped tasks', async () => {
    const p = await fixture()
    const direct = await runCli({ cwd: p.dir, args: ['--no-instructions', 'task'], env: p.env })
    expect(direct.code, direct.output).toBe(0)
    const piped = await runCli({
      cwd: p.dir,
      args: ['--plain'],
      env: { ...p.env, ZERO2AGENT_NO_INSTRUCTIONS: '1' },
      stdin: 'piped task\n',
    })
    expect(piped.code, piped.output).toBe(0)
    expect(p.requests).toHaveLength(2)
    expect(JSON.stringify(p.requests[1])).toContain('piped task')
    expect(JSON.stringify(p.requests)).not.toContain('ROOT_CONVENTION')
  })

  it('shares read-only inspection/refresh controls with Conversations without changing history', async () => {
    const p = await fixture()
    const agent = new Agent({
      cwd: p.dir,
      config: { apiKey: 'fixture-key', baseURL: p.env.ANTHROPIC_BASE_URL },
    })
    const conversations = new Conversations(agent)
    const before = agent.snapshot()
    expect(await conversations.instructions('refresh')).toContain(hash('ROOT_CONVENTION'))
    await fs.writeFile(path.join(p.dir, 'AGENTS.md'), 'UPDATED_CONVENTION')
    expect(await conversations.instructions()).toContain(hash('ROOT_CONVENTION'))
    expect(await conversations.instructions('refresh')).toContain(hash('UPDATED_CONVENTION'))
    expect(await conversations.instructions('off')).toContain('已关闭')
    expect(await conversations.instructions('on')).toContain('已开启')
    expect(agent.snapshot()).toEqual(before)
    expect(p.requests).toHaveLength(0)
    await expect(conversations.instructions('unknown')).rejects.toThrow('用法')
  })

  it('keeps a plain pipe responsive across refresh, disable and a task', async () => {
    const p = await fixture()
    const child = spawn(process.execPath, [CLI_ENTRY, '--plain'], {
      cwd: p.dir,
      env: { ...process.env, ...p.env },
    })
    let output = ''
    child.stdout.on('data', b => {
      output += b
    })
    child.stderr.on('data', b => {
      output += b
    })
    const exited = new Promise<number | null>(resolve => child.on('close', resolve))
    cleanups.push(async () => {
      if (child.exitCode === null) child.kill('SIGKILL')
      await exited
      await saveEvidence('plain-raw', output)
    })
    await expect.poll(() => output.includes('你: ')).toBe(true)
    child.stdin.write('/instructions refresh\n')
    await expect.poll(() => output.includes(hash('ROOT_CONVENTION'))).toBe(true)
    expect(p.requests).toHaveLength(0)
    child.stdin.write('/instructions off\n')
    await expect.poll(() => output.includes('项目指令 已关闭')).toBe(true)
    child.stdin.write('normal task\n')
    await expect.poll(() => output.includes('MODEL_DONE_1')).toBe(true)
    expect(JSON.stringify(p.requests[0])).not.toContain('ROOT_CONVENTION')
    child.stdin.write('exit\n')
    expect(await exited).toBe(0)
  })

  it.skipIf(process.platform === 'win32')(
    'shows matching versions, refreshes and switches off in the real TUI',
    async () => {
      const p = await fixture()
      const session = startHumanTerminal(CLI_ENTRY, [], p.dir, true, { env: p.env })
      cleanups.push(async () => {
        await session.close()
        await saveEvidence('tui-raw', session.output)
      })
      session.resize(140, 42)
      await session.waitFor('你: ')
      session.write('/instructions refresh\r')
      await session.waitFor(hash('ROOT_CONVENTION'))
      expect(p.requests).toHaveLength(0)
      let from = session.output.length
      session.write('normal task\r')
      await session.waitFor('MODEL_DONE_1', from)
      expect(JSON.stringify(p.requests[0])).toContain(hash('ROOT_CONVENTION'))
      await fs.writeFile(path.join(p.dir, 'AGENTS.md'), 'TUI_UPDATED')
      from = session.output.length
      session.write('/instructions refresh\r')
      await session.waitFor(hash('TUI_UPDATED'), from)
      expect(p.requests).toHaveLength(1)
      from = session.output.length
      session.write('/instructions off\r')
      await session.waitFor('项目指令 已关闭', from)
      from = session.output.length
      session.write('disabled task\r')
      await session.waitFor('MODEL_DONE_2', from)
      expect(JSON.stringify(p.requests[1])).not.toContain('TUI_UPDATED')
      await expect
        .poll(() => session.output.slice(session.output.lastIndexOf('\x1b[H')).includes('你: '))
        .toBe(true)
      session.write('exit\r')
      expect(await session.waitExit()).toBe(0)
      expect(session.output).toContain('\x1b[?1049l')
      expect(session.output).toContain('\x1b[?2004l')
      expect(session.output).toContain('\x1b[?25h')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'cancels rule-read approval without consuming the next TUI command',
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
      session.write('/instructions refresh\r')
      await session.waitFor('Approval · read_file')
      let from = session.output.length
      session.write('\x03')
      await session.waitFor('你: ', from)
      expect(p.requests).toHaveLength(0)
      from = session.output.length
      session.write('/instructions off\r')
      await session.waitFor('项目指令 已关闭', from)
      from = session.output.length
      session.write('after cancellation\r')
      await session.waitFor('MODEL_DONE_1', from)
      expect(p.requests).toHaveLength(1)
      session.signal('SIGTERM')
      await session.waitExit()
      expect(session.output).toContain('\x1b[?1049l')
      expect(session.output).toContain('\x1b[?2004l')
    }
  )
})
