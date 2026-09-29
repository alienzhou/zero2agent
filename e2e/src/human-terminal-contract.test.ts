import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CLI_ENTRY, REPO_ROOT, makeTempWorkspace, runCli } from './helpers/cli.js'
import { startHumanTerminal } from './helpers/human-terminal.js'

const CONFIRM = 'Allow human terminal? [y/N]'
const SECRET = 'fake-contract-token-4937'
// bash disables echo before printing read's prompt, so readiness cannot race the secret.
const secretScript =
  'read -rs -p "SECRET_READY" token\nprintf "\\nTOKEN_LENGTH:%s\\n" "${#token}"\n'
type Session = ReturnType<typeof startHumanTerminal>

describe.skipIf(process.platform === 'win32')('E02-S004 human terminal: real PTY contract', () => {
  const sessions: Session[] = []
  const cleanups: Array<() => Promise<void>> = []
  const pids: number[] = []

  afterEach(async () => {
    // Emergency cleanup also covers assertion failures while a child ignores SIGINT.
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* Already reaped. */
      }
    }
    for (const session of sessions.splice(0)) await session.close()
    for (const cleanup of cleanups.splice(0)) await cleanup()
  })

  async function workspace(files: Record<string, string> = {}) {
    const ws = await makeTempWorkspace(files)
    cleanups.push(ws.cleanup)
    return ws.dir
  }
  function start(cwd: string, args: string[], repl = false, entry = CLI_ENTRY) {
    const session = startHumanTerminal(entry, args, cwd, repl)
    sessions.push(session)
    return session
  }
  async function approve(session: Session, from = 0) {
    await session.waitFor(CONFIRM, from)
    session.write('y\r')
    await session.waitFor('Human terminal active', from)
    expect(session.output).toContain('Ctrl-]')
  }

  it('rejects non-TTY input before starting the command, without an API key', async () => {
    const cwd = await workspace()
    const result = await runCli({
      cwd,
      args: ['--terminal', 'touch forbidden'],
      stdin: 'y\n',
      inheritEnv: false,
      env: { PATH: '/usr/bin:/bin', ZERO2AGENT_SKIP_LOCAL_ENV: '1' },
    })
    expect(result.output).toMatch(/TTY/i)
    expect(result.output).not.toContain('请设置 ANTHROPIC_API_KEY')
    await expect(fs.access(path.join(cwd, 'forbidden'))).rejects.toThrow()
  })

  it.each(['n\r', '\r', 'other\r', '\x04'])(
    'denies confirmation %j without execution',
    async answer => {
      const cwd = await workspace()
      const session = start(cwd, ['--terminal', 'touch forbidden'])
      await session.waitFor(CONFIRM)
      session.write(answer)
      await session.waitExit()
      expect(session.output).not.toContain('Human terminal active')
      await expect(fs.access(path.join(cwd, 'forbidden'))).rejects.toThrow()
    }
  )

  it('supports two read rounds, isatty, and /dev/tty', async () => {
    const cwd = await workspace({
      'read.sh': [
        'test -t 0 && test -t 1 && test -t 2 && echo ISATTY_OK',
        'printf "DEVTTY_OK\\n" > /dev/tty',
        'echo ROUND_ONE_READY; read -r one; printf "ONE:%s\\n" "$one"',
        'echo ROUND_TWO_READY; read -r two; printf "TWO:%s\\n" "$two"',
      ].join('\n'),
    })
    const session = start(cwd, ['--terminal', 'bash ./read.sh'])
    await approve(session)
    await session.waitFor('ROUND_ONE_READY')
    session.write('alpha\r')
    await session.waitFor('ROUND_TWO_READY')
    session.write('beta\r')
    expect(await session.waitExit()).toBe(0)
    for (const marker of ['ISATTY_OK', 'DEVTTY_OK', 'ONE:alpha', 'TWO:beta'])
      expect(session.output).toContain(marker)
  })

  it('does not echo a read -s token or create an output artifact', async () => {
    const cwd = await workspace({ 'secret.sh': secretScript })
    const session = start(cwd, ['--terminal', 'bash ./secret.sh'])
    await approve(session)
    await session.waitFor('SECRET_READY')
    session.write(`${SECRET}\r`)
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain(`TOKEN_LENGTH:${SECRET.length}`)
    expect(session.output).not.toContain(SECRET)
    expect(await fs.readdir(cwd)).toEqual(['secret.sh'])
  })

  it('forwards Ctrl-C to the foreground program', async () => {
    const cwd = await workspace({
      'interrupt.sh':
        "trap 'echo INTERRUPTED; exit 23' INT\necho INTERRUPT_READY\nwhile :; do sleep 1; done\n",
    })
    const session = start(cwd, ['--terminal', 'bash ./interrupt.sh'])
    await approve(session)
    await session.waitFor('INTERRUPT_READY')
    session.write('\x03')
    await session.waitFor('INTERRUPTED')
    await session.waitExit()
  })

  it('forwards Ctrl-D to read as EOF', async () => {
    const cwd = await workspace({
      'eof.sh':
        'echo EOF_READY\nif read -r line; then echo UNEXPECTED_INPUT; else echo READ_EOF; fi\n',
    })
    const session = start(cwd, ['--terminal', 'bash ./eof.sh'])
    await approve(session)
    await session.waitFor('EOF_READY')
    session.write('\x04')
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain('READ_EOF')
  })

  it('Ctrl-] ends a SIGINT-ignoring process and its ordinary descendant', async () => {
    const cwd = await workspace({
      'ignore.sh': 'trap "" INT\nsleep 300 &\necho DESCENDANT:$!\necho IGNORING_PID:$$\nwait\n',
    })
    const session = start(cwd, ['--terminal', 'bash ./ignore.sh'])
    await approve(session)
    await session.waitFor(/IGNORING_PID:\d+/)
    const found = [...session.output.matchAll(/(?:IGNORING_PID|DESCENDANT):(\d+)/g)].map(match =>
      Number(match[1])
    )
    expect(found).toHaveLength(2)
    pids.push(...found)
    session.write('\x1d')
    await session.waitExit()
    await expect
      .poll(
        () =>
          found.every(pid => {
            try {
              process.kill(pid, 0)
              return false
            } catch {
              return true
            }
          }),
        { timeout: 5000 }
      )
      .toBe(true)
    pids.length = 0
  })

  it('propagates resize to the real inner terminal', async () => {
    const cwd = await workspace({
      'resize.sh':
        'trap \'echo RESIZE_ACK\' WINCH\nstty size\necho RESIZE_READY\nwhile [[ "$line" != check ]]; do read -r line; done\nstty size\n',
    })
    const session = start(cwd, ['--terminal', 'bash ./resize.sh'])
    await approve(session)
    await session.waitFor('RESIZE_READY')
    expect(session.output).toMatch(/24\s+80/)
    session.resize(101, 37)
    // A WINCH handler lets the child itself acknowledge readiness, avoiding a timing sleep.
    await session.waitFor('RESIZE_ACK')
    session.write('check\r')
    await session.waitExit()
    expect(session.output).toMatch(/37\s+101/)
  })

  it('restores readline/raw/listeners after two handoffs and excludes secrets from receipts/history', async () => {
    const cwd = await workspace({ 'secret.sh': secretScript })
    const entry = path.join(REPO_ROOT, 'e2e/src/helpers/human-terminal-readline.mjs')
    const session = start(cwd, [], false, entry)
    let from = 0
    for (let round = 1; round <= 2; round++) {
      await approve(session, from)
      await session.waitFor('SECRET_READY', from)
      from = session.output.length
      session.write(`${SECRET}\r`)
      await session.waitFor(`RESTORED_${round}:true`)
    }
    await session.waitFor('AFTER_READY:')
    session.write('AFTER\r')
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain('AFTER:AFTER')
    expect(session.output).not.toContain(SECRET)
    for (const line of session.output.split('\n').filter(line => line.includes('RECEIPT_'))) {
      expect(line).not.toMatch(/SECRET_READY|TOKEN_LENGTH|Saved to:/)
    }
    expect(await fs.readdir(cwd)).toEqual(['secret.sh'])
  })

  it('accepts two /terminal commands followed by exit in the actual CLI REPL', async () => {
    const cwd = await workspace({ 'secret.sh': secretScript })
    const session = start(cwd, [], true)
    let from = 0
    for (let round = 1; round <= 2; round++) {
      await session.waitFor('你: ', from)
      from = session.output.length
      session.write('/terminal bash ./secret.sh\r')
      await approve(session, from)
      await session.waitFor('SECRET_READY', from)
      session.write(`${SECRET}\r`)
      await session.waitFor(`TOKEN_LENGTH:${SECRET.length}`, from)
    }
    await session.waitFor('你: ', from)
    session.write('exit\r')
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain('再见')
    expect(session.output).not.toContain(SECRET)
    expect(await fs.readdir(cwd)).toEqual(['secret.sh'])
  })

  it('Ctrl-D exits the default bash and then the host REPL', async () => {
    const cwd = await workspace()
    const session = start(cwd, [], true)
    await session.waitFor('你: ')
    const from = session.output.length
    session.write('/terminal\r')
    await approve(session, from)
    session.write('printf "SHELL_READY\\n"\r')
    await session.waitFor(/\r?\nSHELL_READY\r?\n/, from)
    session.write('\x04')
    await session.waitFor('你: ', from)
    session.write('\x04')
    expect(await session.waitExit()).toBe(0)
  })

  it('drains final output before reporting exit', async () => {
    const cwd = await workspace({
      'output.sh':
        'for ((i=0;i<4000;i++)); do printf "PAYLOAD_%04d\\n" "$i"; done\necho DRAIN_COMPLETE\n',
    })
    const session = start(cwd, ['--terminal', 'bash ./output.sh'])
    await approve(session)
    expect(await session.waitExit()).toBe(0)
    expect(session.output.match(/PAYLOAD_\d{4}/g)).toHaveLength(4000)
    expect(session.output).toContain('DRAIN_COMPLETE')
  })
})
