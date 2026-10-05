import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { CLI_ENTRY, makeTempWorkspace, runCli } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'
import { sendSSEReply, type SSEBlock } from './helpers/sse.js'

type Request = { messages: Array<{ role: string; content: string | SSEBlock[] }> }
const write = (id = 'write', file = 'result.txt'): SSEBlock => ({
  type: 'tool_use',
  id,
  name: 'write_file',
  input: { path: file, content: 'approved' },
})
async function setup(blocks: SSEBlock[], mode = 'default', extra: Record<string, string> = {}) {
  const workspace = await makeTempWorkspace({ 'source.txt': 'source' })
  const requests: Request[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push(JSON.parse(body) as Request)
    sendSSEReply(
      res,
      requests.length === 1 ? blocks : [{ type: 'text', text: 'RESULT_DONE' }],
      requests.length === 1 ? 'tool_use' : 'end_turn'
    )
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('No local port')
  return {
    workspace,
    requests,
    env: {
      ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      ANTHROPIC_API_KEY: 'contract-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${addr.port}`,
      MODEL_NAME: 'contract-model',
      CONTEXT_WINDOW: '200000',
      PERMISSION_MODE: mode,
      ...extra,
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await workspace.cleanup()
    },
  }
}
function result(requests: Request[], id = 'write') {
  return requests[1].messages
    .flatMap(m => (Array.isArray(m.content) ? m.content : []))
    .find(b => b.type === 'tool_result' && b.tool_use_id === id)
}

describe('permissions through built CLI, SDK SSE and real PTY', () => {
  it.each([
    ['approve', 'y\r', true],
    ['reject', 'n\r', false],
    ['empty', '\r', false],
    ['invalid', 'always\r', false],
    ['cancel', '\x03', false],
    ['EOF', '\x04', false],
    ['timeout', null, false],
  ] as const)('handles %s without unintended writes', async (kind, answer, allowed) => {
    const f = await setup(
      [write()],
      'default',
      kind === 'timeout' ? { APPROVAL_TIMEOUT_MS: '150' } : {}
    )
    const pty = startHumanTerminal(CLI_ENTRY, [], f.workspace.dir, true, { env: f.env })
    try {
      await pty.waitFor('你: ')
      const from = pty.output.length
      pty.write('make a file\r')
      await pty.waitFor('[y/N]: ', from)
      expect(pty.output.slice(from)).toContain('result.txt')
      expect(pty.output.slice(from)).toContain('approved')
      if (answer !== null) pty.write(answer)
      await pty.waitFor('RESULT_DONE', from)
      expect(result(f.requests)?.is_error === true).toBe(!allowed)
      const file = await readFile(join(f.workspace.dir, 'result.txt'), 'utf8').catch(() => null)
      expect(file).toBe(allowed ? 'approved' : null)
      if (kind !== 'EOF') {
        await pty.waitFor('你: ', pty.output.indexOf('RESULT_DONE', from))
        pty.write('exit\r')
      }
      expect(await pty.waitExit()).toBe(0)
    } finally {
      await pty.close()
      await f.close()
    }
  })
  it('requires a separate approval for every same-tool call and pairs all results', async () => {
    const f = await setup([write('one', 'one.txt'), write('two', 'two.txt')])
    const pty = startHumanTerminal(CLI_ENTRY, [], f.workspace.dir, true, { env: f.env })
    try {
      await pty.waitFor('你: ')
      const from = pty.output.length
      pty.write('two writes\r')
      await pty.waitFor('[y/N]: ', from)
      const next = pty.output.length
      pty.write('y\r')
      await pty.waitFor('[y/N]: ', next)
      pty.write('n\r')
      await pty.waitFor('RESULT_DONE', next)
      expect(result(f.requests, 'one')?.is_error).toBeUndefined()
      expect(result(f.requests, 'two')?.is_error).toBe(true)
      expect(await readFile(join(f.workspace.dir, 'one.txt'), 'utf8')).toBe('approved')
      await expect(readFile(join(f.workspace.dir, 'two.txt'))).rejects.toThrow()
      await pty.waitFor('你: ', pty.output.indexOf('RESULT_DONE', next))
      pty.write('exit\r')
      expect(await pty.waitExit()).toBe(0)
    } finally {
      await pty.close()
      await f.close()
    }
  })
  it('gates model terminal execution before the human takeover confirmation', async () => {
    const f = await setup([
      {
        type: 'tool_use',
        id: 'human',
        name: 'terminal',
        input: { command: 'bash ./private.sh', interactive: true },
      },
    ])
    await writeFile(
      join(f.workspace.dir, 'private.sh'),
      'read -p TOKEN_READY token\nprintf "private-%s" "$token"\n'
    )
    const pty = startHumanTerminal(CLI_ENTRY, [], f.workspace.dir, true, { env: f.env })
    try {
      await pty.waitFor('你: ')
      const from = pty.output.length
      pty.write('human terminal\r')
      await pty.waitFor('[y/N]: ', from)
      expect(pty.output.slice(from)).not.toContain('Allow human terminal?')
      pty.write('y\r')
      await pty.waitFor('Allow human terminal? [y/N]', from)
      pty.write('y\r')
      await pty.waitFor('TOKEN_READY', from)
      pty.write('fake-secret\r')
      await pty.waitFor('RESULT_DONE', from)
      const encoded = JSON.stringify(f.requests)
      expect(encoded).toContain('human-controlled completed')
      expect(encoded).not.toContain('fake-secret')
      expect(encoded).not.toContain('private-fake')
      await pty.waitFor('你: ', pty.output.indexOf('RESULT_DONE', from))
      pty.write('exit\r')
      expect(await pty.waitExit()).toBe(0)
    } finally {
      await pty.close()
      await f.close()
    }
  })
  it('supports a one-shot TTY approval', async () => {
    const f = await setup([write()])
    const pty = startHumanTerminal(CLI_ENTRY, ['make a file'], f.workspace.dir, false, {
      env: f.env,
    })
    try {
      await pty.waitFor('[y/N]: ')
      pty.write('y\r')
      expect(await pty.waitExit()).toBe(0)
      expect(await readFile(join(f.workspace.dir, 'result.txt'), 'utf8')).toBe('approved')
    } finally {
      await pty.close()
      await f.close()
    }
  })
  it.each(['default', 'accept-edits', 'read-only'] as const)(
    'handles piped %s mode explicitly',
    async mode => {
      const f = await setup([write()], mode)
      try {
        const cli = await runCli({
          args: ['write'],
          cwd: f.workspace.dir,
          env: f.env,
          stdin: 'y\n',
        })
        expect(cli.code).toBe(0)
        expect(cli.stdout).not.toContain('[y/N]: ')
        expect(result(f.requests)?.is_error === true).toBe(mode !== 'accept-edits')
        expect(await readFile(join(f.workspace.dir, 'result.txt'), 'utf8').catch(() => null)).toBe(
          mode === 'accept-edits' ? 'approved' : null
        )
      } finally {
        await f.close()
      }
    }
  )
  it('a terminal command is refused without approval, or allowed by an exact host rule', async () => {
    for (const allow of [false, true]) {
      const command = 'printf executed > shell-result.txt'
      const f = await setup(
        [{ type: 'tool_use', id: 'shell', name: 'terminal', input: { command } }],
        'default',
        allow
          ? {
              PERMISSION_RULES: JSON.stringify([
                { tool: 'terminal', action: 'allow', input: { command } },
              ]),
            }
          : {}
      )
      try {
        await runCli({ args: ['shell'], cwd: f.workspace.dir, env: f.env })
        expect(result(f.requests, 'shell')?.is_error === true).toBe(!allow)
        expect(
          await readFile(join(f.workspace.dir, 'shell-result.txt'), 'utf8').catch(() => null)
        ).toBe(allow ? 'executed' : null)
      } finally {
        await f.close()
      }
    }
  })
  it('allows workspace reads with no prompt, even through a pipe', async () => {
    const f = await setup([
      { type: 'tool_use', id: 'read', name: 'read_file', input: { path: 'source.txt' } },
    ])
    try {
      await runCli({ args: ['read'], cwd: f.workspace.dir, env: f.env })
      expect(result(f.requests, 'read')?.content).toContain('source')
      expect(result(f.requests, 'read')?.is_error).toBeUndefined()
    } finally {
      await f.close()
    }
  })
  it('denies an outside write before any Approval UI or filesystem effect', async () => {
    const f = await setup([write('write', '../outside.txt')], 'bypass')
    try {
      await runCli({ args: ['write'], cwd: f.workspace.dir, env: f.env })
      expect(result(f.requests)?.is_error).toBe(true)
    } finally {
      await f.close()
    }
  })
  it.each([
    { PERMISSION_MODE: 'wrong' },
    { PERMISSION_RULES: '{' },
    { PERMISSION_RULES: 'null' },
    { APPROVAL_TIMEOUT_MS: 'NaN' },
  ])('invalid environment fails at startup: %j', async invalid => {
    const f = await setup([write()])
    try {
      const cli = await runCli({ args: ['x'], cwd: f.workspace.dir, env: { ...f.env, ...invalid } })
      expect(cli.code).toBe(1)
      expect(cli.output).toContain('启动失败')
      expect(f.requests).toHaveLength(0)
    } finally {
      await f.close()
    }
  })
})
