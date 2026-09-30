import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
    expect(result.code).not.toBe(0)
    await expect(fs.access(path.join(cwd, 'forbidden'))).rejects.toThrow()
  })

  it('rejects the simulated unsupported platform before confirmation', async () => {
    const cwd = await workspace()
    const entry = path.join(REPO_ROOT, 'e2e/src/helpers/human-terminal-platform.mjs')
    const session = start(cwd, [], false, entry)
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain('GUARD:Human terminal requires a POSIX CLI/TTY')
    expect(session.output).not.toContain(CONFIRM)
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

  it('forwards readline editing keys and UTF-8 human input', async () => {
    const cwd = await workspace({
      'editing.sh':
        'read -e -r -p "EDIT_READY" value\nprintf "\\nEDIT:%s\\n" "$value"\nread -r -p "UNICODE_READY" value\nprintf "\\nUNICODE:%s\\n" "$value"\n',
    })
    const session = start(cwd, ['--terminal', 'bash ./editing.sh'])
    await approve(session)
    await session.waitFor('EDIT_READY')
    session.write('AX\x1b[DB\x1b[3~\r')
    await session.waitFor('UNICODE_READY')
    session.write('你好\r')
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain('EDIT:AB')
    expect(session.output).toContain('UNICODE:你好')
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

  it('accepts explicit yes and discards the rest of the confirmation chunk', async () => {
    const cwd = await workspace({ 'secret.sh': secretScript })
    const session = start(cwd, ['--terminal', 'bash ./secret.sh'])
    await session.waitFor(CONFIRM)
    session.write('yes\rSHOULD_NOT_FORWARD\r')
    await session.waitFor('SECRET_READY')
    expect(session.output).not.toContain('SHOULD_NOT_FORWARD')
    expect(session.output).not.toContain('TOKEN_LENGTH:')
    session.write(`${SECRET}\r`)
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain(`TOKEN_LENGTH:${SECRET.length}`)
  })

  it('restores real readline after an injected native spawn failure', async () => {
    const cwd = await workspace()
    const entry = path.join(REPO_ROOT, 'e2e/src/helpers/human-terminal-failure.mjs')
    const session = start(cwd, [], false, entry)
    await session.waitFor(CONFIRM)
    session.write('y\r')
    await session.waitFor('FAILURE_RESTORED:true')
    await session.waitFor('AFTER_FAILURE:')
    session.write('still usable\r')
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain('ANSWER:still usable')
    expect(session.output).not.toContain('Human terminal active')
  })

  it('terminates during confirmation without executing the proposed command', async () => {
    const cwd = await workspace()
    const session = start(cwd, ['--terminal', 'touch forbidden'])
    await session.waitFor(CONFIRM)
    session.signal('SIGTERM')
    await session.waitExit()
    expect(session.output).not.toContain('Human terminal active')
    await expect(fs.access(path.join(cwd, 'forbidden'))).rejects.toThrow()
  })

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ])(
    'restores the connected terminal and cleans descendants on external %s',
    async (signal, code) => {
      const cwd = await workspace({
        'signal.sh':
          'sleep 300 &\nprintf "%s %s" "$$" "$!" > signal-pids.txt\nprintf "\\033[?1049h\\033[?25lREADY_TO_SIGNAL\\n"\nwait\n',
      })
      const runner = path.join(REPO_ROOT, 'e2e/src/helpers/human-terminal-signal.py')
      const result = await promisify(execFile)(
        'python3',
        [runner, process.execPath, CLI_ENTRY, String(signal)],
        {
          cwd,
          env: { PATH: '/usr/bin:/bin', HOME: cwd, TMPDIR: cwd, TERM: 'xterm-256color' },
          timeout: 15_000,
        }
      )
      expect(JSON.parse(result.stdout), result.stdout).toMatchObject({
        approved: true,
        signal_sent: true,
        exit_code: code,
        terminal_restored: true,
        display_reset: true,
        remaining_children: [],
        error: '',
      })
    }
  )

  it('cleans the real process tree when the outer terminal disconnects', async () => {
    const cwd = await workspace({
      'disconnect.sh':
        'trap "" HUP\nsleep 300 &\nprintf "%s" "$!" > disconnected.pid\necho READY_TO_DISCONNECT\nwait\n',
    })
    const runner = path.join(REPO_ROOT, 'e2e/src/helpers/human-terminal-disconnect.py')
    const result = await promisify(execFile)('python3', [runner, process.execPath, CLI_ENTRY], {
      cwd,
      env: { PATH: '/usr/bin:/bin', HOME: cwd, TMPDIR: cwd, TERM: 'xterm-256color' },
      timeout: 15_000,
    }).catch(error => ({
      stdout: String(error.stdout),
      stderr: String(error.stderr),
      failed: true,
    }))
    const pid = Number(await fs.readFile(path.join(cwd, 'disconnected.pid'), 'utf8'))
    pids.push(pid)
    expect(JSON.parse(result.stdout), result.stdout).toMatchObject({
      approved: true,
      disconnected: true,
      host_exited: true,
      exit_code: 129,
    })
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0)
            return false
          } catch {
            return true
          }
        },
        { timeout: 5000 }
      )
      .toBe(true)
    pids.length = 0
  })

  it('cleans an ordinary background descendant after normal command exit', async () => {
    const cwd = await workspace({
      'background.sh': 'sleep 300 &\necho BACKGROUND_PID:$!\nexit 0\n',
    })
    const session = start(cwd, ['--terminal', 'bash ./background.sh'])
    await approve(session)
    await session.waitFor(/BACKGROUND_PID:\d+/)
    const pid = Number(session.output.match(/BACKGROUND_PID:(\d+)/)?.[1])
    pids.push(pid)
    expect(await session.waitExit()).toBe(0)
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      })
      .toBe(true)
    pids.length = 0
  })

  it('cleans a HUP-ignoring child created between two ownership scans', async () => {
    const cwd = await workspace({
      'late.sh': 'sleep 0.1\ntrap "" HUP\nsleep 300 &\necho LATE_PID:$!\nexit 0\n',
    })
    const session = start(cwd, ['--terminal', 'bash ./late.sh'])
    await approve(session)
    await session.waitFor(/LATE_PID:\d+/)
    const pid = Number(session.output.match(/LATE_PID:(\d+)/)?.[1])
    pids.push(pid)
    expect(await session.waitExit()).toBe(0)
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      })
      .toBe(true)
    pids.length = 0
  })

  it('discards private input typed during terminal teardown, before readline recovery', async () => {
    const cwd = await workspace({
      'exit.sh': 'stty -echo\necho EXIT_PID:$$\necho EXITING\nexit 0\n',
    })
    const entry = path.join(REPO_ROOT, 'e2e/src/helpers/human-terminal-teardown.mjs')
    const session = start(cwd, [], false, entry)
    await approve(session)
    await session.waitFor('EXITING')
    const pid = Number(session.output.match(/EXIT_PID:(\d+)/)?.[1])
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0)
            return false
          } catch {
            return true
          }
        },
        { interval: 5 }
      )
      .toBe(true)
    expect(session.output).not.toContain('AFTER_TEARDOWN:')
    session.write(`${SECRET}\r`)
    await session.waitFor('AFTER_TEARDOWN:')
    session.write('AFTER\r')
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain('ANSWER:AFTER')
    expect(session.output).not.toContain(SECRET)
  })

  it('uses owned-group cleanup when process inspection fails after real spawn', async () => {
    const cwd = await workspace({
      'scan.sh': 'trap "" HUP TERM\nsleep 300 &\nprintf "%s" "$!" > child.pid\nwait\n',
    })
    const entry = path.join(REPO_ROOT, 'e2e/src/helpers/human-terminal-scan-failure.mjs')
    const session = start(cwd, [], false, entry)
    await session.waitFor(CONFIRM)
    session.write('y\r')
    await expect
      .poll(async () => fs.readFile(path.join(cwd, 'child.pid'), 'utf8').catch(() => ''))
      .not.toBe('')
    const pid = Number(await fs.readFile(path.join(cwd, 'child.pid'), 'utf8'))
    pids.push(pid)
    await session.waitExit()
    expect(session.output).toContain('Error: human-controlled terminal failed')
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      })
      .toBe(true)
    pids.length = 0
  })

  it('returns from a real pager and preserves its final displayed output', async () => {
    const cwd = await workspace({
      'page.txt': Array.from({ length: 120 }, (_, i) => `PAGER-LINE-${i + 1}`).join('\n'),
    })
    const session = start(cwd, ['--terminal', 'LESSHISTFILE=- /usr/bin/less page.txt'])
    await approve(session)
    await session.waitFor('PAGER-LINE-1')
    session.write('q')
    expect(await session.waitExit()).toBe(0)
    expect(session.output).toContain('human-controlled completed')
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
    expect(await session.waitExit()).toBe(23)
  })

  it('does not report a successful exit when Ctrl-C terminates the child by signal', async () => {
    const cwd = await workspace({ 'signal.sh': 'echo SIGNAL_READY\nexec sleep 300\n' })
    const session = start(cwd, ['--terminal', 'bash ./signal.sh'])
    await approve(session)
    await session.waitFor('SIGNAL_READY')
    session.write('\x03')
    expect(await session.waitExit()).toBe(130)
    expect(session.output).toContain('Signal: 2')
    expect(session.output).not.toContain('Exit code: 0')
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
