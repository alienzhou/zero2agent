import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isLiveEnabled } from './helpers/live.js'
import {
  startLivePty,
  liveToolCalls,
  type LivePtySession,
  type LiveBlock,
} from './helpers/live-pty.js'
import { makeTempWorkspace, runCli } from './helpers/cli.js'

const sessions: Array<{ scenario: string; p: LivePtySession }> = []
const cleanups: Array<() => Promise<void>> = []
const writePrompt =
  '请仅使用 write_file 工具一次，path 精确为 result.txt，content 精确为 live-matrix-ok。收到工具结果后立即结束，不重试、不改用其他工具，不使用 terminal。'

async function start(
  scenario: string,
  files: Record<string, string> = {},
  env: Record<string, string> = {}
): Promise<LivePtySession> {
  const p = await startLivePty(files, env)
  sessions.push({ scenario, p })
  return p
}
function calls(p: LivePtySession): LiveBlock[] {
  return [...new Map(liveToolCalls(p.requests).map(b => [b.id, b])).values()]
}
function receipts(p: LivePtySession): LiveBlock[] {
  const all = p.requests.flatMap(r =>
    r.messages.flatMap(m =>
      Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []
    )
  )
  return [...new Map(all.map(b => [b.tool_use_id, b])).values()]
}
function checkReceipts(p: LivePtySession, names: string[], errors: boolean[]): void {
  expect(calls(p).map(b => b.name)).toEqual(names)
  const results = receipts(p)
  expect(results.map(b => b.tool_use_id)).toEqual(calls(p).map(b => b.id))
  expect(results.map(b => b.is_error === true)).toEqual(errors)
  expect(p.responses.length).toBeGreaterThan(0)
  expect(p.responses.every(r => r.status === 200)).toBe(true)
}
async function file(p: LivePtySession, name = 'result.txt'): Promise<string | null> {
  return readFile(join(p.cwd, name), 'utf8').catch(() => null)
}
async function exit(p: LivePtySession, from: number): Promise<void> {
  await p.input('exit', from)
  expect(await p.session.waitExit()).toBe(0)
}

afterEach(async () => {
  for (const { scenario, p } of sessions.splice(0)) {
    try {
      if (process.env.E2E_EVIDENCE_DIR) {
        await mkdir(process.env.E2E_EVIDENCE_DIR, { recursive: true })
        const evidence = JSON.stringify(
          {
            scenario,
            platform: process.platform,
            model: p.env.MODEL_NAME,
            requests: p.requests,
            responses: p.responses,
            output: p.session.output,
          },
          null,
          2
        )
        if (process.env.ANTHROPIC_API_KEY && evidence.includes(process.env.ANTHROPIC_API_KEY))
          throw new Error('Credential appeared in evidence; refusing to save')
        await writeFile(
          join(process.env.E2E_EVIDENCE_DIR, 'matrix-' + scenario + '.json'),
          evidence
        )
      }
    } finally {
      await p.close()
    }
  }
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe.skipIf(!isLiveEnabled() || process.platform === 'win32')(
  'E03-S002: live provider and actual CLI permission matrix',
  () => {
    it.each([
      ['empty', '\r'],
      ['invalid', 'always\r'],
      ['cancel', '\x03'],
      ['EOF', '\x04'],
      ['timeout', null],
    ] as const)('denies %s without writing', async (scenario, answer) => {
      const p = await start(
        scenario,
        {},
        scenario === 'timeout' ? { APPROVAL_TIMEOUT_MS: '900' } : {}
      )
      const from = await p.input(writePrompt)
      await p.session.waitFor('[y/N]: ', from)
      expect(await file(p)).toBeNull()
      if (answer !== null) p.session.write(answer)
      if (scenario === 'EOF') expect(await p.session.waitExit()).toBe(0)
      else await p.session.waitFor('你: ', from)
      expect(await file(p)).toBeNull()
      checkReceipts(p, ['write_file'], [true])
      if (scenario !== 'EOF') await exit(p, from)
    })

    it.each([
      ['read-only', false],
      ['accept-edits', true],
      ['bypass', true],
    ] as const)('honors host %s without an approval prompt', async (mode, allowed) => {
      const p = await start('mode-' + mode, {}, { PERMISSION_MODE: mode })
      const from = await p.input(writePrompt)
      await p.session.waitFor('你: ', from)
      expect(p.session.output.slice(from)).not.toContain('[y/N]: ')
      expect(await file(p)).toBe(allowed ? 'live-matrix-ok' : null)
      checkReceipts(p, ['write_file'], [!allowed])
      await exit(p, from)
    })

    it('explicit deny wins even in bypass', async () => {
      const p = await start(
        'rule-deny',
        {},
        {
          PERMISSION_MODE: 'bypass',
          PERMISSION_RULES: JSON.stringify([
            { tool: '*', action: 'allow' },
            { tool: 'write_file', action: 'deny' },
          ]),
        }
      )
      const from = await p.input(writePrompt)
      await p.session.waitFor('你: ', from)
      expect(p.session.output.slice(from)).not.toContain('[y/N]: ')
      expect(await file(p)).toBeNull()
      checkReceipts(p, ['write_file'], [true])
      expect(JSON.stringify(receipts(p))).toContain('Explicit deny rule')
      await exit(p, from)
    })

    it('explicit ask wins over allow and bypass', async () => {
      const p = await start(
        'rule-ask',
        {},
        {
          PERMISSION_MODE: 'bypass',
          PERMISSION_RULES: JSON.stringify([
            { tool: '*', action: 'allow' },
            { tool: 'write_file', action: 'ask' },
          ]),
        }
      )
      const from = await p.input(writePrompt)
      await p.session.waitFor('[y/N]: ', from)
      expect(await file(p)).toBeNull()
      p.session.write('n\r')
      await p.session.waitFor('你: ', from)
      expect(await file(p)).toBeNull()
      checkReceipts(p, ['write_file'], [true])
      await exit(p, from)
    })

    it.each(['replace_in_file', 'delete'] as const)(
      'approves %s before its real effect',
      async name => {
        const p = await start(name, { 'result.txt': 'old' })
        const prompt =
          name === 'replace_in_file'
            ? '请仅调用 replace_in_file 一次，path=result.txt，old_string=old，new_string=new。收到结果立即结束，不使用其他工具，不重试。'
            : '请仅调用 delete 一次，paths 必须是 ["result.txt"]。收到结果立即结束，不使用其他工具，不重试。'
        const from = await p.input(prompt)
        await p.session.waitFor('[y/N]: ', from)
        expect(await file(p)).toBe('old')
        p.session.write('y\r')
        await p.session.waitFor('你: ', from)
        expect(await file(p)).toBe(name === 'delete' ? null : 'new')
        checkReceipts(p, [name], [false])
        await exit(p, from)
      }
    )

    it('requires two answers for two calls to the same tool', async () => {
      const p = await start('once')
      const from = await p.input(
        '请只调用 write_file 两次：先创建 a.txt，content=A；再创建 b.txt，content=B。每次收到工具结果后按上述顺序继续，最后结束，不使用其他工具。'
      )
      await p.session.waitFor('[y/N]: ', from)
      expect(await file(p, 'a.txt')).toBeNull()
      const second = p.session.output.length
      p.session.write('y\r')
      await p.session.waitFor('[y/N]: ', second)
      expect(await file(p, 'a.txt')).toBe('A')
      expect(await file(p, 'b.txt')).toBeNull()
      p.session.write('n\r')
      await p.session.waitFor('你: ', second)
      expect(await file(p, 'b.txt')).toBeNull()
      checkReceipts(p, ['write_file', 'write_file'], [false, true])
      expect(new Set(calls(p).map(b => b.id)).size).toBe(2)
      await exit(p, second)
    })

    it('refuses an outside write even under bypass', async () => {
      const outside = await makeTempWorkspace()
      cleanups.push(outside.cleanup)
      const target = join(outside.dir, 'outside.txt')
      const p = await start('outside-write', {}, { PERMISSION_MODE: 'bypass' })
      const from = await p.input(
        '请只调用 write_file 一次，path 必须精确为 ' +
          JSON.stringify(target) +
          '，content=outside。收到结果立即结束，不重试，不用其他工具。'
      )
      await p.session.waitFor('你: ', from)
      expect(p.session.output.slice(from)).not.toContain('[y/N]: ')
      await expect(readFile(target)).rejects.toThrow()
      checkReceipts(p, ['write_file'], [true])
      expect(JSON.stringify(receipts(p))).toContain('outside the workspace')
      await exit(p, from)
    })

    it('rechecks a path changed during an actual approval wait', async () => {
      const outside = await makeTempWorkspace()
      cleanups.push(outside.cleanup)
      const p = await start('path-change')
      await mkdir(join(p.cwd, 'target'))
      const from = await p.input(
        '请只调用 write_file 一次，path=target/result.txt，content=live-matrix-ok。收到结果立即结束，不使用其他工具、不重试。'
      )
      await p.session.waitFor('[y/N]: ', from)
      await rm(join(p.cwd, 'target'), { recursive: true })
      await symlink(outside.dir, join(p.cwd, 'target'))
      p.session.write('y\r')
      await p.session.waitFor('你: ', from)
      await expect(readFile(join(outside.dir, 'result.txt'))).rejects.toThrow()
      checkReceipts(p, ['write_file'], [true])
      expect(p.session.output.slice(from)).not.toContain('⚡ write_file')
      await exit(p, from)
    })

    it('reads a workspace file without asking', async () => {
      const marker = 'workspace-read-' + randomUUID()
      const p = await start('workspace-read', { 'note.txt': marker })
      const from = await p.input(
        '请只调用 read_file 一次读取 note.txt，收到结果后复述文件内容并结束，不用其他工具。'
      )
      await p.session.waitFor('你: ', from)
      expect(p.session.output.slice(from)).not.toContain('[y/N]: ')
      expect(JSON.stringify(receipts(p))).toContain(marker)
      checkReceipts(p, ['read_file'], [false])
      await exit(p, from)
    })

    it('asks before reading a file outside the workspace', async () => {
      const marker = 'external-read-' + randomUUID()
      const outside = await makeTempWorkspace({ 'note.txt': marker })
      cleanups.push(outside.cleanup)
      const target = join(outside.dir, 'note.txt')
      const p = await start('external-read')
      const from = await p.input(
        '请只调用 read_file 一次，path 必须为 ' +
          JSON.stringify(target) +
          '。收到结果后复述文件内容并结束，不使用其他工具、不重试。'
      )
      await p.session.waitFor('[y/N]: ', from)
      expect(JSON.stringify(p.requests)).not.toContain(marker)
      p.session.write('y\r')
      await p.session.waitFor('你: ', from)
      expect(JSON.stringify(receipts(p))).toContain(marker)
      checkReceipts(p, ['read_file'], [false])
      await exit(p, from)
    })

    it('separates tool approval and human PTY takeover with a real model', async () => {
      const secret = 'fake-private-' + randomUUID()
      const marker = 'private-output-' + randomUUID()
      const p = await start('terminal-layers', {
        'human.sh':
          'read -rs -p "TOKEN_READY" token\nprintf "%s" "$token" > human-result.txt\nprintf "\\n' +
          marker +
          '\\n"\n',
      })
      const from = await p.input(
        '请仅调用 terminal 一次，command 精确为 bash ./human.sh，interactive=true。让用户操作，收到工具结果后只说完成，不使用其他工具、不重试。'
      )
      await p.session.waitFor('[y/N]: ', from)
      expect(p.session.output.slice(from)).not.toContain('Allow human terminal?')
      expect(await file(p, 'human-result.txt')).toBeNull()
      const takeover = p.session.output.length
      p.session.write('y\r')
      await p.session.waitFor('Allow human terminal? [y/N]', takeover)
      expect(await file(p, 'human-result.txt')).toBeNull()
      p.session.write('y\r')
      await p.session.waitFor('TOKEN_READY', takeover)
      const resumed = p.session.output.length
      p.session.write(secret + '\r')
      await p.session.waitFor('你: ', resumed)
      expect(await file(p, 'human-result.txt')).toBe(secret)
      expect(p.session.output).toContain(marker)
      expect(p.session.output).not.toContain(secret)
      expect(JSON.stringify(p.requests)).not.toContain(secret)
      expect(JSON.stringify(p.requests)).not.toContain(marker)
      checkReceipts(p, ['terminal'], [false])
      expect(JSON.stringify(receipts(p))).toContain('human-controlled completed')
      await exit(p, resumed)
    })

    it('refuses terminal before offering human takeover', async () => {
      const p = await start('terminal-deny')
      const from = await p.input(
        '请仅调用 terminal 一次，command 精确为 echo terminal-marker > result.txt，interactive=true。收到结果后立即结束，不重试、不用其他工具。'
      )
      await p.session.waitFor('[y/N]: ', from)
      p.session.write('n\r')
      await p.session.waitFor('你: ', from)
      expect(p.session.output.slice(from)).not.toContain('Allow human terminal?')
      expect(await file(p)).toBeNull()
      checkReceipts(p, ['terminal'], [true])
      await exit(p, from)
    })

    it('does not accept piped y as approval with a real provider', async () => {
      const p = await start('pipe-y')
      const result = await runCli({
        args: [writePrompt],
        cwd: p.cwd,
        env: { ...p.env, ZERO2AGENT_SKIP_LOCAL_ENV: '1' },
        stdin: 'y\n',
      })
      expect(result.code).toBe(0)
      expect(result.output).toContain('Approval requires an interactive TTY')
      expect(await file(p)).toBeNull()
      checkReceipts(p, ['write_file'], [true])
    })
  }
)
